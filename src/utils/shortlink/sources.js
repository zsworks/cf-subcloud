import YAML from 'yaml';
import { fetchResponse } from '../fetchResponse.js';
import { getKeys, encryptBlob, decryptBlob, hmacB64url } from './crypto.js';

const readyDbs = new WeakSet();
// 惰性建表（按 db 实例记忆）；URL 与上游内容全部加密存于 blob，仅名称与时间明文
export async function ensureSourceTable(db) {
    if (readyDbs.has(db)) return;
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS sub_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        blob TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
    )`,
        )
        .run();
    readyDbs.add(db);
}

// 实时拉上游（v2ray UA，base64 兼容性最好）；失败 throw，调用方不入库
async function fetchSourceContent(url) {
    const res = await fetchResponse(url, 'v2ray');
    if (!res || res.error) throw new Error(`拉取原始订阅失败：${res?.error?.message || '网络错误'}`);
    if (res.status !== 200 || !res.data) throw new Error(`拉取原始订阅失败：HTTP ${res.status || 0}`);
    const content = typeof res.data === 'string' ? res.data : YAML.stringify(res.data);
    return { content, headers: res.headers || {} };
}

export async function saveSource(db, env, url, name) {
    await ensureSourceTable(db);
    const srcUrl = new URL(url);
    const { content, headers } = await fetchSourceContent(srcUrl.href);
    const { encKey, hmacKey } = await getKeys(env);
    const id = await hmacB64url(srcUrl.href, hmacKey);
    const blob = await encryptBlob({ url: srcUrl.href, content, headers }, encKey);
    await db
        .prepare(
            `INSERT INTO sub_sources (id, name, blob, fetched_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, blob = excluded.blob, fetched_at = excluded.fetched_at`,
        )
        .bind(id, name, blob, Date.now())
        .run();
    return { id, name };
}

export async function listSources(db) {
    await ensureSourceTable(db);
    const rows = await db.prepare('SELECT id, name, fetched_at FROM sub_sources ORDER BY fetched_at DESC').all();
    return (rows.results || []).map((r) => ({ id: r.id, name: r.name, fetchedAt: r.fetched_at }));
}

export async function getSource(db, env, id) {
    await ensureSourceTable(db);
    const row = await db.prepare('SELECT * FROM sub_sources WHERE id = ?').bind(id).first();
    if (!row) return null;
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKey);
    return { id: row.id, name: row.name, url: obj.url, content: obj.content, headers: obj.headers || {}, fetchedAt: row.fetched_at };
}

export async function refreshSource(db, env, id) {
    const src = await getSource(db, env, id);
    if (!src) return null;
    const { content, headers } = await fetchSourceContent(src.url);
    const { encKey } = await getKeys(env);
    const blob = await encryptBlob({ url: src.url, content, headers }, encKey);
    const now = Date.now();
    await db.prepare('UPDATE sub_sources SET blob = ?, fetched_at = ? WHERE id = ?').bind(blob, now, id).run();
    return { id, name: src.name, fetchedAt: now };
}

export async function deleteSource(db, id) {
    await ensureSourceTable(db);
    await db.prepare('DELETE FROM sub_sources WHERE id = ?').bind(id).run();
}
