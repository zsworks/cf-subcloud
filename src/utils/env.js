import { splitUrlsAndProxies, backimg, beiantext, beiandizi, isUrl } from './index.js';
import { ASSET_MARKER } from './assetsFetch.js';
export function buildConfig(request, env, isNode = false) {
    const url = isNode ? new URL(request.url, `http://${request.headers.host}`) : new URL(request.url);

    const getHeader = (key) => {
        if (isNode) {
            return request.headers[key.toLowerCase()];
        }
        return request.headers.get(key);
    };

    const getParam = (key) => url.searchParams.get(key);

    const getParamBool = (key) => getParam(key) === 'true';
    const getEnv = (key, fallback) => {
        if (isNode) {
            return process.env[key] ?? fallback;
        }
        return env?.[key] ?? fallback;
    };
    const data = {};
    data.url = url;
    data.userAgent = getHeader('User-Agent');

    const urlParam = getParam('url');
    if (urlParam && urlParam.trim()) {
        data.urls = splitUrlsAndProxies(urlParam.split(',').map((u) => u.trim()));
    }
    // 按名称直连原始订阅库（worker 端解析为库内缓存内容）
    const srcParam = getParam('src');
    if (srcParam && srcParam.trim()) {
        data.src = srcParam.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const target = getParam('target');
    if (target) data.target = target;
    const log = getParam('log');
    if (log) data.log = log;

    if (getParamBool('udp')) data.udp = true;
    if (getParamBool('udp_frag')) data.udp_fragment = true;
    if (getParamBool('tls_frag')) data.tls_fragment = true;
    if (getParamBool('ep')) data.exclude_package = true;
    if (getParamBool('ea')) data.exclude_address = true;
    if (getParamBool('tailscale')) data.tailscale = true;
    if (getParamBool('bridge')) data.bridge = true;
    if (getParamBool('adgdns')) data.adgdns = true;
    if (getParamBool('tun')) data.tun = true;
    if (getParamBool('ech')) data.ech = true;
    if (getParamBool('relay')) data.relay = true;
    if (getParamBool('heruser')) data.heruser = true;
    if (getParamBool('nodelist')) data.nodelist = true;
    if (getParamBool('ipv6')) data.ipv6 = true;

    data.IMG = getEnv('IMG', backimg);
    data.sub = getEnv('SUB', null);
    data.beian = getEnv('BEIAN', beiantext);
    data.beianurl = getEnv('BEIANURL', beiandizi);
    data.checkUA = getEnv('CHECKUA', true);
    data.tplmh = getEnv('TPLMH', null);
    data.tplmh = data.tplmh
        ? data.tplmh
              .replace(/\\n/g, '\n')
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
        : null;
    data.tplsb = getEnv('TPLSB', null);
    data.tplsb = data.tplsb
        ? data.tplsb
              .replace(/\\n/g, '\n')
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
        : null;

    const templateBaseUrl = getEnv('TEMPLATE_URL', '');
    if (templateBaseUrl) data.templateBaseUrl = templateBaseUrl;
    const template = getParam('template');
    if (template && !isUrl(template)) {
        if (templateBaseUrl) {
            data.rule = `${templateBaseUrl}/${data.target}${template}`;
        } else if (isNode) {
            data.rule = `${url.origin}/template/${data.target}${template}`;
        } else {
            // CF Worker：静态模板经 ASSETS 绑定进程内读取（subrequest 自域名会被 Bot 防护挑战）
            data.rule = `${ASSET_MARKER}/${data.target}${template}`;
        }
    } else {
        data.rule = template;
    }

    return data;
}
