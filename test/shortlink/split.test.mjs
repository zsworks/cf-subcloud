import test from 'node:test';
import assert from 'node:assert/strict';
import { splitInputItems } from '../../src/utils/urlItems.js';

test('多个 URL 逗号拼接项保持拆分（兼容旧行为）', () => {
    assert.deepEqual(splitInputItems(['https://a.com/s,https://b.com/s']), ['https://a.com/s', 'https://b.com/s']);
});

test('代理 URI 逗号拼接项保持拆分', () => {
    assert.deepEqual(splitInputItems(['vmess://abc,vmess://def']), ['vmess://abc', 'vmess://def']);
});

test('含逗号的 YAML 内容项整体保留', () => {
    const yaml = 'proxies:\n  - name: "香港, 01"\n    type: ss';
    assert.deepEqual(splitInputItems([yaml, 'https://a.com/s']), [yaml, 'https://a.com/s']);
});

test('base64 内容（无逗号）不受影响', () => {
    const b64 = 'dm1lc3M6Ly9leGFtcGxl';
    assert.deepEqual(splitInputItems([b64]), [b64]);
});

test('字符串输入兼容（非数组）', () => {
    assert.deepEqual(splitInputItems('https://a.com/s,https://b.com/s'), ['https://a.com/s', 'https://b.com/s']);
    assert.deepEqual(splitInputItems('https://a.com/s'), ['https://a.com/s']);
});
