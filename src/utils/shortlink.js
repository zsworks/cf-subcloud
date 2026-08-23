import { buildConfig } from './env.js';
import { handleRequest } from './handler.js';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 8;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
// PBKDF2 迭代次数（与前端 page.js 保持一致）
const PBKDF2_ITERATIONS = 100000;

// 各 target 对应的合法客户端 UA（绕过 CHECKUA 校验）
const UA_MAP = { mihomo: 'clash-verge/2.0', singbox: 'sing-box/1.12.0', v2ray: 'v2rayN/6.0' };

let tableReady = false;
// 惰性建表（每个 isolate 仅一次）；除短码与创建时间外全部信息加密存于 blob
async function ensureTable(db) {
    if (tableReady) return;
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS short_links (
        code TEXT PRIMARY KEY,
        salt TEXT NOT NULL,
        blob TEXT NOT NULL,
        created INTEGER NOT NULL
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

// 强密钥 = PBKDF2(密钥, 随机盐, 高迭代)
async function deriveStrongKey(passphrase, saltBytes) {
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        256,
    );
    return new Uint8Array(bits);
}

async function encryptBlob(obj, passphrase, saltBytes) {
    const strongKey = await deriveStrongKey(passphrase, saltBytes);
    const key = await crypto.subtle.importKey('raw', strongKey, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), IV_LENGTH);
    return bytesToBase64(combined);
}

async function decryptBlob(blobB64, passphrase, saltB64) {
    const combined = base64ToBytes(blobB64);
    const iv = combined.subarray(0, IV_LENGTH);
    const data = combined.subarray(IV_LENGTH);
    const strongKey = await deriveStrongKey(passphrase, base64ToBytes(saltB64));
    const key = await crypto.subtle.importKey('raw', strongKey, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(new TextDecoder().decode(plain));
}

// 短链接路由（CF Workers 专用，依赖 D1 绑定 SHORT_LINK）
// 非本模块路由返回 null，交回主流程
export async function handleShortLink(request, env) {
    const db = env?.SHORT_LINK;
    const url = new URL(request.url);
    const path = url.pathname;

    // 保存订阅内容（加密）：POST /api/short，body {url: 完整订阅地址, key: 加密密钥, label?: 备注, code?}
    if (request.method === 'POST' && path === '/api/short') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        await ensureTable(db);
        const { url: sourceUrl, key, label, code: existingCode } = await request.json();
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

        // 全部信息（参数/内容/响应头/备注）加密为单一 blob，随机盐 PBKDF2 派生强密钥
        const blobObj = {
            version: 2,
            target: params.target,
            params,
            content,
            textHeaders: Object.fromEntries(new Headers(result.headers)),
            label: typeof label === 'string' && label.trim() ? label.trim() : null,
        };
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
        const blob = await encryptBlob(blobObj, String(key), salt);

        let code = generateCode();
        if (existingCode) {
            if (!/^[A-Za-z0-9]{4,16}$/.test(String(existingCode))) throw new Error('无效的短码');
            code = existingCode;
        }
        await db
            .prepare(
                `INSERT INTO short_links (code, salt, blob, created) VALUES (?, ?, ?, ?)
                 ON CONFLICT(code) DO UPDATE SET salt = excluded.salt, blob = excluded.blob`,
            )
            .bind(code, bytesToBase64(salt), blob, Date.now())
            .run();
        return jsonResponse({ success: true, code });
    }

    // 已保存列表：GET /api/short/list?page=&limit=（页码分页；仅返回短码与创建时间，其余均加密）
    if (request.method === 'GET' && path === '/api/short/list') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        await ensureTable(db);
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 5, 1), 20);
        const page = Math.max(parseInt(url.searchParams.get('page')) || 1, 1);
        const { total } = await db.prepare('SELECT COUNT(*) AS total FROM short_links').first();
        const rows = await db
            .prepare('SELECT code, created FROM short_links ORDER BY created DESC, code LIMIT ? OFFSET ?')
            .bind(limit, (page - 1) * limit)
            .all();
        return jsonResponse({ success: true, items: rows.results || [], page, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
    }

    // 取单条密文（前端本地解密用）：GET /api/short/get?code=
    if (request.method === 'GET' && path === '/api/short/get') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        await ensureTable(db);
        const code = url.searchParams.get('code') || '';
        if (!/^[A-Za-z0-9]{4,16}$/.test(code)) throw new Error('无效的短码');
        const row = await db.prepare('SELECT salt, blob FROM short_links WHERE code = ?').bind(code).first();
        if (!row) return jsonResponse({ success: false, error: '短链接不存在' }, 404);
        return jsonResponse({ success: true, code, salt: row.salt, blob: row.blob });
    }

    // 访问短链接：GET /s/{code}?key=解密密钥
    const match = path.match(/^\/s\/([A-Za-z0-9]{4,16})$/);
    if (match) {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        await ensureTable(db);
        const row = await db.prepare('SELECT salt, blob FROM short_links WHERE code = ?').bind(match[1]).first();
        if (!row) return jsonResponse({ success: false, error: '短链接不存在' }, 404);
        const keyParam = url.searchParams.get('key');
        if (!keyParam) return jsonResponse({ success: false, error: '该订阅内容已加密，请在短链接后附加 ?key=解密密钥' }, 400);
        try {
            // key 为密钥的 base64 编码（URL 传输中 + 会被解码为空格，需还原）
            const key = new TextDecoder().decode(base64ToBytes(keyParam.replace(/ /g, '+')));
            const obj = await decryptBlob(row.blob, key, row.salt);
            const headers = new Headers(obj.textHeaders || {});
            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
            return new Response(obj.content, { status: 200, headers });
        } catch {
            return jsonResponse({ success: false, error: '解密密钥错误' }, 400);
        }
    }

    return null;
}
