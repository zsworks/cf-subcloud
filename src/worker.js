import { buildConfig } from './utils/env.js';
import { handleRequest } from './utils/handler.js';
import { handleShortLink } from './utils/shortlink/index.js';
import { configureRelay } from './utils/relayFetch.js';
import { configureAssetFetcher } from './utils/assetsFetch.js';

export default {
    async fetch(request, env) {
        try {
            configureRelay(env);
            if (env?.ASSETS) configureAssetFetcher((path) => env.ASSETS.fetch(new Request('https://assets.local' + path)));
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
