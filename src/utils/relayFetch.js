// 出站中转配置：部分机场封禁 Cloudflare 出口 IP（403/挂起），订阅拉取可改经
// Vercel 中转（relay/ 目录，独立部署）。配置 FETCH_RELAY_URL / FETCH_RELAY_TOKEN
// 两个环境变量即启用；不配置保持直连。中转自身故障时自动回退直连。
let relayConfig = null;

export function configureRelay(env) {
    const raw = typeof env?.FETCH_RELAY_URL === 'string' ? env.FETCH_RELAY_URL.trim() : '';
    relayConfig = /^https?:\/\//.test(raw)
        ? { base: raw.replace(/\/+$/, ''), token: typeof env.FETCH_RELAY_TOKEN === 'string' ? env.FETCH_RELAY_TOKEN : '' }
        : null;
}

export function getRelayConfig() {
    return relayConfig;
}
