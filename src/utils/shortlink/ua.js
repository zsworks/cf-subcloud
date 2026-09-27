// 拉取订阅上游时按客户端类型使用的 UA（机场后端普遍按 UA 嗅探返回格式：
// clash UA 返回 YAML，v2ray 类 UA 返回 base64 节点列表）
export const UA_MAP = {
    mihomo: 'clash-verge/2.0',
    singbox: 'sing-box/1.12.0',
    v2ray: 'v2rayN/6.0',
};

// 原始订阅入库的默认 UA（历史行/未指定 target 时）：base64 兼容性最好
export const DEFAULT_SOURCE_UA = 'v2ray';

export function resolveSourceUa(target) {
    return UA_MAP[target] || DEFAULT_SOURCE_UA;
}
