import YAML from 'yaml';
import { fetchResponse } from '../fetchResponse.js';
import { getKeys, encryptBlob, decryptBlob, hmacB64url } from './crypto.js';
import { DEFAULT_SOURCE_UA } from './ua.js';

const readyDbs = new WeakSet();
// 惰性建表（按 db 实例记忆）；URL 与上游内容全部加密存于 blob，仅名称/代码/时间/UA 明文
export async function ensureSourceTable(db) {
    if (readyDbs.has(db)) return;
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS sub_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        blob TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        ua TEXT NOT NULL DEFAULT '${DEFAULT_SOURCE_UA}',
        code TEXT
    )`,
        )
        .run();
    try {
        await db.prepare('SELECT ua FROM sub_sources LIMIT 1').first();
    } catch {
        // 旧表无 ua 列：补列，历史行取默认值
        await db.prepare(`ALTER TABLE sub_sources ADD COLUMN ua TEXT NOT NULL DEFAULT '${DEFAULT_SOURCE_UA}'`).run();
    }
    try {
        await db.prepare('SELECT code FROM sub_sources LIMIT 1').first();
    } catch {
        // 旧表无 code 列：补列（订阅代码，合并节点时作节点名前缀，全表唯一，可为空）
        await db.prepare('ALTER TABLE sub_sources ADD COLUMN code TEXT').run();
    }
    try {
        // 非空代码全表唯一的数据库层兜底（空值/NULL 不参与）
        await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_sources_code ON sub_sources(code) WHERE code IS NOT NULL AND code <> ''").run();
    } catch {
        // 部分环境不支持 partial index 时由应用层校验兜底
    }
    readyDbs.add(db);
}

// 订阅代码：可选；非空时仅允许字母/数字/下划线/短横线，1-16 位
export function normalizeSourceCode(code) {
    if (code === undefined || code === null) return null;
    const clean = String(code).trim();
    if (!clean) return null;
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(clean)) throw new Error('订阅代码仅支持字母、数字、下划线、短横线，长度 1-16');
    return clean;
}

// 全表唯一校验（应用层先行，数据库唯一索引兜底）
async function assertCodeAvailable(db, code, excludeId) {
    if (!code) return;
    const row = await db.prepare('SELECT id FROM sub_sources WHERE code = ? LIMIT 1').bind(code).first();
    if (row && row.id !== excludeId) throw new Error(`订阅代码「${code}」已被其它订阅使用`);
}

// 实时拉上游，UA 按保存该订阅时的客户端类型；失败 throw，调用方不入库
async function fetchSourceContent(url, ua) {
    const res = await fetchResponse(url, ua || DEFAULT_SOURCE_UA);
    if (!res || res.error) throw new Error(`拉取原始订阅失败：${res?.error?.message || '网络错误'}`);
    if (res.status !== 200 || !res.data) {
        throw new Error(`拉取原始订阅失败：HTTP ${res.status || 0}（${res.via === 'relay' ? '经中转' : '直连'}）`);
    }
    const content = typeof res.data === 'string' ? res.data : YAML.stringify(res.data);
    return { content, headers: res.headers || {} };
}

export async function saveSource(db, env, url, name, ua, code) {
    await ensureSourceTable(db);
    const srcUrl = new URL(url);
    const safeUa = typeof ua === 'string' && ua ? ua.slice(0, 64) : DEFAULT_SOURCE_UA;
    const safeCode = normalizeSourceCode(code);
    const { content, headers } = await fetchSourceContent(srcUrl.href, safeUa);
    return upsertSource(db, env, srcUrl.href, name, safeUa, content, headers, safeCode);
}

// 本机导入：内容已由调用方在自己网络拉好，服务端只负责加密入库
// （部分机场 WAF 封禁全部数据中心出口，云端无法代拉，只能由用户本机拉取后推送）
export async function importSource(db, env, url, name, ua, content, headers = {}, code) {
    await ensureSourceTable(db);
    const srcUrl = new URL(url);
    if (!content || typeof content !== 'string') throw new Error('缺少订阅内容');
    const safeUa = typeof ua === 'string' && ua ? ua.slice(0, 64) : DEFAULT_SOURCE_UA;
    const safeCode = normalizeSourceCode(code);
    return upsertSource(db, env, srcUrl.href, name, safeUa, content, headers, safeCode);
}

async function upsertSource(db, env, url, name, ua, content, headers, code = null) {
    await ensureSourceTable(db);
    const { encKey, hmacKey } = await getKeys(env);
    const id = await hmacB64url(url, hmacKey);
    await assertCodeAvailable(db, code, id);
    const blob = await encryptBlob({ url, content, headers }, encKey);
    await db
        .prepare(
            `INSERT INTO sub_sources (id, name, blob, fetched_at, ua, code) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, blob = excluded.blob, fetched_at = excluded.fetched_at, ua = excluded.ua, code = excluded.code`,
        )
        .bind(id, name, blob, Date.now(), ua, code)
        .run();
    return { id, name, code: code || null };
}

export async function listSources(db) {
    await ensureSourceTable(db);
    const rows = await db.prepare('SELECT id, name, code, fetched_at FROM sub_sources ORDER BY fetched_at DESC').all();
    return (rows.results || []).map((r) => ({ id: r.id, name: r.name, code: r.code || null, fetchedAt: r.fetched_at }));
}

export async function getSource(db, env, id) {
    await ensureSourceTable(db);
    const row = await db.prepare('SELECT * FROM sub_sources WHERE id = ?').bind(id).first();
    if (!row) return null;
    const { encKeys } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKeys);
    return { id: row.id, name: row.name, url: obj.url, content: obj.content, headers: obj.headers || {}, fetchedAt: row.fetched_at, ua: row.ua || DEFAULT_SOURCE_UA, code: row.code || null };
}

export async function refreshSource(db, env, id, uaOverride) {
    const src = await getSource(db, env, id);
    if (!src) return null;
    const ua = typeof uaOverride === 'string' && uaOverride.trim() ? uaOverride.trim().slice(0, 64) : src.ua;
    const { content, headers } = await fetchSourceContent(src.url, ua);
    const { encKey } = await getKeys(env);
    const blob = await encryptBlob({ url: src.url, content, headers }, encKey);
    const now = Date.now();
    await db.prepare('UPDATE sub_sources SET blob = ?, fetched_at = ?, ua = ? WHERE id = ?').bind(blob, now, ua, id).run();
    return { id, name: src.name, fetchedAt: now, ua };
}

export async function deleteSource(db, id) {
    await ensureSourceTable(db);
    await db.prepare('DELETE FROM sub_sources WHERE id = ?').bind(id).run();
}

// 修改名称与订阅代码：均可选传；code 显式传空串表示清除，未传（undefined/null）表示不动
export async function renameSource(db, env, id, name, code) {
    const src = await getSource(db, env, id);
    if (!src) return null;
    const updates = {};
    if (typeof name === 'string' && name.trim()) {
        updates.name = name.trim().slice(0, 30);
    }
    if (code !== undefined && code !== null) {
        const cleanCode = normalizeSourceCode(code);
        if (cleanCode) await assertCodeAvailable(db, cleanCode, id);
        updates.code = cleanCode;
    }
    if (!updates.name && !('code' in updates)) throw new Error('请提供要修改的名称或订阅代码');
    if (updates.name && 'code' in updates) {
        await db.prepare('UPDATE sub_sources SET name = ?, code = ? WHERE id = ?').bind(updates.name, updates.code, id).run();
    } else if (updates.name) {
        await db.prepare('UPDATE sub_sources SET name = ? WHERE id = ?').bind(updates.name, id).run();
    } else {
        await db.prepare('UPDATE sub_sources SET code = ? WHERE id = ?').bind(updates.code, id).run();
    }
    return { id, name: updates.name || src.name, code: 'code' in updates ? updates.code : src.code };
}
