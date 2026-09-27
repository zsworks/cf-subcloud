import YAML from 'yaml';
import { buildApiUrl } from './ApiUrl.js';
import { getRelayConfig } from './relayFetch.js';
import { ASSET_MARKER, getAssetFetcher } from './assetsFetch.js';

/**
 * 请求 URL 并解析响应数据。
 *
 * 自动处理 YAML、JSON 和纯文本格式，
 * 并过滤 hop-by-hop 响应头。
 *
 * @param {string} url - 请求地址
 * @param {string} [userAgent] - 请求 User-Agent
 * @returns {Promise<{
 *   status: number,
 *   headers: Object,
 *   data: Object|string|null,
 *   error?: Error
 * }>} 请求结果
 */
// 经 Vercel 中转拉取；中转自身故障（不可达 / x-relay-error）时返回 null 由调用方回退直连，
// 上游真实响应状态（含 403）原样返回不回退
async function fetchViaRelay(url, userAgent) {
    const { base, token } = getRelayConfig();
    try {
        const u = new URL(base);
        u.searchParams.set('url', url);
        u.searchParams.set('ua', userAgent);
        const res = await fetch(u, {
            method: 'GET',
            headers: { 'x-relay-token': token },
        });
        if (res.headers.get('x-relay-error')) {
            console.error('中转返回错误，回退直连:', url);
            return null;
        }
        return res;
    } catch (error) {
        console.error('中转不可达，回退直连:', url, error?.message);
        return null;
    }
}

async function fetchResponse(url, userAgent) {
    if (!userAgent) {
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';
    }
    let response = null;
    if (String(url).startsWith(ASSET_MARKER)) {
        const fetchAsset = getAssetFetcher();
        if (fetchAsset) {
            response = await fetchAsset(String(url).slice(ASSET_MARKER.length));
        } else {
            return { status: 0, headers: {}, data: null, error: new Error('ASSETS 绑定不可用') };
        }
    }
    if (!response) response = getRelayConfig() ? await fetchViaRelay(url, userAgent) : null;
    if (!response) {
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': userAgent,
                },
            });
        } catch (error) {
            console.error(error);
            return {
                status: 0,
                headers: {},
                data: null,
                error,
            };
        }
    }
    const rawHeaders = Object.fromEntries(response.headers.entries());
    const viaRelay = rawHeaders['x-relay-upstream-status'] !== undefined;
    const hopByHopHeaders = ['transfer-encoding', 'content-length', 'content-encoding', 'connection'];
    const headers = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
        if (!hopByHopHeaders.includes(key.toLowerCase())) {
            headers[key] = value;
        }
    }
    const textData = await response.text();
    let data;

    try {
        data = YAML.parse(textData, { maxAliasCount: -1, merge: true });
    } catch {
        try {
            data = JSON.parse(textData);
        } catch {
            data = textData;
        }
    }

    return {
        status: response.status,
        headers,
        data,
        via: viaRelay ? 'relay' : 'direct',
    };
}

/**
 * 尝试请求订阅原始 URL。
 * 当启用 fallback 且原始请求结果不符合目标格式时，
 * 使用构建后的 API URL 重新请求。
 *
 * @param {string[]} urls - 订阅源 URL 列表
 * @param {Object} [options={}] - 请求配置
 * @param {string} [options.userAgent] - 请求 User-Agent
 * @param {string} [options.sub] - API 订阅参数
 * @param {string} [options.target] - 目标格式，如 mihomo、singbox
 * @returns {Promise<{
 *   status: number,
 *   headers: Object,
 *   data: Object|string|null
 * }>} 请求响应结果
 */
async function fetchWithFallback(urls, options = {}) {
    const { sub = '', target = '', userAgent, heruser } = options;
    const apiUrl = buildApiUrl(urls, sub, target, heruser);
    return await fetchResponse(apiUrl, userAgent);
}
export { fetchResponse, fetchWithFallback };
