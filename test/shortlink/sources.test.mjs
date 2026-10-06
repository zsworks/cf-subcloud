import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockD1, createEnv, SAMPLE_B64_SUB } from './helpers.mjs';
import { saveSource, listSources, getSource, refreshSource, deleteSource, renameSource } from '../../src/utils/shortlink/sources.js';
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
    assert.deepEqual(Object.keys(items[0]).sort(), ['code', 'fetchedAt', 'id', 'name']);
    assert.equal(items[0].code, null);

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

test('renameSource 改名不影响内容；空名报错；源不存在返回 null', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB });

    const db = createMockD1();
    const env = createEnv(db);
    const { id } = await saveSource(db, env, URL_A, '旧名字');
    const before = await getSource(db, env, id);

    const r = await renameSource(db, env, id, '  新名字  ');
    assert.equal(r.name, '新名字');
    const after = await getSource(db, env, id);
    assert.equal(after.name, '新名字');
    assert.equal(after.content, before.content, '改名不应触碰内容');

    await assert.rejects(() => renameSource(db, env, id, '   '), /请提供要修改的名称或订阅代码/);
    assert.equal(await renameSource(db, env, 'nonexistent', 'X'), null);
});

test('订阅代码：save 带 code 入库，listSources/getSource 返回 code', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB });

    const db = createMockD1();
    const env = createEnv(db);
    const saved = await saveSource(db, env, URL_A, '机场A', 'clash-verge/2.0', ' YT ');
    assert.equal(saved.code, 'YT');
    assert.equal((await listSources(db))[0].code, 'YT');
    assert.equal((await getSource(db, env, saved.id)).code, 'YT');
});

test('订阅代码全表唯一：跨订阅重复报错，同 URL 覆盖自身不受阻', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB, 'airport-b.example': SAMPLE_B64_SUB });

    const db = createMockD1();
    const env = createEnv(db);
    const a = await saveSource(db, env, URL_A, 'A', 'v2ray', 'YT');
    await assert.rejects(() => saveSource(db, env, URL_B, 'B', 'v2ray', 'YT'), /已被其它订阅使用/);
    // 同 URL 重存（同 id）：允许保留原代码
    const a2 = await saveSource(db, env, URL_A, 'A', 'v2ray', 'YT');
    assert.equal(a2.id, a.id);

    // rename 抢占他人代码同样报错
    const b = await saveSource(db, env, URL_B, 'B', 'v2ray', 'BB');
    await assert.rejects(() => renameSource(db, env, b.id, 'B', 'YT'), /已被其它订阅使用/);
    // 改成未被占用的代码成功
    const r = await renameSource(db, env, b.id, 'B2', 'CC');
    assert.deepEqual({ name: r.name, code: r.code }, { name: 'B2', code: 'CC' });
    assert.equal((await getSource(db, env, b.id)).code, 'CC');
});

test('订阅代码格式校验：非法字符/超长报错，空值视为未设置', async (t) => {
    const realFetch = global.fetch;
    t.after(() => {
        global.fetch = realFetch;
    });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB });

    const db = createMockD1();
    const env = createEnv(db);
    await assert.rejects(() => saveSource(db, env, URL_A, 'A', 'v2ray', '非法 code!'), /仅支持字母、数字、下划线、短横线/);
    await assert.rejects(() => saveSource(db, env, URL_A, 'A', 'v2ray', 'a'.repeat(17)), /长度 1-16/);
    // 空/空白代码 = 未设置
    const r = await saveSource(db, env, URL_A, 'A', 'v2ray', '  ');
    assert.equal(r.code, null);
    // rename 传空代码 = 清除已有代码
    await renameSource(db, env, r.id, 'A', 'OK1');
    const cleared = await renameSource(db, env, r.id, 'A', '');
    assert.equal(cleared.code, null);
    assert.equal((await getSource(db, env, r.id)).code, null);
});

test('applySourceNamePrefix：节点名加 <代码>_ 前缀，空代码原样返回', async () => {
    const { applySourceNamePrefix } = await import('../../src/core/sub/index.js');
    const nodes = [{ name: '香港 01', type: 'ss' }, { name: '美国 01', type: 'ss' }];
    const renamed = applySourceNamePrefix(nodes, 'YT');
    assert.deepEqual(renamed.map((n) => n.name), ['YT_香港 01', 'YT_美国 01']);
    assert.notEqual(renamed[0], nodes[0], '不应改动原对象');
    assert.equal(nodes[0].name, '香港 01');
    // 空代码/单对象形态
    assert.equal(applySourceNamePrefix(nodes, ''), nodes);
    assert.equal(applySourceNamePrefix(nodes[0], 'AB').name, 'AB_香港 01');
});
