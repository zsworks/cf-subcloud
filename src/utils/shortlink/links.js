import { buildConfig } from '../env.js';
import { handleRequest } from '../handler.js';
import { getKeys, encryptBlob, decryptBlob, hmacB64url, timingSafeEqual, base64ToBytes, md5Hex, canonicalStringify } from './crypto.js';
import { getSource, refreshSource } from './sources.js';
import { UA_MAP } from './ua.js';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 8;
// UA_MAP：各 target 对应的合法客户端 UA（绕过 CHECKUA 校验），定义见 ua.js
// 源 id 为 base64url(HMAC-SHA256) = 43 字符
const ID_RE = /^[A-Za-z0-9_-]{40,64}$/;

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS short_links (
        code TEXT PRIMARY KEY,
        blob TEXT NOT NULL,
        pw_hash TEXT NOT NULL,
        created INTEGER NOT NULL,
        url_md5 TEXT
    )`;
// 查重唯一索引：同内容订阅只存一行，SQLite 允许多个 NULL（存量旧行不受影响）
const MD5_INDEX_SQL = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_short_links_url_md5 ON short_links(url_md5)';

const readyDbs = new WeakSet();
// 惰性建表（按 db 实例记忆）；旧表探测迁移：缺 pw_hash 列 DROP 重建（设计确认清空重建），
// 缺 url_md5 列 ALTER 补列后建唯一索引
export async function ensureShortLinkTable(db) {
    if (readyDbs.has(db)) return;
    await db.prepare(CREATE_SQL).run();
    try {
        await db.prepare('SELECT pw_hash FROM short_links LIMIT 1').first();
    } catch {
        await db.prepare('DROP TABLE short_links').run();
        await db.prepare(CREATE_SQL).run();
    }
    try {
        await db.prepare('SELECT url_md5 FROM short_links LIMIT 1').first();
    } catch {
        await db.prepare('ALTER TABLE short_links ADD COLUMN url_md5 TEXT').run();
    }
    await db.prepare(MD5_INDEX_SQL).run();
    readyDbs.add(db);
}

export function generateCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    let code = '';
    for (const b of bytes) {
        code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
    return code;
}

async function pwHash(pw, hmacKey) {
    return hmacB64url(String(pw), hmacKey);
}

async function verifyPw(rowPwHash, pw, hmacKey) {
    return timingSafeEqual(await pwHash(pw, hmacKey), rowPwHash);
}

export async function saveLink(db, env, body = {}) {
    await ensureShortLinkTable(db);
    // key 可选：不传即无口令短链（内容仍由服务端密钥加密，访问 /s/{code} 免 key）
    const { sources, rawUrls, target, params = {}, label, key, code: existingCode, oldKey } = body;
    if (!target) throw new Error('缺少 target 参数');
    const hasPw = typeof key === 'string' && key.trim().length > 0;
    const srcIds = Array.isArray(sources) ? sources.map(String).filter((s) => ID_RE.test(s)) : [];
    const raws = Array.isArray(rawUrls) ? rawUrls.map(String).filter((u) => /^https?:\/\//.test(u)) : [];
    if (!srcIds.length && !raws.length) throw new Error('至少需要一个订阅来源');

    const { encKey, hmacKey } = await getKeys(env);
    let code = generateCode();
    if (existingCode) {
        if (!/^[A-Za-z0-9]{4,16}$/.test(String(existingCode))) throw new Error('无效的短码');
        code = existingCode;
        const oldRow = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
        if (!oldRow) return { notFound: true };
        // 仅带口令的行需要 oldKey 验证
        if (oldRow.pw_hash && (!oldKey || !(await verifyPw(oldRow.pw_hash, oldKey, hmacKey)))) {
            throw new Error('更新失败：需要提供该订阅的原始口令');
        }
    }

    // 内容查重键：规范化序列化（键序无关）后取 MD5；label/口令/缓存内容不参与，
    // 是否带口令参与（避免无口令保存命中带口令短码后无法访问）；同配置即同一条
    const urlMd5 = await md5Hex(canonicalStringify({ target, params, sources: srcIds, rawUrls: raws, pw: hasPw }));
    const dup = await db.prepare('SELECT code, pw_hash FROM short_links WHERE url_md5 = ? LIMIT 1').bind(urlMd5).first();
    if (dup?.code && dup.code !== code) {
        // 更新成与其他行相同的内容：删除本行，复用既有短码
        if (existingCode) {
            await db.prepare('DELETE FROM short_links WHERE code = ?').bind(code).run();
        }
        return {
            code: dup.code,
            reused: true,
            keyMatches: dup.pw_hash ? await verifyPw(dup.pw_hash, key || '', hmacKey) : true,
        };
    }

    const blobObj = {
        version: 3,
        target,
        params,
        sources: srcIds,
        rawUrls: raws,
        label: typeof label === 'string' && label.trim() ? label.trim() : null,
    };
    const blob = await encryptBlob(blobObj, encKey);
    try {
        await db
            .prepare(
                `INSERT INTO short_links (code, blob, pw_hash, created, url_md5) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(code) DO UPDATE SET blob = excluded.blob, pw_hash = excluded.pw_hash, url_md5 = excluded.url_md5`,
            )
            .bind(code, blob, hasPw ? await pwHash(key, hmacKey) : '', Date.now(), urlMd5)
            .run();
    } catch (err) {
        // 并发下唯一索引兜底：他人已插入同内容行，同样复用
        if (!/UNIQUE/i.test(String(err?.message))) throw err;
        const winner = await db.prepare('SELECT code, pw_hash FROM short_links WHERE url_md5 = ? LIMIT 1').bind(urlMd5).first();
        if (!winner?.code) throw err;
        return { code: winner.code, reused: true, keyMatches: winner.pw_hash ? await verifyPw(winner.pw_hash, key || '', hmacKey) : true };
    }
    return { code };
}

export async function listLinks(db, env, page = 1, limit = 5) {
    await ensureShortLinkTable(db);
    const { total } = await db.prepare('SELECT COUNT(*) AS total FROM short_links').first();
    const rows = await db
        .prepare('SELECT code, created, pw_hash FROM short_links ORDER BY created DESC, code LIMIT ? OFFSET ?')
        .bind(limit, (page - 1) * limit)
        .all();
    const { encKeys } = await getKeys(env);
    const items = [];
    for (const r of rows.results || []) {
        let label = null;
        try {
            const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(r.code).first();
            label = (await decryptBlob(row.blob, encKeys)).label ?? null;
        } catch {
            // 单条解密失败不影响列表
        }
        items.push({ code: r.code, created: r.created, label, protected: Boolean(r.pw_hash) });
    }
    return { items, page, total, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

export async function getLink(db, env, code, key) {
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return { notFound: true };
    const { encKey, hmacKey, encKeys } = await getKeys(env);
    // 无口令行免验证；带口令行必须验证
    if (row.pw_hash && !(await verifyPw(row.pw_hash, key || '', hmacKey))) throw new Error('访问口令错误');
    const obj = await decryptBlob(row.blob, encKeys);
    const sources = await Promise.all(
        (obj.sources || []).map(async (id) => {
            const s = await getSource(db, env, id);
            return { id, name: s?.name ?? null };
        }),
    );
    return { target: obj.target, params: obj.params || {}, sources, rawUrls: obj.rawUrls || [], label: obj.label ?? null, protected: Boolean(row.pw_hash) };
}

export async function deleteLink(db, env, code, key) {
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return { notFound: true };
    const { hmacKey } = await getKeys(env);
    if (row.pw_hash && !(await verifyPw(row.pw_hash, key || '', hmacKey))) throw new Error('访问口令错误');
    await db.prepare('DELETE FROM short_links WHERE code = ?').bind(code).run();
    return true;
}

function jsonError(message, status) {
    return new Response(JSON.stringify({ success: false, error: message }), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

// 访问短链接：GET /s/{code}?key=口令base64；短链仅存 URL 参数，每次访问实时重新生成。
// generator 仅供测试注入以绕开 Sub-Store 重依赖，生产用默认 handleRequest
export async function serveLink(request, env, code, keyB64, generator = handleRequest) {
    const db = env?.SHORT_LINK;
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return jsonError('短链接不存在', 404);
    // 无口令行免 key 直接访问；带口令行必须携带 ?key=
    if (row.pw_hash) {
        if (!keyB64) return jsonError('该订阅内容已加密，请在短链接后附加 ?key=访问口令的base64编码', 400);
        const { encKey, hmacKey } = await getKeys(env);
        // key 为口令的 base64 编码（URL 传输中 + 会被解码为空格，需还原）
        const pw = new TextDecoder().decode(base64ToBytes(keyB64.replace(/ /g, '+')));
        if (!(await verifyPw(row.pw_hash, pw, hmacKey))) return jsonError('访问口令错误', 400);
    }
    const { encKeys } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKeys);

    // 收集源缓存内容；源已删除则无法重新生成
    const items = [];
    const srcHeaders = [];
    for (const id of obj.sources || []) {
        let s = await getSource(db, env, id);
        if (!s) return jsonError('原始订阅已删除，无法重新生成', 400);
        if (!s.content) {
            await refreshSource(db, env, id);
            s = await getSource(db, env, id);
        }
        items.push(s.content);
        srcHeaders.push(s.headers);
    }
    items.push(...(obj.rawUrls || []));

    // 生成请求携带除 url 外的全部参数，覆写 e.urls 注入源缓存内容（绕过 URL 逗号拆分）
    const origin = new URL(request.url).origin;
    const qs = new URLSearchParams({ ...(obj.params || {}), target: obj.target });
    const genRequest = new Request(new URL(`/?${qs}`, origin), {
        method: 'GET',
        headers: { 'User-Agent': UA_MAP[obj.target] || 'clash-verge/2.0' },
    });
    const e = buildConfig(genRequest, env, false);
    e.urls = items;
    const result = await generator(e);
    if ((result.status || 200) !== 200) {
        return new Response(result.body, { status: result.status, headers: result.headers });
    }
    const content = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    const textHeaders = Object.fromEntries(new Headers(result.headers));
    // 流量信息头优先取源缓存
    const userinfo = srcHeaders.map((h) => h && h['subscription-userinfo']).find(Boolean);
    if (userinfo) textHeaders['subscription-userinfo'] = userinfo;
    return new Response(content, { status: 200, headers: new Headers(textHeaders) });
}
