import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockD1, createEnv } from './helpers.mjs';
import { saveLink, listLinks, getLink, clearLink, isCacheFresh, generateCode, ensureShortLinkTable } from '../../src/utils/shortlink/links.js';
import { saveSource } from '../../src/utils/shortlink/sources.js';
import { getKeys, hmacB64url, encryptBlob, decryptBlob } from '../../src/utils/shortlink/crypto.js';

const realFetch = global.fetch;
const stubSubFetch = () => async () => new Response('x', { status: 200 });

test('saveLink 新建：短码生成、blob/pw_hash 落库', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    const src = await saveSource(db, env, 'https://a.example/sub', 'A');
    const r = await saveLink(db, env, {
        sources: [src.id],
        rawUrls: [],
        target: 'mihomo',
        params: { template: 't1' },
        label: ' 我的订阅 ',
        key: 'pw123',
    });
    assert.match(r.code, /^[A-Za-z0-9]{8}$/);

    const { pw_hash, blob } = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(r.code).first();
    const { hmacKey } = await getKeys(env);
    assert.equal(pw_hash, await hmacB64url('pw123', hmacKey));
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(blob, encKey);
    assert.equal(obj.version, 3);
    assert.deepEqual(obj.sources, [src.id]);
    assert.equal(obj.label, '我的订阅');
    assert.equal(obj.content, undefined);
});

test('saveLink 校验：缺来源/缺口令/缺 target', async () => {
    const db = createMockD1();
    const env = createEnv(db);
    await assert.rejects(() => saveLink(db, env, { sources: [], rawUrls: [], target: 'mihomo', params: {}, key: 'p' }), /至少需要一个订阅来源/);
    await assert.rejects(() => saveLink(db, env, { sources: ['abc'], rawUrls: [], target: 'mihomo', params: {}, key: '' }), /缺少访问口令/);
    await assert.rejects(() => saveLink(db, env, { sources: ['abc'], rawUrls: [], params: {}, key: 'p' }), /缺少 target/);
});

test('saveLink 更新：oldKey 验证（错误拒绝/正确覆盖）', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    const r = await saveLink(db, env, { sources: [], rawUrls: ['https://x.example/s'], target: 'v2ray', params: {}, key: 'pw1' });
    await assert.rejects(
        () => saveLink(db, env, { sources: [], rawUrls: ['https://y.example/s'], target: 'v2ray', params: {}, key: 'pw2', code: r.code, oldKey: 'wrong' }),
        /原始口令/,
    );
    const r2 = await saveLink(db, env, { sources: [], rawUrls: ['https://y.example/s'], target: 'v2ray', params: {}, key: 'pw2', code: r.code, oldKey: 'pw1' });
    assert.equal(r2.code, r.code);
    const upd = await getLink(db, env, r.code, 'pw2');
    assert.deepEqual(upd.rawUrls, ['https://y.example/s']);
    assert.equal((await saveLink(db, env, { sources: [], rawUrls: ['https://z.example/s'], target: 'v2ray', params: {}, key: 'p', code: 'nope1234', oldKey: 'p' })).notFound, true);
});

test('getLink：口令错误/正确、源名称解析、已删除源 name 为 null', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    const src = await saveSource(db, env, 'https://a.example/sub', 'A');
    const r = await saveLink(db, env, { sources: [src.id, 'deadbeefid0000000000000000000000000000000'], rawUrls: [], target: 'mihomo', params: { template: 't' }, key: 'pw', label: 'L' });
    await assert.rejects(() => getLink(db, env, r.code, 'bad'), /访问口令错误/);
    const g = await getLink(db, env, r.code, 'pw');
    assert.equal(g.label, 'L');
    assert.equal(g.sources.length, 2);
    assert.deepEqual(g.sources[0], { id: src.id, name: 'A' });
    assert.equal(g.sources[1].name, null);
    assert.equal(g.hasContent, false);
});

test('listLinks：解密返回 label', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    await saveLink(db, env, { sources: [], rawUrls: ['https://x.example/s'], target: 'v2ray', params: {}, key: 'p', label: '第一个' });
    await saveLink(db, env, { sources: [], rawUrls: ['https://y.example/s'], target: 'v2ray', params: {}, key: 'p' });
    const res = await listLinks(db, env, 1, 5);
    assert.equal(res.total, 2);
    assert.equal(res.items.length, 2);
    assert.ok(res.items.some((i) => i.label === '第一个'));
    assert.ok(res.items.some((i) => i.label === null));
});

test('clearLink：清除生成缓存字段', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    const r = await saveLink(db, env, { sources: [], rawUrls: ['https://x.example/s'], target: 'v2ray', params: {}, key: 'p' });
    // 手动写入生成缓存
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(r.code).first();
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKey);
    const withCache = { ...obj, content: 'CACHED', textHeaders: { 'Content-Type': 'text/plain' }, srcFetched: {} };
    await db.prepare('UPDATE short_links SET blob = ? WHERE code = ?').bind(await encryptBlob(withCache, encKey), r.code).run();
    assert.equal((await getLink(db, env, r.code, 'p')).hasContent, true);

    await assert.rejects(() => clearLink(db, env, r.code, 'bad'), /访问口令错误/);
    assert.equal(await clearLink(db, env, r.code, 'p'), true);
    assert.equal((await getLink(db, env, r.code, 'p')).hasContent, false);
});

test('isCacheFresh 纯函数语义', () => {
    const obj = { content: 'c', sources: ['s1', 's2'], srcFetched: { s1: 100, s2: 200 } };
    assert.equal(isCacheFresh(obj, { s1: 100, s2: 200 }), true);
    assert.equal(isCacheFresh(obj, { s1: 101, s2: 200 }), false);
    // 源已删除（不在 fetchedMap）：已有缓存仍可服务
    assert.equal(isCacheFresh(obj, { s1: 100 }), true);
    // 无缓存/无快照
    assert.equal(isCacheFresh({ sources: [], srcFetched: {} }, { s1: 100 }), false);
    assert.equal(isCacheFresh({ content: 'c', sources: [], srcFetched: {} }, {}), true);
});

test('generateCode 形态', () => {
    for (let i = 0; i < 20; i++) assert.match(generateCode(), /^[A-Za-z0-9]{8}$/);
});

test('旧表结构自动重建：legacy 表被清空', async () => {
    const db = createMockD1({ legacy: true });
    await ensureShortLinkTable(db);
    const probe = await db.prepare('SELECT pw_hash FROM short_links LIMIT 1').first();
    assert.equal(probe, null); // 旧数据已被 DROP，新表为空
});

test('旧表缺 url_md5 列：自动补列，保存后写入 MD5', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1({ noMd5: true });
    const env = createEnv(db);
    const r = await saveLink(db, env, { sources: [], rawUrls: ['https://x.example/s'], target: 'mihomo', params: {}, key: 'p' });
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(r.code).first();
    assert.match(row.url_md5, /^[0-9a-f]{32}$/);
});

test('saveLink 查重复用：同内容同口令 → 同短码且不新增行', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    const payload = { sources: [], rawUrls: ['https://x.example/s'], target: 'mihomo', params: { udp: 'true', template: 'default.yaml' } };
    const r1 = await saveLink(db, env, { ...payload, key: 'pw1' });
    // 键序不同但内容相同的 params 也应命中同一行
    const r2 = await saveLink(db, env, { ...payload, params: { template: 'default.yaml', udp: 'true' }, key: 'pw1' });
    assert.equal(r2.reused, true);
    assert.equal(r2.keyMatches, true);
    assert.equal(r2.code, r1.code);
    const { total } = await db.prepare('SELECT COUNT(*) AS total FROM short_links').first();
    assert.equal(total, 1);
});

test('saveLink 查重：同链接不同参数/目标 → 不同短码', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    const base = { sources: [], rawUrls: ['https://x.example/s'], target: 'mihomo', params: {} };
    await saveLink(db, env, { ...base, key: 'p' });
    const r2 = await saveLink(db, env, { ...base, params: { udp: 'true' }, key: 'p' });
    const r3 = await saveLink(db, env, { ...base, target: 'singbox', key: 'p' });
    assert.notEqual(r2.code, r3.code);
    assert.equal(r2.reused, undefined);
    const { total } = await db.prepare('SELECT COUNT(*) AS total FROM short_links').first();
    assert.equal(total, 3);
});

test('saveLink 查重：同内容不同口令 → 复用短码且原口令仍有效', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    const r1 = await saveLink(db, env, { sources: [], rawUrls: ['https://x.example/s'], target: 'v2ray', params: {}, key: 'original' });
    const r2 = await saveLink(db, env, { sources: [], rawUrls: ['https://x.example/s'], target: 'v2ray', params: {}, key: 'other' });
    assert.equal(r2.reused, true);
    assert.equal(r2.keyMatches, false);
    assert.equal(r2.code, r1.code);
    // 新口令不能读取，原口令可以
    await assert.rejects(() => getLink(db, env, r1.code, 'other'), /访问口令错误/);
    await getLink(db, env, r1.code, 'original');
});

test('saveLink 更新为相同内容：删除旧行并复用既有短码', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => {
        global.fetch = realFetch;
    });
    const db = createMockD1();
    const env = createEnv(db);
    const payloadA = { sources: [], rawUrls: ['https://a.example/s'], target: 'mihomo', params: {} };
    const payloadB = { sources: [], rawUrls: ['https://b.example/s'], target: 'mihomo', params: {} };
    const ra = await saveLink(db, env, { ...payloadA, key: 'pa' });
    const rb = await saveLink(db, env, { ...payloadB, key: 'pb' });
    // 把 ra 更新成与 rb 相同的内容：ra 行删除，返回 rb 短码
    const r = await saveLink(db, env, { ...payloadB, key: 'pnew', code: ra.code, oldKey: 'pa' });
    assert.equal(r.reused, true);
    assert.equal(r.code, rb.code);
    const { total } = await db.prepare('SELECT COUNT(*) AS total FROM short_links').first();
    assert.equal(total, 1);
    const gone = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(ra.code).first();
    assert.equal(gone, null);
});
