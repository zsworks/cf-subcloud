import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchResponse } from '../../src/utils/fetchResponse.js';
import { configureRelay } from '../../src/utils/relayFetch.js';

const RELAY = 'https://relay.example/api/relay';

function captureFetch(responses) {
    const calls = [];
    let i = 0;
    global.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        const r = responses[Math.min(i++, responses.length - 1)];
        return typeof r === 'function' ? r(calls[calls.length - 1]) : r;
    };
    return calls;
}

test('未配置中转时保持直连', async (t) => {
    const real = global.fetch;
    t.after(() => {
        global.fetch = real;
        configureRelay(null);
    });
    configureRelay(null);
    const calls = captureFetch([new Response('ok', { status: 200 })]);
    const r = await fetchResponse('https://up.example/sub', 'ua-test');
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://up.example/sub');
});

test('配置中转后经 relay 拉取并携带令牌', async (t) => {
    const real = global.fetch;
    t.after(() => {
        global.fetch = real;
        configureRelay(null);
    });
    configureRelay({ FETCH_RELAY_URL: RELAY, FETCH_RELAY_TOKEN: 'tok-1' });
    const calls = captureFetch([
        new Response('clash-yaml', { status: 200, headers: { 'content-type': 'text/yaml', 'subscription-userinfo': 'upload=1' } }),
    ]);
    const r = await fetchResponse('https://up.example/sub', 'clash-verge/2.0');
    assert.equal(calls.length, 1);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, RELAY);
    assert.equal(u.searchParams.get('url'), 'https://up.example/sub');
    assert.equal(u.searchParams.get('ua'), 'clash-verge/2.0');
    assert.equal(calls[0].init.headers['x-relay-token'], 'tok-1');
    assert.equal(r.status, 200);
    assert.equal(r.data, 'clash-yaml');
    assert.equal(r.headers['subscription-userinfo'], 'upload=1');
});

test('中转故障（x-relay-error）时回退直连', async (t) => {
    const real = global.fetch;
    t.after(() => {
        global.fetch = real;
        configureRelay(null);
    });
    configureRelay({ FETCH_RELAY_URL: RELAY, FETCH_RELAY_TOKEN: 'tok-1' });
    const calls = captureFetch([
        new Response('{"error":"relay: bad"}', { status: 502, headers: { 'x-relay-error': '1' } }),
        new Response('direct-ok', { status: 200 }),
    ]);
    const r = await fetchResponse('https://up.example/sub', 'ua-test');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.startsWith(RELAY));
    assert.equal(calls[1].url, 'https://up.example/sub');
    assert.equal(r.status, 200);
    assert.equal(r.data, 'direct-ok');
});

test('中转不可达（网络错误）时回退直连；上游403经中转原样返回不回退', async (t) => {
    const real = global.fetch;
    t.after(() => {
        global.fetch = real;
        configureRelay(null);
    });
    configureRelay({ FETCH_RELAY_URL: RELAY, FETCH_RELAY_TOKEN: 'tok-1' });

    // 网络错误回退
    let i = 0;
    const calls = [];
    global.fetch = async (url) => {
        calls.push(String(url));
        if (i++ === 0) throw new TypeError('fetch failed');
        return new Response('fallback', { status: 200 });
    };
    const r1 = await fetchResponse('https://up.example/sub', 'ua');
    assert.equal(r1.data, 'fallback');
    assert.equal(calls.length, 2);

    // 上游 403 经中转返回：不算中转故障，不回退
    global.fetch = async () => new Response('blocked', { status: 403 });
    const r2 = await fetchResponse('https://up.example/sub', 'ua');
    assert.equal(r2.status, 403);
});
