import { fetchWithFallback } from './fetchResponse.js';
import { getNodeConversion } from './substore.js';
/**
 * 订阅转换
 *
 * 根据订阅类型选择不同处理方式：
 * - sub 为真：直接通过 fetchWithFallback 获取订阅内容
 * - sub 为假：加载 Node 转换模块进行节点转换
 *
 * @param {string|string[]} urls - 订阅地址，可以是单个 URL 或 URL 数组
 * @param {string} userAgent - 请求 User-Agent
 * @param {boolean} fallback - 是否启用备用请求方式
 * @param {boolean} sub - 是否为普通订阅模式
 * @param {string} target - 转换目标格式（如 clash、singbox 等）
 * @param {boolean} heruser - 获取流量信息
 * @param {Array<string>|null} namePrefixes - 与 urls 平行的节点名前缀（src 直链的订阅代码）
 * @returns {Promise<any>} 处理后的订阅结果
 */
export async function processSubscription(urls, userAgent, sub, target, heruser = false, namePrefixes = null) {
    if (sub) {
        return await fetchWithFallback(urls, { userAgent, sub, target, heruser });
    }

    const proce = await getNodeConversion();
    return await proce(urls, target, true, heruser, namePrefixes);
}
