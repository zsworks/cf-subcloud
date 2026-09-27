// Vercel 出站中转：代替 Cloudflare Worker 拉取订阅上游。
// 部分机场/订阅转换站封禁 Cloudflare 出口 IP 段（403/挂起），Vercel 出口不在其列。
// 鉴权：x-relay-token 头（或 ?token=）须与服务端环境变量 RELAY_TOKEN 一致。
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 25000;
// 透传给调用方的上游响应头
const PASS_HEADERS = ['content-type', 'subscription-userinfo', 'content-disposition', 'profile-update-interval', 'profile-web-page-url'];

function relayError(res, status, message) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('x-relay-error', '1');
    res.statusCode = status;
    res.end(JSON.stringify({ error: message }));
}

// 常数时间令牌比较（先哈希对齐长度，避免时序泄漏）
function tokenOk(received, expected) {
    if (!expected) return false;
    const a = crypto.createHash('sha256').update(String(received ?? '')).digest();
    const b = crypto.createHash('sha256').update(String(expected)).digest();
    return crypto.timingSafeEqual(a, b);
}

function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return (
            a === 0 || a === 10 || a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168)
        );
    }
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
}

// 拒绝解析到内网/链路本地地址的目标（SSRF 防护）
async function assertPublicHost(hostname) {
    if (net.isIP(hostname)) {
        if (isPrivateIp(hostname)) throw new Error(`拒绝内网地址：${hostname}`);
        return;
    }
    const name = hostname.toLowerCase();
    if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.internal')) {
        throw new Error(`拒绝内网主机：${hostname}`);
    }
    const addrs = await dns.lookup(hostname, { all: true, verbatim: true });
    if (addrs.some((a) => isPrivateIp(a.address))) {
        throw new Error(`拒绝解析到内网的地址：${hostname}`);
    }
}

// 手动跟随重定向并逐跳复查目标（防 DNS 重绑定绕过）
async function fetchGuarded(urlStr, init, depth = 0) {
    const u = new URL(urlStr);
    if (!/^https?:$/.test(u.protocol)) throw new Error('仅支持 http/https');
    if (u.username || u.password) throw new Error('不支持带凭据的 URL');
    await assertPublicHost(u.hostname);
    const res = await fetch(u, { ...init, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location') && depth < MAX_REDIRECTS) {
        res.body?.cancel?.();
        return fetchGuarded(new URL(res.headers.get('location'), u).href, init, depth + 1);
    }
    return res;
}

async function readBodyJson(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (!chunks.length) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        return {};
    }
}

export default async function handler(req, res) {
    const reqUrl = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'POST') {
        return relayError(res, 405, 'relay: 仅支持 GET/POST');
    }
    const token = req.headers['x-relay-token'] || reqUrl.searchParams.get('token') || '';
    if (!tokenOk(token, process.env.RELAY_TOKEN)) {
        return relayError(res, 401, 'relay: 令牌无效');
    }

    let target = reqUrl.searchParams.get('url');
    let ua = reqUrl.searchParams.get('ua');
    if (!target && req.method === 'POST') {
        const body = await readBodyJson(req);
        target = typeof body.url === 'string' ? body.url : '';
        ua = typeof body.ua === 'string' ? body.ua : ua;
    }
    if (!target) return relayError(res, 400, 'relay: 缺少 url 参数');

    try {
        const upstream = await fetchGuarded(target, { headers: { 'user-agent': ua || DEFAULT_UA } }, 0);
        const headers = {};
        for (const h of PASS_HEADERS) {
            const v = upstream.headers.get(h);
            if (v) headers[h] = v;
        }
        // 暴露上游真实状态，便于调用方诊断 WAF 拦截
        res.setHeader('x-relay-upstream-status', String(upstream.status));
        const body = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, headers);
        res.end(body);
    } catch (err) {
        relayError(res, 502, `relay: ${err?.message || '拉取失败'}`);
    }
}
