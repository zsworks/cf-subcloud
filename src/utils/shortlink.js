import { buildConfig } from './env.js';
import { handleRequest } from './handler.js';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 8;

// 各 target 对应的合法客户端 UA（绕过 CHECKUA 校验）
const UA_MAP = { mihomo: 'clash-verge/2.0', singbox: 'sing-box/1.12.0', v2ray: 'v2rayN/6.0' };

let tableReady = false;
// 惰性建表（每个 isolate 仅一次）
async function ensureTable(db) {
    if (tableReady) return;
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS short_links (
        code TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        params TEXT NOT NULL,
        sha1 TEXT,
        text TEXT,
        text_headers TEXT,
        encrypted INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
    )`,
        )
        .run();
    tableReady = true;
}

// 生成 base62 短码
function generateCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    let code = '';
    for (const b of bytes) {
        code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
    return code;
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function hexDigest(algo, text) {
    const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 强密钥 = SHA-256(密钥 与 订阅地址 SHA1 混合)
async function deriveStrongKey(userKey, sha1Hex) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userKey}:${sha1Hex}`));
    return new Uint8Array(buf);
}

// 短链接路由（CF Workers 专用，依赖 D1 绑定 SHORT_LINK）
// 非本模块路由返回 null，交回主流程
export async function handleShortLink(request, env) {
    const db = env?.SHORT_LINK;
    const url = new URL(request.url);
    const path = url.pathname;

    // 保存订阅内容（加密）：POST /api/short，body {url: 完整订阅地址, key: 加密密钥, code?}
    if (request.method === 'POST' && path === '/api/short') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        await ensureTable(db);
        const { url: sourceUrl, key, code: existingCode } = await request.json();
        if (!sourceUrl || !/^https?:\/\//.test(String(sourceUrl))) throw new Error('无效的订阅地址');
        if (!key) throw new Error('缺少加密密钥');

        let srcUrl;
        try {
            srcUrl = new URL(sourceUrl);
        } catch {
            throw new Error('无效的订阅地址');
        }
        const params = Object.fromEntries(srcUrl.searchParams);
        if (!params.target || !params.url) throw new Error('无效的配置参数');

        // 生成订阅内容（按 target 伪装合法 UA 以通过 CHECKUA）
        const headers = new Headers(request.headers);
        headers.set('User-Agent', UA_MAP[params.target] || 'clash-verge/2.0');
        const genRequest = new Request(srcUrl, { method: 'GET', headers });
        const e = buildConfig(genRequest, env, false);
        const result = await handleRequest(e);
        if ((result.status || 200) !== 200) {
            return new Response(result.body, { status: result.status, headers: result.headers });
        }
        const content = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);

        // SHA1(订阅地址) 另存一列；密钥与 SHA1 混合派生强密钥后 AES-GCM 加密
        const sha1Hex = await hexDigest('SHA-1', sourceUrl);
        const strongKey = await deriveStrongKey(String(key), sha1Hex);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cryptoKey = await crypto.subtle.importKey('raw', strongKey, 'AES-GCM', false, ['encrypt']);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(content));
        const combined = new Uint8Array(12 + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), 12);

        let code = generateCode();
        if (existingCode) {
            if (!/^[A-Za-z0-9]{4,16}$/.test(String(existingCode))) throw new Error('无效的短码');
            code = existingCode;
        }
        const now = Date.now();
        await db
            .prepare(
                `INSERT INTO short_links (code, target, params, sha1, text, text_headers, encrypted, created, updated)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                 ON CONFLICT(code) DO UPDATE SET
                    target = excluded.target, params = excluded.params, sha1 = excluded.sha1,
                    text = excluded.text, text_headers = excluded.text_headers,
                    encrypted = 1, updated = excluded.updated`,
            )
            .bind(
                code,
                params.target,
                JSON.stringify(params),
                sha1Hex,
                bytesToBase64(combined),
                JSON.stringify(Object.fromEntries(new Headers(result.headers))),
                now,
                now,
            )
            .run();
        return jsonResponse({ success: true, code });
    }

    // 已保存列表：GET /api/short/list?page=&limit=（页码分页，按创建时间倒序）
    if (request.method === 'GET' && path === '/api/short/list') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        await ensureTable(db);
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 5, 1), 20);
        const page = Math.max(parseInt(url.searchParams.get('page')) || 1, 1);
        const { total } = await db.prepare('SELECT COUNT(*) AS total FROM short_links').first();
        const rows = await db
            .prepare('SELECT code, target, params, encrypted, text, created FROM short_links ORDER BY created DESC, code LIMIT ? OFFSET ?')
            .bind(limit, (page - 1) * limit)
            .all();
        const items = (rows.results || []).map((row) => ({
            code: row.code,
            target: row.target,
            created: row.created,
            params: JSON.parse(row.params),
            encrypted: !!row.encrypted,
            cached: !!row.text && !row.encrypted,
        }));
        return jsonResponse({ success: true, items, page, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
    }

    // 清除订阅内容：POST /api/short/clear，body {code}，清空 text 缓存（下次访问重新生成）
    if (request.method === 'POST' && path === '/api/short/clear') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        await ensureTable(db);
        const { code } = await request.json();
        if (!code || !/^[A-Za-z0-9]{4,16}$/.test(String(code))) throw new Error('无效的短码');
        const row = await db.prepare('SELECT encrypted FROM short_links WHERE code = ?').bind(code).first();
        if (!row) return jsonResponse({ success: false, error: '短链接不存在' }, 404);
        if (row.encrypted) throw new Error('加密条目无缓存，不支持清除');
        await db.prepare('UPDATE short_links SET text = NULL, text_headers = NULL, updated = ? WHERE code = ?').bind(Date.now(), code).run();
        return jsonResponse({ success: true });
    }

    // 访问短链接：GET /s/{code}[?key=解密密钥]
    const match = path.match(/^\/s\/([A-Za-z0-9]{4,16})$/);
    if (match) {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        await ensureTable(db);
        const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(match[1]).first();
        if (!row) return jsonResponse({ success: false, error: '短链接不存在' }, 404);
        const params = JSON.parse(row.params);

        // 加密条目：密钥与 sha1 列混合派生强密钥解密
        if (row.encrypted) {
            const key = url.searchParams.get('key');
            if (!key) return jsonResponse({ success: false, error: '该订阅内容已加密，请在短链接后附加 ?key=解密密钥' }, 400);
            try {
                const combined = base64ToBytes(row.text);
                const iv = combined.subarray(0, 12);
                const data = combined.subarray(12);
                const strongKey = await deriveStrongKey(key, row.sha1);
                const cryptoKey = await crypto.subtle.importKey('raw', strongKey, 'AES-GCM', false, ['decrypt']);
                const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
                const content = new TextDecoder().decode(plain);
                const headers = new Headers(row.text_headers ? JSON.parse(row.text_headers) : {});
                if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
                return new Response(content, { status: 200, headers });
            } catch {
                return jsonResponse({ success: false, error: '解密密钥错误' }, 400);
            }
        }

        // 非加密条目：已有缓存则直接返回
        if (row.text) {
            const headers = new Headers(row.text_headers ? JSON.parse(row.text_headers) : {});
            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
            return new Response(row.text, { status: 200, headers });
        }

        const qs = new URLSearchParams(params).toString();
        const fullUrl = new URL(`/?${qs}`, url.origin);
        const newRequest = new Request(fullUrl, request);
        const e = buildConfig(newRequest, env, false);
        const result = await handleRequest(e);

        // 生成成功时，把订阅信息与响应头写回（下次访问直接使用缓存）
        if ((result.status || 200) === 200) {
            const generated = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
            await db
                .prepare('UPDATE short_links SET text = ?, text_headers = ?, updated = ? WHERE code = ?')
                .bind(generated, JSON.stringify(Object.fromEntries(new Headers(result.headers))), Date.now(), match[1])
                .run();
        }

        return new Response(result.body, {
            status: result.status,
            headers: result.headers,
        });
    }

    return null;
}
