import test from 'node:test';
import assert from 'node:assert/strict';
import { getKeys, encryptBlob, decryptBlob, hmacB64url, timingSafeEqual, bytesToBase64, base64ToBytes } from '../../src/utils/shortlink/crypto.js';

const ENV = { LINK_ENC_KEY: 'k'.repeat(32) };

test('getKeys 未配置环境变量时抛错', async () => {
    await assert.rejects(() => getKeys({}), /LINK_ENC_KEY/);
});

test('encryptBlob/decryptBlob 往返一致', async () => {
    const { encKey } = await getKeys(ENV);
    const obj = { version: 3, target: 'mihomo', params: { template: 't' }, sources: ['abc'], rawUrls: ['https://a.com/sub'] };
    const b64 = await encryptBlob(obj, encKey);
    assert.equal(typeof b64, 'string');
    assert.deepEqual(await decryptBlob(b64, encKey), obj);
});

test('不同环境密钥无法互相解密', async () => {
    const a = await getKeys(ENV);
    const b = await getKeys({ LINK_ENC_KEY: 'z'.repeat(32) });
    const blob = await encryptBlob({ x: 1 }, a.encKey);
    await assert.rejects(() => decryptBlob(blob, b.encKey));
});

test('hmacB64url 确定性、可区分、base64url 字符集', async () => {
    const { hmacKey } = await getKeys(ENV);
    const h1 = await hmacB64url('https://a.com/sub', hmacKey);
    const h2 = await hmacB64url('https://a.com/sub', hmacKey);
    const h3 = await hmacB64url('https://a.com/other', hmacKey);
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
    assert.match(h1, /^[A-Za-z0-9_-]+$/);
});

test('timingSafeEqual 行为', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true);
    assert.equal(timingSafeEqual('abc', 'abd'), false);
    assert.equal(timingSafeEqual('abc', 'abcd'), false);
});

test('base64 工具往返（含非 ASCII）', () => {
    const bytes = new TextEncoder().encode('口令密码🔑');
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});
