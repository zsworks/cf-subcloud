import { saveSource, listSources, refreshSource, deleteSource } from './sources.js';
import { saveLink, listLinks, getLink, clearLink, serveLink } from './links.js';
import { base64ToBytes } from './crypto.js';

const ID_RE = /^[A-Za-z0-9_-]{40,64}$/;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

function notFound(message) {
    return jsonResponse({ success: false, error: message }, 404);
}

// 短链接与原始订阅库路由（CF Workers 专用，依赖 D1 绑定 SHORT_LINK 与环境变量 LINK_ENC_KEY）
// 非本模块路由返回 null，交回主流程
export async function handleShortLink(request, env) {
    const db = env?.SHORT_LINK;
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/source/save' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { url: sourceUrl, name } = await request.json();
        if (!sourceUrl || !/^https?:\/\//.test(String(sourceUrl))) throw new Error('无效的订阅地址');
        const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 30) : '';
        if (!cleanName) throw new Error('请输入订阅名称');
        const r = await saveSource(db, env, String(sourceUrl), cleanName);
        return jsonResponse({ success: true, ...r });
    }
    if (path === '/api/source/list' && request.method === 'GET') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        return jsonResponse({ success: true, items: await listSources(db) });
    }
    if (path === '/api/source/refresh' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { id } = await request.json();
        if (!id || !ID_RE.test(String(id))) throw new Error('无效的订阅 ID');
        const r = await refreshSource(db, env, String(id));
        if (!r) return notFound('原始订阅不存在');
        return jsonResponse({ success: true, ...r });
    }
    if (path === '/api/source/delete' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { id } = await request.json();
        if (!id || !ID_RE.test(String(id))) throw new Error('无效的订阅 ID');
        await deleteSource(db, String(id));
        return jsonResponse({ success: true });
    }
    if (path.startsWith('/api/source/')) return notFound('未知接口');

    if (path === '/api/short' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const r = await saveLink(db, env, await request.json());
        if (r.notFound) return notFound('短链接不存在');
        return jsonResponse({ success: true, code: r.code });
    }
    if (path === '/api/short/list' && request.method === 'GET') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 5, 1), 20);
        const page = Math.max(parseInt(url.searchParams.get('page')) || 1, 1);
        const r = await listLinks(db, env, page, limit);
        return jsonResponse({ success: true, ...r });
    }
    if (path === '/api/short/get' && request.method === 'GET') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const code = url.searchParams.get('code') || '';
        const keyB64 = url.searchParams.get('key') || '';
        if (!/^[A-Za-z0-9]{4,16}$/.test(code)) throw new Error('无效的短码');
        if (!keyB64) throw new Error('缺少访问口令');
        // key 为口令的 base64 编码（URL 传输中 + 会被解码为空格，需还原）
        const pw = new TextDecoder().decode(base64ToBytes(keyB64.replace(/ /g, '+')));
        const r = await getLink(db, env, code, pw);
        if (r.notFound) return notFound('短链接不存在');
        return jsonResponse({ success: true, code, ...r });
    }
    if (path === '/api/short/clear' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { code, key } = await request.json();
        if (!code || !/^[A-Za-z0-9]{4,16}$/.test(String(code))) throw new Error('无效的短码');
        if (!key) throw new Error('缺少访问口令');
        const r = await clearLink(db, env, String(code), String(key));
        if (r.notFound) return notFound('短链接不存在');
        return jsonResponse({ success: true });
    }
    if (path.startsWith('/api/short/')) return notFound('未知接口');

    const match = path.match(/^\/s\/([A-Za-z0-9]{4,16})$/);
    if (match) {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        return serveLink(request, env, match[1], url.searchParams.get('key'));
    }

    return null;
}
