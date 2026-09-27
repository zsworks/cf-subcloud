import { getmihomo_config } from '../core/mihomo/index.js';
import { getsingbox_config } from '../core/singbox/index.js';
import { getv2ray_config } from '../core/v2ray/index.js';
import { getFakePage } from '../core/page/page.js';

export async function handleRequest(e) {
    if (e.target) {
        let result;

        switch (e.target) {
            case 'singbox':
                result = await getsingbox_config(e);
                break;
            case 'mihomo':
                result = await getmihomo_config(e);
                break;
            case 'v2ray':
                result = await getv2ray_config(e);
                break;
            default:
                throw new Error('Invalid config type');
        }
        const headers = new Headers(result.headers);
        headers.set('Content-Type', 'application/json; charset=utf-8');
        headers.set('Profile-web-page-url', e.url.origin);

        return {
            status: result.status || 200,
            headers: headers,
            body: result.data,
        };
    }

    const html = await getFakePage(e);

    return {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
        },
        body: html,
    };
}
