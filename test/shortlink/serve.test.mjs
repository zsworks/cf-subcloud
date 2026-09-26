import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockD1, createEnv, SAMPLE_B64_SUB } from './helpers.mjs';
import { saveLink, serveLink } from '../../src/utils/shortlink/links.js';
import { saveSource, getSource, refreshSource, deleteSource } from '../../src/utils/shortlink/sources.js';
import { getKeys, encryptBlob, decryptBlob } from '../../src/utils/shortlink/crypto.js';

const realFetch = global.fetch;

function b64Key(pw) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(pw)));
}

// 测试内统一替换上游 fetch：订阅主机返回样例节点，其余（规则模板等）返回 template
async function stubUpstream(t, { template = 'rules: []' } = {}) {
    global.fetch = async (url) => {
        const u = new URL(url);
        if (u.hostname.endsWith('.example') || u.hostname === 'example.com') {
            return new Response(SAMPLE_B64_SUB, { status: 200, headers: { 'subscription-userinfo': 'upload=0; total=100; expire=2000000000' } });
        }
        return new Response(template, { status: 200, headers: { 'Content-Type': 'text/yaml' } });
    };
    t.after(() => {
        global.fetch = realFetch;
    });
}

async function seedCachedLink(db, env, { srcUrl = 'https://a.example/sub' } = {}) {
    const src = await saveSource(db, env, srcUrl, 'A');
    const r = await saveLink(db, env, { sources: [src.id], rawUrls: [], target: 'mihomo', params: { template: '/test.yaml' }, key: 'pw' });
    return { src, code: r.code };
}

// 手动为短链写入生成缓存（content + srcFetched 快照）
async function writeCache(db, env, code, fetchedMap, content = 'CACHED-CONTENT') {
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKey);
    const withCache = { ...obj, content, textHeaders: { 'Content-Type': 'text/yaml' }, srcFetched: fetchedMap };
    await db.prepare('UPDATE short_links SET blob = ? WHERE code = ?').bind(await encryptBlob(withCache, encKey), code).run();
}

test('缺少 key 参数 → 400 提示', async (t) => {
    await stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const { code } = await seedCachedLink(db, env);
    const resp = await serveLink(new Request(`https://w.worker/s/${code}`), env, code, null);
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /key=访问口令/);
});

test('口令错误 → 400；口令正确 + 缓存新鲜 → 直接返回缓存且不触网', async (t) => {
    await stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedCachedLink(db, env);
    const fetchedMap = { [src.id]: (await getSource(db, env, src.id)).fetchedAt };
    await writeCache(db, env, code, fetchedMap);

    const bad = await serveLink(new Request(`https://w.worker/s/${code}?key=${b64Key('bad')}`), env, code, b64Key('bad'));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /访问口令错误/);

    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        return new Response('x', { status: 200 });
    };
    const resp = await serveLink(new Request(`https://w.worker/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'));
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), 'CACHED-CONTENT');
    assert.equal(resp.headers.get('Content-Type'), 'text/yaml');
    assert.equal(fetchCalled, false);
});

test('源刷新后缓存失效 → 重新生成并回写新缓存', async (t) => {
    const template = await readFile('test/Mihomo.yaml', 'utf8');
    await stubUpstream(t, { template });
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedCachedLink(db, env);
    const fetched0 = (await getSource(db, env, src.id)).fetchedAt;
    await writeCache(db, env, code, { [src.id]: fetched0 });

    // 刷新源 → fetched_at 变化 → 缓存失效
    await refreshSource(db, env, src.id);
    const resp = await serveLink(new Request(`https://w.worker/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'));
    const body = await resp.text();
    assert.equal(resp.status, 200, '重新生成应成功，body=' + body.slice(0, 300));
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKey);
    assert.ok(obj.content && obj.content !== 'CACHED-CONTENT', '应回写新生成内容');
    assert.ok(obj.srcFetched[src.id] > fetched0, '快照应更新');
    // 流量信息头来自源缓存 headers
    assert.equal(resp.headers.get('subscription-userinfo'), 'upload=0; total=100; expire=2000000000');
});

test('源已删除且无缓存 → 明确报错', async (t) => {
    await stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedCachedLink(db, env);
    await deleteSource(db, src.id);
    const resp = await serveLink(new Request(`https://w.worker/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'));
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /原始订阅已删除/);
});

test('源已删除但有缓存 → 缓存仍可服务', async (t) => {
    await stubUpstream(t);
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedCachedLink(db, env);
    const fetched0 = (await getSource(db, env, src.id)).fetchedAt;
    await writeCache(db, env, code, { [src.id]: fetched0 });
    await deleteSource(db, src.id);
    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        return new Response('x', { status: 200 });
    };
    const resp = await serveLink(new Request(`https://w.worker/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'));
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), 'CACHED-CONTENT');
    assert.equal(fetchCalled, false);
});
