import { buildConfig } from '../env.js';
import { handleRequest } from '../handler.js';
import { getKeys, encryptBlob, decryptBlob, hmacB64url, timingSafeEqual, base64ToBytes } from './crypto.js';
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
        created INTEGER NOT NULL
    )`;

const readyDbs = new WeakSet();
// 惰性建表（按 db 实例记忆）；旧表（无 pw_hash 列）探测到即 DROP 重建（设计确认清空重建）
export async function ensureShortLinkTable(db) {
    if (readyDbs.has(db)) return;
    await db.prepare(CREATE_SQL).run();
    try {
        await db.prepare('SELECT pw_hash FROM short_links LIMIT 1').first();
    } catch {
        await db.prepare('DROP TABLE short_links').run();
        await db.prepare(CREATE_SQL).run();
    }
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
    const { sources, rawUrls, target, params = {}, label, key, code: existingCode, oldKey } = body;
    if (!key) throw new Error('缺少访问口令');
    if (!target) throw new Error('缺少 target 参数');
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
        if (!oldKey || !(await verifyPw(oldRow.pw_hash, oldKey, hmacKey))) {
            throw new Error('更新失败：需要提供该订阅的原始口令');
        }
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
    await db
        .prepare(
            `INSERT INTO short_links (code, blob, pw_hash, created) VALUES (?, ?, ?, ?)
             ON CONFLICT(code) DO UPDATE SET blob = excluded.blob, pw_hash = excluded.pw_hash`,
        )
        .bind(code, blob, await pwHash(key, hmacKey), Date.now())
        .run();
    return { code };
}

export async function listLinks(db, env, page = 1, limit = 5) {
    await ensureShortLinkTable(db);
    const { total } = await db.prepare('SELECT COUNT(*) AS total FROM short_links').first();
    const rows = await db
        .prepare('SELECT code, created FROM short_links ORDER BY created DESC, code LIMIT ? OFFSET ?')
        .bind(limit, (page - 1) * limit)
        .all();
    const { encKey } = await getKeys(env);
    const items = [];
    for (const r of rows.results || []) {
        let label = null;
        try {
            const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(r.code).first();
            label = (await decryptBlob(row.blob, encKey)).label ?? null;
        } catch {
            // 单条解密失败不影响列表
        }
        items.push({ code: r.code, created: r.created, label });
    }
    return { items, page, total, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

export async function getLink(db, env, code, key) {
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return { notFound: true };
    const { encKey, hmacKey } = await getKeys(env);
    if (!(await verifyPw(row.pw_hash, key, hmacKey))) throw new Error('访问口令错误');
    const obj = await decryptBlob(row.blob, encKey);
    const sources = await Promise.all(
        (obj.sources || []).map(async (id) => {
            const s = await getSource(db, env, id);
            return { id, name: s?.name ?? null };
        }),
    );
    return { target: obj.target, params: obj.params || {}, sources, rawUrls: obj.rawUrls || [], label: obj.label ?? null, hasContent: Boolean(obj.content) };
}

export async function clearLink(db, env, code, key) {
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return { notFound: true };
    const { encKey, hmacKey } = await getKeys(env);
    if (!(await verifyPw(row.pw_hash, key, hmacKey))) throw new Error('访问口令错误');
    const obj = await decryptBlob(row.blob, encKey);
    delete obj.content;
    delete obj.textHeaders;
    delete obj.srcFetched;
    await db.prepare('UPDATE short_links SET blob = ? WHERE code = ?').bind(await encryptBlob(obj, encKey), code).run();
    return true;
}

// 生成缓存是否仍新鲜：srcFetched 快照与各源当前 fetched_at 一致；
// 源已删除（不在 fetchedMap）视为新鲜——已有缓存仍可服务
export function isCacheFresh(obj, fetchedMap) {
    if (!obj.content || !obj.srcFetched) return false;
    return (obj.sources || []).every((id) => {
        const current = fetchedMap[id];
        if (current === undefined) return true;
        return obj.srcFetched[id] === current;
    });
}

function jsonError(message, status) {
    return new Response(JSON.stringify({ success: false, error: message }), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

// 访问短链接：GET /s/{code}?key=口令base64；缓存新鲜直接返回，否则注入源缓存内容重新生成
export async function serveLink(request, env, code, keyB64) {
    const db = env?.SHORT_LINK;
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return jsonError('短链接不存在', 404);
    if (!keyB64) return jsonError('该订阅内容已加密，请在短链接后附加 ?key=访问口令的base64编码', 400);

    const { encKey, hmacKey } = await getKeys(env);
    // key 为口令的 base64 编码（URL 传输中 + 会被解码为空格，需还原）
    const pw = new TextDecoder().decode(base64ToBytes(keyB64.replace(/ /g, '+')));
    if (!(await verifyPw(row.pw_hash, pw, hmacKey))) return jsonError('访问口令错误', 400);
    const obj = await decryptBlob(row.blob, encKey);

    // 收集源缓存内容与当前 fetched_at；源已删除则跳过（不在 fetchedMap 中，
    // isCacheFresh 视为新鲜——已有缓存仍可服务，需重生成时再报错）
    const items = [];
    const srcHeaders = [];
    const fetchedMap = {};
    for (const id of obj.sources || []) {
        let s = await getSource(db, env, id);
        if (!s) continue;
        if (!s.content) {
            await refreshSource(db, env, id);
            s = await getSource(db, env, id);
        }
        items.push(s.content);
        srcHeaders.push(s.headers);
        fetchedMap[id] = s.fetchedAt;
    }
    items.push(...(obj.rawUrls || []));

    if (obj.content && isCacheFresh(obj, fetchedMap)) {
        const headers = new Headers(obj.textHeaders || {});
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
        return new Response(obj.content, { status: 200, headers });
    }

    // 需要重新生成：此时源被删除则无法继续
    if ((obj.sources || []).some((id) => !(id in fetchedMap))) {
        return jsonError('原始订阅已删除，无法重新生成', 400);
    }

    // 重新生成：内部请求携带除 url 外的全部参数，覆写 e.urls 注入缓存内容（绕过 URL 逗号拆分）
    const origin = new URL(request.url).origin;
    const qs = new URLSearchParams({ ...(obj.params || {}), target: obj.target });
    const genRequest = new Request(new URL(`/?${qs}`, origin), {
        method: 'GET',
        headers: { 'User-Agent': UA_MAP[obj.target] || 'clash-verge/2.0' },
    });
    const e = buildConfig(genRequest, env, false);
    e.urls = items;
    const result = await handleRequest(e);
    if ((result.status || 200) !== 200) {
        return new Response(result.body, { status: result.status, headers: result.headers });
    }
    const content = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    const textHeaders = Object.fromEntries(new Headers(result.headers));
    // 流量信息头优先取源缓存
    const userinfo = srcHeaders.map((h) => h && h['subscription-userinfo']).find(Boolean);
    if (userinfo) textHeaders['subscription-userinfo'] = userinfo;

    try {
        const blob = await encryptBlob({ ...obj, content, textHeaders, srcFetched: fetchedMap }, encKey);
        await db.prepare('UPDATE short_links SET blob = ? WHERE code = ?').bind(blob, code).run();
    } catch {
        // 回写失败不影响本次返回
    }
    return new Response(content, { status: 200, headers: new Headers(textHeaders) });
}
