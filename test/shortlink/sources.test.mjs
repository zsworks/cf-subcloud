import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockD1, createEnv, SAMPLE_B64_SUB } from './helpers.mjs';
import { saveSource, listSources, getSource, refreshSource, deleteSource } from '../../src/utils/shortlink/sources.js';
import { getKeys, hmacB64url } from '../../src/utils/shortlink/crypto.js';

const URL_A = 'https://airport-a.example/sub?token=aaa';
const URL_B = 'https://airport-b.example/sub?token=bbb';

function stubFetch(contentByHost, headers = {}) {
    return async (url) => {
        const u = new URL(url);
        if (!(u.hostname in contentByHost)) return new Response('not found', { status: 404 });
        return new Response(contentByHost[u.hostname], { status: 200, headers });
    };
}

test('saveSource 拉取并加密入库；listSources 不含 URL', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB });

    const db = createMockD1();
    const env = createEnv(db);
    const { id, name } = await saveSource(db, env, URL_A, '机场A');
    const { hmacKey } = await getKeys(env);
    assert.equal(id, await hmacB64url(URL_A, hmacKey));
    assert.equal(name, '机场A');

    const items = await listSources(db);
    assert.equal(items.length, 1);
    assert.deepEqual(Object.keys(items[0]).sort(), ['fetchedAt', 'id', 'name']);

    const src = await getSource(db, env, id);
    assert.equal(src.url, URL_A);
    assert.equal(src.content, SAMPLE_B64_SUB);
    assert.equal(src.name, '机场A');
});

test('saveSource 上游失败时抛错且不入库', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = async () => new Response('err', { status: 503 });

    const db = createMockD1();
    await assert.rejects(() => saveSource(db, createEnv(db), URL_A, '机场A'), /拉取原始订阅失败/);
    assert.equal((await listSources(db)).length, 0);
});

test('同 URL 重复保存 = 改名 + 刷新内容（upsert 不新增行）', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB });

    const db = createMockD1();
    const env = createEnv(db);
    const r1 = await saveSource(db, env, URL_A, '机场A');
    const r2 = await saveSource(db, env, URL_A, '新名字');
    assert.equal(r1.id, r2.id);
    assert.equal((await listSources(db)).length, 1);
    assert.equal((await listSources(db))[0].name, '新名字');
});

test('refreshSource 更新内容与 fetched_at；deleteSource 删除', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB });
    const db = createMockD1();
    const env = createEnv(db);
    const { id } = await saveSource(db, env, URL_A, '机场A');
    const before = (await getSource(db, env, id)).fetchedAt;

    await new Promise((r) => setTimeout(r, 5));
    const r = await refreshSource(db, env, id);
    assert.equal(r.id, id);
    assert.ok(r.fetchedAt > before);
    assert.equal((await getSource(db, env, id)).fetchedAt, r.fetchedAt);

    await deleteSource(db, id);
    assert.equal(await getSource(db, env, id), null);
    assert.equal(await refreshSource(db, env, id), null);
});

test('不同 URL 的 id 不同（去重键正确）', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB, 'airport-b.example': SAMPLE_B64_SUB });
    const db = createMockD1();
    const env = createEnv(db);
    const a = await saveSource(db, env, URL_A, 'A');
    const b = await saveSource(db, env, URL_B, 'B');
    assert.notEqual(a.id, b.id);
    assert.equal((await listSources(db)).length, 2);
});

test('saveSource 按客户端类型使用对应 UA；refresh 沿用入库 UA；未指定走默认', async (t) => {
    const realFetch = global.fetch;
    const seenUas = [];
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = async (url, init = {}) => {
        seenUas.push(init.headers?.['User-Agent'] || null);
        return new Response(SAMPLE_B64_SUB, { status: 200 });
    };

    const db = createMockD1();
    const env = createEnv(db);

    // 未指定 target：默认 v2ray
    const r1 = await saveSource(db, env, URL_A, '机场A');
    // mihomo：clash UA
    const r2 = await saveSource(db, env, URL_B, '机场B', 'clash-verge/2.0');
    assert.deepEqual(seenUas, ['v2ray', 'clash-verge/2.0']);
    assert.equal((await getSource(db, env, r1.id)).ua, 'v2ray');
    assert.equal((await getSource(db, env, r2.id)).ua, 'clash-verge/2.0');

    // 刷新沿用各自入库的 UA
    await refreshSource(db, env, r2.id);
    assert.equal(seenUas[2], 'clash-verge/2.0');
});

test('旧表（无 ua 列）自动补列迁移', async () => {
    const db = createMockD1({ legacySources: true });
    // 触发 ensureSourceTable：探测失败 → ALTER 补列 → 正常工作
    const items = await listSources(db);
    assert.deepEqual(items, []);
});
