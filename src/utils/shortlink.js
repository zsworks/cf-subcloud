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

    // 保存配置：POST /api/short，body 为完整 URL 参数 JSON
    if (request.method === 'POST' && path === '/api/short') {
        if (!bucket) throw new Error('短链接功能未启用：未绑定 R2 存储');
        const params = await request.json();
        if (!params || typeof params !== 'object' || !params.target || !params.url) {
            throw new Error('无效的配置参数');
        }
        const code = generateCode();
        const body = JSON.stringify({ version: 1, created: Date.now(), params });
        await bucket.put(KEY_PREFIX + code, body, { httpMetadata: { contentType: 'application/json' } });
        return jsonResponse({ success: true, code });
    }

    // 访问短链接：GET /s/{code}，从 R2 取回参数并走正常转换流程
    const match = path.match(/^\/s\/([A-Za-z0-9]{4,16})$/);
    if (match) {
        if (!bucket) throw new Error('短链接功能未启用：未绑定 R2 存储');
        const obj = await bucket.get(KEY_PREFIX + match[1]);
        if (!obj) return jsonResponse({ success: false, error: '短链接不存在' }, 404);
        const { params } = await obj.json();
        const qs = new URLSearchParams(params).toString();
        const fullUrl = new URL(`/?${qs}`, url.origin);
        const newRequest = new Request(fullUrl, request);
        const e = buildConfig(newRequest, env, false);
        const result = await handleRequest(e);
        return new Response(result.body, {
            status: result.status,
            headers: result.headers,
        });
    }

    return null;
}
