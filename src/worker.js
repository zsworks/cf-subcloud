import { buildConfig } from './utils/env.js';
import { handleRequest } from './utils/handler.js';
import { getFakePage } from './core/page/page.js';
import { handleShortLink } from './utils/shortlink/index.js';
import { configureRelay } from './utils/relayFetch.js';
import { configureAssetFetcher } from './utils/assetsFetch.js';

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
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                });
            }

            const short = await handleShortLink(request, env);
            if (short) return short;

            const e = buildConfig(request, env, false);
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
