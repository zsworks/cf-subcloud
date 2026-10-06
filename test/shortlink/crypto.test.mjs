import test from 'node:test';
import assert from 'node:assert/strict';
import { getKeys, encryptBlob, decryptBlob, hmacB64url, timingSafeEqual, bytesToBase64, base64ToBytes, md5Hex, canonicalStringify } from '../../src/utils/shortlink/crypto.js';

const ENV = { LINK_ENC_KEY: 'k'.repeat(32) };

test('md5Hex 标准测试向量（RFC 1321 / UTF-8）', () => {
    assert.equal(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
    assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
    assert.equal(md5Hex('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
    assert.equal(md5Hex('口令密码🔑'), '14f0676d6e9883b355fefa18957449dc');
});

test('canonicalStringify 键序无关', () => {
    assert.equal(canonicalStringify({ b: 1, a: { d: [2, { c: 3 }] } }), canonicalStringify({ a: { d: [2, { c: 3 }] }, b: 1 }));
    assert.equal(canonicalStringify({ udp: 'true', template: 'x' }), canonicalStringify({ template: 'x', udp: 'true' }));
});

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

test('getKeys：原始串与其 SHA256 十六进制派生同一加密密钥', async () => {
    const raw = await getKeys({ LINK_ENC_KEY: 'secret-string' });
    const digestHex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('secret-string')))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const hashed = await getKeys({ LINK_ENC_KEY: digestHex });
    const blob = await encryptBlob({ x: 'same-key' }, raw.encKey);
    assert.deepEqual(await decryptBlob(blob, hashed.encKey), { x: 'same-key' });
});

test('decryptBlob 密钥数组：当前派生优先，旧派生（+enc 后缀）回退', async () => {
    const envKey = 'legacy-key';
    // 旧派生：SHA256(envKey + 'enc')，模拟历史版本写入的密文
    const legacyRaw = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(envKey + 'enc')));
    const legacyEncKey = await crypto.subtle.importKey('raw', legacyRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const legacyBlob = await encryptBlob({ old: true }, legacyEncKey);
    // 单独用当前派生解不开
    const current = await getKeys({ LINK_ENC_KEY: envKey });
    await assert.rejects(() => decryptBlob(legacyBlob, current.encKey));
    // 数组形式回退成功
    assert.deepEqual(await decryptBlob(legacyBlob, current.encKeys), { old: true });
    // 当前派生写入的密文优先命中第一把钥匙
    const newBlob = await encryptBlob({ new: true }, current.encKey);
    assert.deepEqual(await decryptBlob(newBlob, current.encKeys), { new: true });
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
