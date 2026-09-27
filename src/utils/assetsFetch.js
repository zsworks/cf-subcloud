// 模板资源的进程内读取器（CF Workers 的 ASSETS 绑定）。
// worker 内部 subrequest 自己域名上的静态模板会被 zone 的 Bot 防护挑战，
// 改经 ASSETS.fetch 直接读资源，不经过网络。由 worker.js 注入。
let assetFetcher = null;

export function configureAssetFetcher(fn) {
    assetFetcher = typeof fn === 'function' ? fn : null;
}

export function getAssetFetcher() {
    return assetFetcher;
}

// fetchResponse 用该前缀识别"从静态资源读模板"的内部规则
export const ASSET_MARKER = '__asset__';
