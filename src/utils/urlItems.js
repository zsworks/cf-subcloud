const PROXY_URI_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * 拆分输入项：仅当逗号拼接的每一段都是 URL 或代理 URI（scheme://）时才按逗号拆分
 * （兼容旧的逗号拼接输入）；缓存的订阅内容（YAML 等含逗号）必须整体保留
 * @param {string[]|string} urls 输入项
 * @returns {string[]}
 */
export function splitInputItems(urls) {
    return (Array.isArray(urls) ? urls : [urls]).flatMap((item) => {
        if (typeof item !== 'string' || !item.includes(',')) return [item];
        const parts = item.split(',');
        return parts.every((p) => {
            const t = p.trim();
            return t && PROXY_URI_RE.test(t);
        })
            ? parts
            : [item];
    });
}
