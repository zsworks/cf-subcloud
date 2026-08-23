import { buildConfig } from './env.js';
import { handleRequest } from './handler.js';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 8;
const KEY_PREFIX = 'sub/';

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

// 短链接路由（CF Workers 专用，依赖 R2 绑定 SHORT_LINK）
// 非本模块路由返回 null，交回主流程
export async function handleShortLink(request, env) {
    const bucket = env?.SHORT_LINK;
    const url = new URL(request.url);
    const path = url.pathname;

    // 保存配置：POST /api/short，body 为完整 URL 参数 JSON；带 code 时更新原短码
    if (request.method === 'POST' && path === '/api/short') {
        if (!bucket) throw new Error('短链接功能未启用：未绑定 R2 存储');
        const { code: existingCode, ...params } = await request.json();
        if (!params || typeof params !== 'object' || !params.target || !params.url) {
            throw new Error('无效的配置参数');
        }
        let code = generateCode();
        if (existingCode) {
            if (!/^[A-Za-z0-9]{4,16}$/.test(String(existingCode))) throw new Error('无效的短码');
            code = existingCode;
        }
        const body = JSON.stringify({ version: 1, created: Date.now(), params });
        await bucket.put(KEY_PREFIX + code, body, { httpMetadata: { contentType: 'application/json' } });
        return jsonResponse({ success: true, code });
    }

    // 已保存列表：GET /api/short/list?cursor=&limit=（游标分页）
    if (request.method === 'GET' && path === '/api/short/list') {
        if (!bucket) throw new Error('短链接功能未启用：未绑定 R2 存储');
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 5, 1), 20);
        const cursor = url.searchParams.get('cursor') || undefined;
        const listed = await bucket.list({ prefix: KEY_PREFIX, limit, cursor });
        const items = [];
        for (const obj of listed.objects) {
            const data = await bucket.get(obj.key);
            if (!data) continue;
            const { params, created, text } = await data.json();
            items.push({ code: obj.key.slice(KEY_PREFIX.length), target: params.target, created, params, cached: !!text });
        }
        return jsonResponse({ success: true, items, hasMore: listed.truncated, nextCursor: listed.cursor || null });
    }

    // 清除订阅内容：POST /api/short/clear，body {code}，删除 text 字段（下次访问重新生成）
    if (request.method === 'POST' && path === '/api/short/clear') {
        if (!bucket) throw new Error('短链接功能未启用：未绑定 R2 存储');
        const { code } = await request.json();
        if (!code || !/^[A-Za-z0-9]{4,16}$/.test(String(code))) throw new Error('无效的短码');
        const obj = await bucket.get(KEY_PREFIX + code);
        if (!obj) return jsonResponse({ success: false, error: '短链接不存在' }, 404);
        const stored = await obj.json();
        const { text, ...rest } = stored;
        await bucket.put(KEY_PREFIX + code, JSON.stringify(rest), { httpMetadata: { contentType: 'application/json' } });
        return jsonResponse({ success: true });
    }

    // 访问短链接：GET /s/{code}，从 R2 取回参数并走正常转换流程
    const match = path.match(/^\/s\/([A-Za-z0-9]{4,16})$/);
    if (match) {
        if (!bucket) throw new Error('短链接功能未启用：未绑定 R2 存储');
        const obj = await bucket.get(KEY_PREFIX + match[1]);
        if (!obj) return jsonResponse({ success: false, error: '短链接不存在' }, 404);
        const stored = await obj.json();
        const { params, text, textHeaders } = stored;

        // R2 已有订阅信息则直接返回缓存
        if (text) {
            const headers = new Headers(textHeaders || {});
            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
            return new Response(text, { status: 200, headers });
        }

        const qs = new URLSearchParams(params).toString();
        const fullUrl = new URL(`/?${qs}`, url.origin);
        const newRequest = new Request(fullUrl, request);
        const e = buildConfig(newRequest, env, false);
        const result = await handleRequest(e);

        // 生成成功时，把订阅信息与响应头写回 R2（下次访问直接使用缓存）
        if ((result.status || 200) === 200) {
            const generated = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
            await bucket.put(
                KEY_PREFIX + match[1],
                JSON.stringify({ ...stored, text: generated, textHeaders: Object.fromEntries(new Headers(result.headers)) }),
                { httpMetadata: { contentType: 'application/json' } },
            );
        }

        return new Response(result.body, {
            status: result.status,
            headers: result.headers,
        });
    }

    return null;
}
