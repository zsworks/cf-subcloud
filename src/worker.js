import { buildConfig } from './utils/env.js';
import { handleRequest } from './utils/handler.js';
import { getFakePage } from './core/page/page.js';
import { handleShortLink } from './utils/shortlink/index.js';
import { configureRelay } from './utils/relayFetch.js';
import { configureAssetFetcher } from './utils/assetsFetch.js';
import { listSources, getSource } from './utils/shortlink/sources.js';
import { ASSET_MARKER } from './utils/assetsFetch.js';

export default {
    async fetch(request, env) {
        try {
            configureRelay(env);
            if (env?.ASSETS) configureAssetFetcher((path) => env.ASSETS.fetch(new Request('https://assets.local' + path)));

            // 独立列表页：/saved 已保存订阅、/sources 原始订阅库
            const { pathname } = new URL(request.url);
            if (pathname === '/saved' || pathname === '/sources') {
                const e = buildConfig(request, env, false);
                e.view = pathname === '/saved' ? 'saved' : 'sources';
                const html = await getFakePage(e);
                return new Response(html, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
                });
            }

            const short = await handleShortLink(request, env);
            if (short) return short;

            const e = buildConfig(request, env, false);

            // src=名称1,名称2 直链：按名称解析原始订阅库，直接用库内加密缓存转换。
            // 名称即凭据，不做客户端 UA 校验；未指定模板时用内置默认模板
            if (e.src) {
                const db = env?.SHORT_LINK;
                if (!db) throw new Error('原始订阅库未启用：未绑定 D1 数据库');
                const items = await listSources(db);
                const byName = new Map(items.map((i) => [i.name, i.id]));
                const contents = [];
                for (const name of e.src) {
                    const sid = byName.get(name);
                    if (!sid) throw new Error(`原始订阅库中未找到「${name}」，请确认名称（区分大小写）`);
                    contents.push((await getSource(db, env, sid)).content);
                }
                e.urls = contents;
                e.checkUA = false;
                const target = String(e.target || '').toLowerCase();
                if (!e.rule && ['mihomo', 'singbox'].includes(target)) {
                    e.rule = `${ASSET_MARKER}/${target}/ACL4SSR_Online_Full.yaml`;
                }
            }

            const result = await handleRequest(e);

            return new Response(result.body, {
                status: result.status,
                headers: result.headers,
            });
        } catch (err) {
            return new Response(JSON.stringify(err.message), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                },
            });
        }
    },
};
