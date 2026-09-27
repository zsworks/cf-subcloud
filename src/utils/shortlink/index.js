import { saveSource, importSource, listSources, refreshSource, deleteSource } from './sources.js';
import { saveLink, listLinks, getLink, clearLink, deleteLink, serveLink } from './links.js';
import { base64ToBytes } from './crypto.js';
import { resolveSourceUa } from './ua.js';
import { getRelayConfig } from '../relayFetch.js';

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

// 中转链路诊断：token=中转令牌；返回 worker → relay 一跳的真实结果
async function debugRelay(url) {
    const cfg = getRelayConfig();
    if (!cfg) return jsonResponse({ relay: false, note: '未配置 FETCH_RELAY_URL' });
    const token = url.searchParams.get('token') || '';
    if (token !== cfg.token) return jsonResponse({ error: 'token mismatch' }, 401);
    const target = url.searchParams.get('url') || 'https://api.xmancdn.net/osubscribe.php?token2=dq36w6my-b83a21c49emcjjefmz&sip002=1';
    const u = new URL(cfg.base);
    u.searchParams.set('url', target);
    u.searchParams.set('ua', 'clash-verge/2.0');
    try {
        const res = await fetch(u, { method: 'GET', headers: { 'x-relay-token': cfg.token } });
        const body = (await res.text()).slice(0, 100);
        return jsonResponse({
            relayBase: cfg.base,
            status: res.status,
            xRelayError: res.headers.get('x-relay-error'),
            upstreamStatus: res.headers.get('x-relay-upstream-status'),
            server: res.headers.get('server'),
            body,
        });
    } catch (err) {
        return jsonResponse({ relayBase: cfg.base, threw: String(err?.message || err), cause: String(err?.cause?.message || '') });
    }
}

// 短链接与原始订阅库路由（CF Workers 专用，依赖 D1 绑定 SHORT_LINK 与环境变量 LINK_ENC_KEY）
// 非本模块路由返回 null，交回主流程
export async function handleShortLink(request, env) {
    const db = env?.SHORT_LINK;
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/debug/relay' && request.method === 'GET') {
        return debugRelay(url);
    }

    if (path === '/api/source/save' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { url: sourceUrl, name, target } = await request.json();
        if (!sourceUrl || !/^https?:\/\//.test(String(sourceUrl))) throw new Error('无效的订阅地址');
        const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 30) : '';
        if (!cleanName) throw new Error('请输入订阅名称');
        // 按当前客户端类型选择拉取 UA（白名单映射，未知 target 走默认）
        const r = await saveSource(db, env, String(sourceUrl), cleanName, resolveSourceUa(typeof target === 'string' ? target : ''));
        return jsonResponse({ success: true, ...r });
    }
    // 本机导入：内容由调用方在自己网络拉取后推送（适配封禁数据中心出口的机场）
    if (path === '/api/source/import' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const adminToken = env?.ADMIN_TOKEN;
        if (!adminToken || request.headers.get('x-admin-token') !== adminToken) {
            return notFound('未授权');
        }
        const { url: sourceUrl, name, target, content, headers } = await request.json();
        if (!sourceUrl || !/^https?:\/\//.test(String(sourceUrl))) throw new Error('无效的订阅地址');
        const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 30) : '';
        if (!cleanName) throw new Error('请输入订阅名称');
        const r = await importSource(db, env, String(sourceUrl), cleanName, resolveSourceUa(typeof target === 'string' ? target : ''), String(content || ''), typeof headers === 'object' && headers ? headers : {});
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
    if (path === '/api/short/delete' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { code, key } = await request.json();
        if (!code || !/^[A-Za-z0-9]{4,16}$/.test(String(code))) throw new Error('无效的短码');
        if (!key) throw new Error('缺少访问口令');
        const r = await deleteLink(db, env, String(code), String(key));
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
