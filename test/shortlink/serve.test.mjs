import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockD1, createEnv, SAMPLE_B64_SUB } from './helpers.mjs';
import { saveLink, serveLink } from '../../src/utils/shortlink/links.js';
import { saveSource, deleteSource } from '../../src/utils/shortlink/sources.js';
import { getKeys, encryptBlob, decryptBlob } from '../../src/utils/shortlink/crypto.js';

const realFetch = global.fetch;

function b64Key(pw) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(pw)));
}

// saveSource 入库需要真实拉取上游，统一替换为样例订阅
function stubUpstream(t) {
    global.fetch = async (url) => {
        const u = new URL(url);
        if (u.hostname.endsWith('.example') || u.hostname === 'example.com') {
            return new Response(SAMPLE_B64_SUB, { status: 200, headers: { 'subscription-userinfo': 'upload=0; total=100; expire=2000000000' } });
        }
        return new Response('rules: []', { status: 200, headers: { 'Content-Type': 'text/yaml' } });
    };
    t.after(() => {
        global.fetch = realFetch;
    });
}

async function seedLink(db, env, { srcUrl = 'https://a.example/sub' } = {}) {
    const src = await saveSource(db, env, srcUrl, 'A');
    const r = await saveLink(db, env, { sources: [src.id], rawUrls: [], target: 'mihomo', params: { template: '/test.yaml' }, key: 'pw' });
    return { src, code: r.code };
}

// 测试用生成器：记录每次调用，返回可断言的确定性内容（真实生成链路依赖 Sub-Store，仅生产可用）
function makeFakeGenerator() {
    const calls = [];
    const fake = async (e) => {
        calls.push(e);
        return { status: 200, body: `GENERATED:${(e.urls || []).join('|')}:tpl=${e.rule || ''}`, headers: { 'Content-Type': 'text/yaml' } };
    };
    fake.calls = calls;
    return fake;
}

test('缺少 key 参数 → 400 提示', async (t) => {
    stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const { code } = await seedLink(db, env);
    const resp = await serveLink(new Request(`https://w.worker/s/${code}`), env, code, null, makeFakeGenerator());
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /key=访问口令/);
});

test('无口令短链：不带 key 直接实时生成；带口令行不受影响', async (t) => {
    stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const src = await saveSource(db, env, 'https://a.example/sub', 'A');
    const r = await saveLink(db, env, { sources: [src.id], rawUrls: [], target: 'mihomo', params: { template: '/test.yaml' } });
    assert.equal(await getLinkRowPwHash(db, r.code), '');

    const gen = makeFakeGenerator();
    // 不带 key 直接访问
    const resp = await serveLink(new Request(`https://w.worker/s/${r.code}`), env, r.code, null, gen);
    assert.equal(resp.status, 200);
    assert.ok((await resp.text()).startsWith('GENERATED:'));
    assert.equal(gen.calls.length, 1);
    // 带 key 访问也无妨（无口令行忽略 key）
    const resp2 = await serveLink(new Request(`https://w.worker/s/${r.code}?key=${b64Key('whatever')}`), env, r.code, b64Key('whatever'), gen);
    assert.equal(resp2.status, 200);
});

// 读取短链行的 pw_hash（无口令行应为空串哨兵）
async function getLinkRowPwHash(db, code) {
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    return row.pw_hash;
}

test('口令错误 → 400；口令正确 → 每次实时生成并携带参数与来源', async (t) => {
    stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const { code } = await seedLink(db, env);
    const url = `https://w.worker/s/${code}?key=${b64Key('pw')}`;

    const bad = await serveLink(new Request(url), env, code, b64Key('bad'), makeFakeGenerator());
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /访问口令错误/);

    const gen = makeFakeGenerator();
    const resp = await serveLink(new Request(url), env, code, b64Key('pw'), gen);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('Content-Type'), 'text/yaml');
    // 流量信息头来自源缓存
    assert.equal(resp.headers.get('subscription-userinfo'), 'upload=0; total=100; expire=2000000000');
    // 生成请求注入了来源内容与短链参数（模板走 ASSET_MARKER 路径）
    assert.equal(gen.calls.length, 1);
    assert.ok(typeof gen.calls[0].urls[0] === 'string' && gen.calls[0].urls[0].length > 0, '来源内容应注入 urls');
    assert.ok(String(gen.calls[0].rule).includes('/mihomo/test.yaml'), '模板参数应解析为生成地址');

    // 第二次访问再次实时生成（无缓存）
    await serveLink(new Request(url), env, code, b64Key('pw'), gen);
    assert.equal(gen.calls.length, 2);

    // 访问后 blob 仍只含 URL 参数，不落任何内容缓存
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKey);
    assert.equal(obj.content, undefined);
    assert.equal(obj.srcFetched, undefined);
    assert.equal(obj.textHeaders, undefined);
});

test('遗留缓存字段（旧版本写入）被忽略，不做缓存服务', async (t) => {
    stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const { code } = await seedLink(db, env);
    // 模拟旧版本写入的遗留缓存字段
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKey);
    await db
        .prepare('UPDATE short_links SET blob = ? WHERE code = ?')
        .bind(await encryptBlob({ ...obj, content: 'STALE-CACHED', textHeaders: { 'Content-Type': 'text/yaml' }, srcFetched: {} }, encKey), code)
        .run();

    const gen = makeFakeGenerator();
    const resp = await serveLink(new Request(`https://w.worker/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'), gen);
    const body = await resp.text();
    assert.equal(resp.status, 200);
    assert.ok(body.startsWith('GENERATED:'), '遗留缓存应被忽略，实时重新生成');
    assert.equal(gen.calls.length, 1);
});

test('源已删除 → 明确报错', async (t) => {
    stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedLink(db, env);
    await deleteSource(db, src.id);
    const resp = await serveLink(new Request(`https://w.worker/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'), makeFakeGenerator());
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /原始订阅已删除/);
});
