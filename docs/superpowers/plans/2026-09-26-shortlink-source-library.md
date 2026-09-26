# 短链存储改造（环境变量密钥加密 + 原始订阅库）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-09-26-shortlink-source-library-design.md` 将短链存储改为环境变量密钥加密，并新增以 URL 哈希为主键的原始订阅库（可命名/下拉选用/内容缓存），与生成订阅内容分离存储。

**Architecture:** 新建 `src/utils/shortlink/` 模块目录（crypto / sources / links / index 路由），替换旧 `src/utils/shortlink.js`。生成短链内容时通过内部请求复用 `buildConfig + handleRequest` 全管线，并以 `e.urls` 直接注入缓存的原始内容（绕过 URL 参数逗号拆分）。前端 `page.js` 订阅行改为三态（空/裸 URL/已入库标签），新增 💾 入库按钮、源下拉、源管理区块，移除客户端解密。

**Tech Stack:** Cloudflare Workers + D1、WebCrypto（AES-GCM / HMAC-SHA256）、esbuild、Node 22 内置 test runner（`node --test`，依赖 ≥22.7 的模块语法自动检测，本机 v22.23.2 已确认）。

## Global Constraints

- 环境变量名固定：`LINK_ENC_KEY`（≥32 位随机串）；未配置时所有短链/源接口抛错 `短链接功能未启用：未配置 LINK_ENC_KEY 环境变量`
- D1 绑定名不变：`SHORT_LINK`（wrangler.toml 不改）
- 密钥派生（域分离）：`encKey = SHA-256(LINK_ENC_KEY + "enc")` → AES-256-GCM；`hmacKey = SHA-256(LINK_ENC_KEY + "auth")` → HMAC-SHA256
- blob 格式：`base64(IV(12B) ‖ AES-GCM(JSON))`
- 源主键 `id = base64url(HMAC-SHA256(hmacKey, url))`；口令哈希 `pw_hash = base64url(HMAC-SHA256(hmacKey, 口令))`，比较必须恒时
- 旧 `short_links` 表（无 `pw_hash` 列）在 `ensure` 时自动 DROP 重建（设计已确认清空重建）
- 明文 JSON 响应统一 `{ success: true, ... }` / `{ success: false, error }`
- 提交信息用中文 conventional commits；每个 Task 至少一次提交
- 构建命令：`node esbuild.js`（同时产出 `dist/_worker.js` 与 `src/server.js`，`src/server.js` 是产物必须提交，`dist/` 已被 gitignore）
- 注意：`src/core/page/page.js` 整个 HTML/JS 在 JS 模板字符串内，源码中嵌套模板字符串写作 `\`...\${...}\``，编辑时保持转义

---

### Task 1: 加密模块 crypto.js

**Files:**
- Create: `src/utils/shortlink/crypto.js`
- Test: `test/shortlink/crypto.test.mjs`
- Modify: `package.json`（加 test 脚本）

**Interfaces:**
- Produces（后续任务全部依赖，签名固定）:
  - `getKeys(env)` → `Promise<{ encKey: CryptoKey, hmacKey: CryptoKey }>`；`env.LINK_ENC_KEY` 缺失时 throw；同 isolate 按环境变量值缓存
  - `encryptBlob(obj, encKey)` → `Promise<string>`（base64）
  - `decryptBlob(b64, encKey)` → `Promise<object>`；密钥不符/数据损坏 throw
  - `hmacB64url(message, hmacKey)` → `Promise<string>`（base64url，无填充）
  - `timingSafeEqual(a, b)` → `boolean`（字符串恒时比较）
  - `bytesToBase64(bytes)` / `base64ToBytes(b64)` → 编码工具（links.js 解码 `?key=` 用）

- [ ] **Step 1: 写失败测试**

`test/shortlink/crypto.test.mjs`：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/shortlink/crypto.test.mjs`
Expected: FAIL（Cannot find module '../../src/utils/shortlink/crypto.js'）

- [ ] **Step 3: 实现 crypto.js**

`src/utils/shortlink/crypto.js`：

```js
// 短链加密层：环境变量 LINK_ENC_KEY 派生加密与 HMAC 密钥（域分离），密文仅应用自身可解
const encoder = new TextEncoder();
const IV_LENGTH = 12;

let cachedEnvKey;
let cachedKeys;

// 同一 isolate 内按环境变量值缓存派生密钥
export async function getKeys(env) {
    const envKey = env?.LINK_ENC_KEY;
    if (!envKey) throw new Error('短链接功能未启用：未配置 LINK_ENC_KEY 环境变量');
    if (cachedEnvKey === envKey) return cachedKeys;
    const encRaw = await crypto.subtle.digest('SHA-256', encoder.encode(String(envKey) + 'enc'));
    const authRaw = await crypto.subtle.digest('SHA-256', encoder.encode(String(envKey) + 'auth'));
    const encKey = await crypto.subtle.importKey('raw', encRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const hmacKey = await crypto.subtle.importKey('raw', authRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    cachedEnvKey = envKey;
    cachedKeys = { encKey, hmacKey };
    return cachedKeys;
}

export function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export async function encryptBlob(obj, encKey) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, encoder.encode(JSON.stringify(obj)));
    const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), IV_LENGTH);
    return bytesToBase64(combined);
}

export async function decryptBlob(b64, encKey) {
    const combined = base64ToBytes(b64);
    const iv = combined.subarray(0, IV_LENGTH);
    const data = combined.subarray(IV_LENGTH);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encKey, data);
    return JSON.parse(new TextDecoder().decode(plain));
}

export async function hmacB64url(message, hmacKey) {
    const sig = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(String(message)));
    return bytesToBase64(new Uint8Array(sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 字符串恒时比较（长度先判等可接受：HMAC 输出定长）
export function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
```

- [ ] **Step 4: package.json 加 test 脚本**

`package.json` scripts 中加入（放在 "lint" 之后）：

```json
"test": "node --test test/shortlink/"
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test test/shortlink/`
Expected: 6 tests PASS

- [ ] **Step 6: 提交**

```bash
git add src/utils/shortlink/crypto.js test/shortlink/crypto.test.mjs package.json
git commit -m "feat: 短链加密模块（环境变量密钥派生 AES-GCM + HMAC）"
```

---

### Task 2: 原始订阅库 sources.js（含测试基建 mock D1）

**Files:**
- Create: `test/shortlink/helpers.mjs`（mock D1，后续任务复用）
- Create: `src/utils/shortlink/sources.js`
- Test: `test/shortlink/sources.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `getKeys/encryptBlob/decryptBlob/hmacB64url`；`../fetchResponse.js` 的 `fetchResponse(url, ua)` → `{ status, headers, data, error }`
- Produces:
  - `ensureSourceTable(db)` → `Promise<void>`（惰性建表 `sub_sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, blob TEXT NOT NULL, fetched_at INTEGER NOT NULL)`）
  - `saveSource(db, env, url, name)` → `Promise<{ id, name }>`；实时拉上游失败 throw；同 URL upsert（改名即重命名+刷新内容）
  - `listSources(db)` → `Promise<{ id, name, fetchedAt }[]>`
  - `getSource(db, env, id)` → `Promise<{ id, name, url, content, headers, fetchedAt } | null>`（解密后的完整源）
  - `refreshSource(db, env, id)` → `Promise<{ id, name, fetchedAt } | null>`
  - `deleteSource(db, id)` → `Promise<void>`

- [ ] **Step 1: 写 mock D1 helper**

`test/shortlink/helpers.mjs`（覆盖本项目用到的 SQL 形态；`legacy` 选项模拟旧表结构）：

```js
// 测试用内存 D1 mock，仅覆盖 shortlink 模块使用的 SQL 形态
export function createMockD1({ legacy = false } = {}) {
    const state = {
        sub_sources: [],
        short_links: legacy ? [{ code: 'old00000', salt: 's', blob: 'b', created: 1 }] : [],
        legacy,
    };
    const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
    function exec(sql, args) {
        const s = norm(sql);
        if (/^CREATE TABLE IF NOT EXISTS (\w+)/.test(s)) return null;
        if (/^DROP TABLE short_links$/.test(s)) {
            state.short_links = [];
            state.legacy = false;
            return null;
        }
        if (/^INSERT INTO sub_sources/.test(s)) {
            const [id, name, blob, fetchedAt] = args;
            const row = { id, name, blob, fetched_at: fetchedAt };
            const i = state.sub_sources.findIndex((r) => r.id === id);
            if (i >= 0) state.sub_sources[i] = row;
            else state.sub_sources.push(row);
            return null;
        }
        if (/^INSERT INTO short_links/.test(s)) {
            const [code, blob, pwHash, created] = args;
            const row = { code, blob, pw_hash: pwHash, created };
            const i = state.short_links.findIndex((r) => r.code === code);
            if (i >= 0) {
                row.created = state.short_links[i].created;
                state.short_links[i] = row;
            } else state.short_links.push(row);
            return null;
        }
        if (/^SELECT pw_hash FROM short_links LIMIT 1$/.test(s)) {
            if (state.legacy) throw new Error('no such column: pw_hash');
            return state.short_links[0] || null;
        }
        if (/^SELECT \* FROM sub_sources WHERE id = \?$/.test(s)) {
            return state.sub_sources.find((r) => r.id === args[0]) || null;
        }
        if (/^SELECT \* FROM short_links WHERE code = \?$/.test(s)) {
            return state.short_links.find((r) => r.code === args[0]) || null;
        }
        if (/^SELECT id, name, fetched_at FROM sub_sources ORDER BY fetched_at DESC$/.test(s)) {
            return [...state.sub_sources].sort((a, b) => b.fetched_at - a.fetched_at).map((r) => ({ id: r.id, name: r.name, fetched_at: r.fetched_at }));
        }
        if (/^SELECT COUNT\(\*\) AS total FROM short_links$/.test(s)) {
            return { total: state.short_links.length };
        }
        if (/^SELECT code, created FROM short_links ORDER BY created DESC, code LIMIT \? OFFSET \?$/.test(s)) {
            const rows = [...state.short_links].sort((a, b) => b.created - a.created || (a.code < b.code ? -1 : 1));
            return rows.slice(args[1], args[1] + args[0]).map((r) => ({ code: r.code, created: r.created }));
        }
        if (/^UPDATE sub_sources SET blob = \?, fetched_at = \? WHERE id = \?$/.test(s)) {
            const row = state.sub_sources.find((r) => r.id === args[2]);
            if (row) {
                row.blob = args[0];
                row.fetched_at = args[1];
            }
            return null;
        }
        if (/^UPDATE short_links SET blob = \? WHERE code = \?$/.test(s)) {
            const row = state.short_links.find((r) => r.code === args[1]);
            if (row) row.blob = args[0];
            return null;
        }
        if (/^DELETE FROM sub_sources WHERE id = \?$/.test(s)) {
            state.sub_sources = state.sub_sources.filter((r) => r.id !== args[0]);
            return null;
        }
        throw new Error('mock D1 未覆盖的 SQL: ' + s);
    }
    return {
        prepare(sql) {
            const stmt = {
                _args: [],
                bind(...args) {
                    this._args = args;
                    return this;
                },
                async first() {
                    return exec(sql, this._args);
                },
                async all() {
                    return { results: exec(sql, this._args) || [] };
                },
                async run() {
                    exec(sql, this._args);
                    return {};
                },
            };
            return stmt;
        },
    };
}

// 构造测试 env（真实 getKeys + mock D1）
export const createEnv = (d1) => ({ SHORT_LINK: d1, LINK_ENC_KEY: 'k'.repeat(32) });

// 一个可被 ProxyUtils.parse 识别的最小 vmess 订阅（base64(vmess json)）
export const SAMPLE_B64_SUB = btoa(JSON.stringify({ v: '2', ps: '测试节点', add: '1.2.3.4', port: '443', id: '0b8a1dd3-dc5a-4e33-8f1f-4e6f6e6f6e6f', aid: '0', net: 'tcp', type: 'none', scy: 'auto' }));
```

- [ ] **Step 2: 写失败测试**

`test/shortlink/sources.test.mjs`（fetch 用 stub 替换全局）：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockD1, createEnv, SAMPLE_B64_SUB } from './helpers.mjs';
import { saveSource, listSources, getSource, refreshSource, deleteSource } from '../../src/utils/shortlink/sources.js';
import { getKeys, decryptBlob, hmacB64url } from '../../src/utils/shortlink/crypto.js';

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
    t.after(() => { global.fetch = realFetch; });
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
    t.after(() => { global.fetch = realFetch; });
    global.fetch = async () => new Response('err', { status: 503 });

    const db = createMockD1();
    await assert.rejects(() => saveSource(db, createEnv(db), URL_A, '机场A'), /拉取原始订阅失败/);
    assert.equal((await listSources(db)).length, 0);
});

test('同 URL 重复保存 = 改名 + 刷新内容（upsert 不新增行）', async (t) => {
    const realFetch = global.fetch;
    t.after(() => { global.fetch = realFetch; });
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
    t.after(() => { global.fetch = realFetch; });
    let content = SAMPLE_B64_SUB;
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
    t.after(() => { global.fetch = realFetch; });
    global.fetch = stubFetch({ 'airport-a.example': SAMPLE_B64_SUB, 'airport-b.example': SAMPLE_B64_SUB });
    const db = createMockD1();
    const env = createEnv(db);
    const a = await saveSource(db, env, URL_A, 'A');
    const b = await saveSource(db, env, URL_B, 'B');
    assert.notEqual(a.id, b.id);
    assert.equal((await listSources(db)).length, 2);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test test/shortlink/sources.test.mjs`
Expected: FAIL（Cannot find module sources.js）

- [ ] **Step 4: 实现 sources.js**

`src/utils/shortlink/sources.js`：

```js
import YAML from 'yaml';
import { fetchResponse } from '../fetchResponse.js';
import { getKeys, encryptBlob, decryptBlob, hmacB64url } from './crypto.js';

let tableReady = false;
// 惰性建表（每个 isolate 仅一次）；URL 与上游内容全部加密存于 blob，仅名称与时间明文
export async function ensureSourceTable(db) {
    if (tableReady) return;
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS sub_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        blob TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
    )`,
        )
        .run();
    tableReady = true;
}

// 实时拉上游（v2ray UA，base64 兼容性最好）；失败 throw，调用方不入库
async function fetchSourceContent(url) {
    const res = await fetchResponse(url, 'v2ray');
    if (!res || res.error) throw new Error(`拉取原始订阅失败：${res?.error?.message || '网络错误'}`);
    if (res.status !== 200 || !res.data) throw new Error(`拉取原始订阅失败：HTTP ${res.status || 0}`);
    const content = typeof res.data === 'string' ? res.data : YAML.stringify(res.data);
    return { content, headers: res.headers || {} };
}

export async function saveSource(db, env, url, name) {
    await ensureSourceTable(db);
    const srcUrl = new URL(url);
    const { content, headers } = await fetchSourceContent(srcUrl.href);
    const { encKey, hmacKey } = await getKeys(env);
    const id = await hmacB64url(srcUrl.href, hmacKey);
    const blob = await encryptBlob({ url: srcUrl.href, content, headers }, encKey);
    await db
        .prepare(
            `INSERT INTO sub_sources (id, name, blob, fetched_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, blob = excluded.blob, fetched_at = excluded.fetched_at`,
        )
        .bind(id, name, blob, Date.now())
        .run();
    return { id, name };
}

export async function listSources(db) {
    await ensureSourceTable(db);
    const rows = await db.prepare('SELECT id, name, fetched_at FROM sub_sources ORDER BY fetched_at DESC').all();
    return (rows.results || []).map((r) => ({ id: r.id, name: r.name, fetchedAt: r.fetched_at }));
}

export async function getSource(db, env, id) {
    await ensureSourceTable(db);
    const row = await db.prepare('SELECT * FROM sub_sources WHERE id = ?').bind(id).first();
    if (!row) return null;
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKey);
    return { id: row.id, name: row.name, url: obj.url, content: obj.content, headers: obj.headers || {}, fetchedAt: row.fetched_at };
}

export async function refreshSource(db, env, id) {
    const src = await getSource(db, env, id);
    if (!src) return null;
    const { content, headers } = await fetchSourceContent(src.url);
    const { encKey } = await getKeys(env);
    const blob = await encryptBlob({ url: src.url, content, headers }, encKey);
    const now = Date.now();
    await db.prepare('UPDATE sub_sources SET blob = ?, fetched_at = ? WHERE id = ?').bind(blob, now, id).run();
    return { id, name: src.name, fetchedAt: now };
}

export async function deleteSource(db, id) {
    await ensureSourceTable(db);
    await db.prepare('DELETE FROM sub_sources WHERE id = ?').bind(id).run();
}
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test test/shortlink/sources.test.mjs`
Expected: 5 tests PASS

- [ ] **Step 6: 提交**

```bash
git add test/shortlink/helpers.mjs test/shortlink/sources.test.mjs src/utils/shortlink/sources.js
git commit -m "feat: 原始订阅库（URL HMAC 主键、实时拉取、加密内容缓存）"
```

---

### Task 3: 生成订阅 links.js（保存/详情/列表/清除 + 旧表自动重建）

**Files:**
- Create: `src/utils/shortlink/links.js`
- Test: `test/shortlink/links.test.mjs`

**Interfaces:**
- Consumes: Task 1 crypto 全部；Task 2 `getSource`；`../env.js` 的 `buildConfig(request, env, isNode)`、`../handler.js` 的 `handleRequest(e)`（本任务仅 import，Task 5 使用）
- Produces:
  - `ensureShortLinkTable(db)` → `Promise<void>`（惰性建表；探测到旧表无 `pw_hash` 列时 DROP 重建）
  - `generateCode()` → 8 位 base62 短码字符串
  - `saveLink(db, env, body)` → `Promise<{ code } | { notFound: true }>`；body `{ sources: string[], rawUrls: string[], target: string, params: object, label?: string, key: string, code?: string, oldKey?: string }`
  - `listLinks(db, env, page, limit)` → `Promise<{ items: { code, created, label }[], page, total, totalPages }>`
  - `getLink(db, env, code, key)` → `Promise<{ target, params, sources: { id, name }[], rawUrls, label, hasContent } | { notFound: true } | null>`（口令错误 throw `访问口令错误`）
  - `clearLink(db, env, code, key)` → `Promise<true | { notFound: true }>`（口令错误 throw）
  - `isCacheFresh(obj, fetchedMap)` → `boolean`（纯函数：`obj.srcFetched` 与各源当前 `fetched_at` 一致；源已删除视为新鲜——已有缓存仍可服务）
  - `serveLink(request, env, code, keyB64)` → `Promise<Response>`（Task 5 实现，本任务先建文件含 save/get/list/clear + 常量 `UA_MAP`）

- [ ] **Step 1: 写失败测试**

`test/shortlink/links.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockD1, createEnv } from './helpers.mjs';
import { saveLink, listLinks, getLink, clearLink, isCacheFresh, generateCode } from '../../src/utils/shortlink/links.js';
import { saveSource } from '../../src/utils/shortlink/sources.js';
import { getKeys, hmacB64url } from '../../src/utils/shortlink/crypto.js';

const realFetchHolder = { fetch: global.fetch };
const stubSubFetch = () => async () => new Response('x', { status: 200 });

async function seedSource(db, env, url, name) {
    return saveSource(db, env, url, name);
}

test('saveLink 新建：短码生成、blob/pw_hash 落库', async (t) => {
    global.fetch = stubSubFetch();
    t.after(() => { global.fetch = realFetchHolder.fetch; });
    const db = createMockD1();
    const env = createEnv(db);
    const src = await seedSource(db, env, 'https://a.example/sub', 'A');
    const r = await saveLink(db, env, {
        sources: [src.id], rawUrls: [], target: 'mihomo',
        params: { template: 't1' }, label: ' 我的订阅 ', key: 'pw123',
    });
    assert.match(r.code, /^[A-Za-z0-9]{8}$/);

    const { pw_hash, blob } = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(r.code).first();
    const { hmacKey } = await getKeys(env);
    assert.equal(pw_hash, await hmacB64url('pw123', hmacKey));
    const { encKey } = await getKeys(env);
    const obj = JSON.parse(await (async () => {
        const { decryptBlob } = await import('../../src/utils/shortlink/crypto.js');
        return decryptBlob(blob, encKey).then((o) => JSON.stringify(o));
    })();
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
    t.after(() => { global.fetch = realFetchHolder.fetch; });
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
    t.after(() => { global.fetch = realFetchHolder.fetch; });
    const db = createMockD1();
    const env = createEnv(db);
    const src = await seedSource(db, env, 'https://a.example/sub', 'A');
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
    t.after(() => { global.fetch = realFetchHolder.fetch; });
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
    t.after(() => { global.fetch = realFetchHolder.fetch; });
    const db = createMockD1();
    const env = createEnv(db);
    const r = await saveLink(db, env, { sources: [], rawUrls: ['https://x.example/s'], target: 'v2ray', params: {}, key: 'p' });
    // 手动写入生成缓存
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(r.code).first();
    const { encKey, hmacKey } = await getKeys(env);
    const { encryptBlob, decryptBlob } = await import('../../src/utils/shortlink/crypto.js');
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
    const env = createEnv(db);
    // 触发 ensure：任意写操作前先显式调用（saveLink 内部会调用）
    const { ensureShortLinkTable } = await import('../../src/utils/shortlink/links.js');
    await ensureShortLinkTable(db);
    const probe = await db.prepare('SELECT pw_hash FROM short_links LIMIT 1').first();
    assert.equal(probe, null); // 旧数据已被 DROP，新表为空
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/shortlink/links.test.mjs`
Expected: FAIL（Cannot find module links.js）

- [ ] **Step 3: 实现 links.js（本任务范围：常量 + ensure + save/get/list/clear/isCacheFresh/generateCode，serveLink 留 Task 5）**

`src/utils/shortlink/links.js`：

```js
import { buildConfig } from '../env.js';
import { handleRequest } from '../handler.js';
import { getKeys, encryptBlob, decryptBlob, hmacB64url, timingSafeEqual, base64ToBytes } from './crypto.js';
import { getSource, refreshSource } from './sources.js';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 8;
// 各 target 对应的合法客户端 UA（绕过 CHECKUA 校验）
const UA_MAP = { mihomo: 'clash-verge/2.0', singbox: 'sing-box/1.12.0', v2ray: 'v2rayN/6.0' };
// 源 id 为 base64url(HMAC-SHA256) = 43 字符
const ID_RE = /^[A-Za-z0-9_-]{40,64}$/;

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS short_links (
        code TEXT PRIMARY KEY,
        blob TEXT NOT NULL,
        pw_hash TEXT NOT NULL,
        created INTEGER NOT NULL
    )`;

let tableReady = false;
// 惰性建表；旧表（无 pw_hash 列）探测到即 DROP 重建（设计确认清空重建）
export async function ensureShortLinkTable(db) {
    if (tableReady) return;
    await db.prepare(CREATE_SQL).run();
    try {
        await db.prepare('SELECT pw_hash FROM short_links LIMIT 1').first();
    } catch {
        await db.prepare('DROP TABLE short_links').run();
        await db.prepare(CREATE_SQL).run();
    }
    tableReady = true;
}

export function generateCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    let code = '';
    for (const b of bytes) {
        code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
    return code;
}

async function pwHash(pw, hmacKey) {
    return hmacB64url(String(pw), hmacKey);
}

async function verifyPw(rowPwHash, pw, hmacKey) {
    return timingSafeEqual(await pwHash(pw, hmacKey), rowPwHash);
}

export async function saveLink(db, env, body = {}) {
    await ensureShortLinkTable(db);
    const { sources, rawUrls, target, params = {}, label, key, code: existingCode, oldKey } = body;
    if (!key) throw new Error('缺少访问口令');
    if (!target) throw new Error('缺少 target 参数');
    const srcIds = Array.isArray(sources) ? sources.map(String).filter((s) => ID_RE.test(s)) : [];
    const raws = Array.isArray(rawUrls) ? rawUrls.map(String).filter((u) => /^https?:\/\//.test(u)) : [];
    if (!srcIds.length && !raws.length) throw new Error('至少需要一个订阅来源');

    const { encKey, hmacKey } = await getKeys(env);
    let code = generateCode();
    if (existingCode) {
        if (!/^[A-Za-z0-9]{4,16}$/.test(String(existingCode))) throw new Error('无效的短码');
        code = existingCode;
        const oldRow = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
        if (!oldRow) return { notFound: true };
        if (!oldKey || !(await verifyPw(oldRow.pw_hash, oldKey, hmacKey))) {
            throw new Error('更新失败：需要提供该订阅的原始口令');
        }
    }

    const blobObj = {
        version: 3,
        target,
        params,
        sources: srcIds,
        rawUrls: raws,
        label: typeof label === 'string' && label.trim() ? label.trim() : null,
    };
    const blob = await encryptBlob(blobObj, encKey);
    await db
        .prepare(
            `INSERT INTO short_links (code, blob, pw_hash, created) VALUES (?, ?, ?, ?)
             ON CONFLICT(code) DO UPDATE SET blob = excluded.blob, pw_hash = excluded.pw_hash`,
        )
        .bind(code, blob, await pwHash(key, hmacKey), Date.now())
        .run();
    return { code };
}

export async function listLinks(db, env, page = 1, limit = 5) {
    await ensureShortLinkTable(db);
    const { total } = await db.prepare('SELECT COUNT(*) AS total FROM short_links').first();
    const rows = await db
        .prepare('SELECT code, created FROM short_links ORDER BY created DESC, code LIMIT ? OFFSET ?')
        .bind(limit, (page - 1) * limit)
        .all();
    const { encKey } = await getKeys(env);
    const items = [];
    for (const r of rows.results || []) {
        let label = null;
        try {
            label = (await decryptBlob((await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(r.code).first()).blob, encKey)).label ?? null;
        } catch {
            // 单条解密失败不影响列表
        }
        items.push({ code: r.code, created: r.created, label });
    }
    return { items, page, total, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

export async function getLink(db, env, code, key) {
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return { notFound: true };
    const { encKey, hmacKey } = await getKeys(env);
    if (!(await verifyPw(row.pw_hash, key, hmacKey))) throw new Error('访问口令错误');
    const obj = await decryptBlob(row.blob, encKey);
    const sources = await Promise.all(
        (obj.sources || []).map(async (id) => {
            const s = await getSource(db, env, id);
            return { id, name: s?.name ?? null };
        }),
    );
    return { target: obj.target, params: obj.params || {}, sources, rawUrls: obj.rawUrls || [], label: obj.label ?? null, hasContent: Boolean(obj.content) };
}

export async function clearLink(db, env, code, key) {
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return { notFound: true };
    const { encKey, hmacKey } = await getKeys(env);
    if (!(await verifyPw(row.pw_hash, key, hmacKey))) throw new Error('访问口令错误');
    const obj = await decryptBlob(row.blob, encKey);
    delete obj.content;
    delete obj.textHeaders;
    delete obj.srcFetched;
    await db.prepare('UPDATE short_links SET blob = ? WHERE code = ?').bind(await encryptBlob(obj, encKey), code).run();
    return true;
}

// 生成缓存是否仍新鲜：srcFetched 快照与各源当前 fetched_at 一致；
// 源已删除（不在 fetchedMap）视为新鲜——已有缓存仍可服务
export function isCacheFresh(obj, fetchedMap) {
    if (!obj.content || !obj.srcFetched) return false;
    return (obj.sources || []).every((id) => {
        const current = fetchedMap[id];
        if (current === undefined) return true;
        return obj.srcFetched[id] === current;
    });
}
```

注意：mock D1 的 listLinks 路径中 `SELECT * ... WHERE code = ?` 复用已有 matcher ✓（上述实现按 code 逐条取 blob 是为了取 label；`rows.results` 只有 code/created）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/shortlink/links.test.mjs`
Expected: 9 tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/utils/shortlink/links.js test/shortlink/links.test.mjs
git commit -m "feat: 生成订阅存储（口令 HMAC 校验、旧表自动重建、缓存清除）"
```

---

### Task 4: 转换管线逗号拆分防护（splitInputItems）

**Files:**
- Modify: `src/core/sub/index.js:77`（produceArtifact 内的拆分逻辑）
- Test: `test/shortlink/split.test.mjs`

**Interfaces:**
- Produces: `splitInputItems(urls)` — `string[] | string` → `string[]`；仅当某项按逗号拆分后**每一段**都是 http(s) URL 或代理 URI（`scheme://`）时才拆分，否则整项保留（保护含逗号的 YAML 缓存内容）

背景：`produceArtifact` 原样 `i.split(',')` 会把喂入的 YAML 订阅内容（含逗号）拆碎导致节点丢失。生成短链时我们会把缓存原始内容作为数组项直接传入 `e.urls`，必须保证内容项不被二次拆分。

- [ ] **Step 1: 写失败测试**

`test/shortlink/split.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitInputItems } from '../../src/core/sub/index.js';

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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/shortlink/split.test.mjs`
Expected: FAIL（splitInputItems 不是导出函数）

- [ ] **Step 3: 修改 src/core/sub/index.js**

在第 25 行 `export default async function processNodeConversion` 之前加入导出函数：

```js
const PROXY_URI_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * 拆分输入项：仅当逗号拼接的每一段都是 URL 或代理 URI 时才按逗号拆分
 * （兼容旧的逗号拼接输入）；缓存的订阅内容（YAML 等含逗号）必须整体保留
 * @param {string[]|string} urls 输入项
 * @returns {string[]}
 */
export function splitInputItems(urls) {
    return (Array.isArray(urls) ? urls : [urls]).flatMap((item) => {
        if (typeof item !== 'string' || !item.includes(',')) return [item];
        const parts = item.split(',');
        return parts.every((p) => {
            const t = p.trim();
            return t && (isUrl(t) || PROXY_URI_RE.test(t));
        })
            ? parts
            : [item];
    });
}
```

并把 `produceArtifact` 第 77 行：

```js
    const url = (Array.isArray(urls) ? urls : [urls]).map((i) => i.split(',')).flat();
```

替换为：

```js
    const url = splitInputItems(urls);
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `node --test test/shortlink/`
Expected: 全部 PASS（此前 Task 1-3 的测试不受影响）

- [ ] **Step 5: 提交**

```bash
git add src/core/sub/index.js test/shortlink/split.test.mjs
git commit -m "fix: 转换管线按逗号拆分增加 URI 防护，避免缓存内容被拆碎"
```

---

### Task 5: /s/ 生成管线 serveLink + 路由 index.js + 接线

**Files:**
- Modify: `src/utils/shortlink/links.js`（追加 serveLink）
- Create: `src/utils/shortlink/index.js`
- Modify: `src/worker.js`（import 路径）
- Delete: `src/utils/shortlink.js`
- Test: `test/shortlink/serve.test.mjs`

**Interfaces:**
- Consumes: Task 1-4 全部产物；`buildConfig(request, env, false)`、`handleRequest(e)`（`e.urls` 为管线订阅输入项数组）
- Produces: `serveLink(request, env, code, keyB64)` → `Promise<Response>`；`handleShortLink(request, env)`（index.js，worker.js 入口签名不变）；路由见 spec §5

生成机制（设计 §6）：构造内部请求 `/?${params + target}`（不含 url），`buildConfig` 后**直接覆写 `e.urls`** 为 `[...源缓存内容, ...rawUrls]`，再走 `handleRequest` 全管线（模板/规则/分组完整应用）。流量信息头（subscription-userinfo）取源缓存的 headers。

- [ ] **Step 1: 写失败测试**

`test/shortlink/serve.test.mjs`（不触网的缓存命中/失效判定 + 全 mocked 再生成）：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockD1, createEnv, SAMPLE_B64_SUB } from './helpers.mjs';
import { saveLink, serveLink } from '../../src/utils/shortlink/links.js';
import { saveSource } from '../../src/utils/shortlink/sources.js';
import { getKeys, encryptBlob, decryptBlob } from '../../src/utils/shortlink/crypto.js';

const realFetch = global.fetch;

function b64Key(pw) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(pw)));
}

async function seedCachedLink(db, env, { srcUrl = 'https://a.example/sub' } = {}) {
    const src = await saveSource(db, env, srcUrl, 'A');
    const r = await saveLink(db, env, { sources: [src.id], rawUrls: [], target: 'mihomo', params: {}, key: 'pw' });
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

test('缺少 key 参数 → 400 提示', async () => {
    const db = createMockD1();
    const env = createEnv(db);
    const { code } = await seedCachedLink(db, env);
    const resp = await serveLink(new Request(`https://w.example/s/${code}`), env, code, null);
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /key=访问口令/);
});

test('口令错误 → 400；口令正确 + 缓存新鲜 → 直接返回缓存且不触网', async (t) => {
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedCachedLink(db, env);
    const fetchedMap = { [src.id]: (await (await import('../../src/utils/shortlink/sources.js')).getSource(db, env, src.id)).fetchedAt };
    await writeCache(db, env, code, fetchedMap);

    const bad = await serveLink(new Request(`https://w.example/s/${code}?key=${b64Key('bad')}`), env, code, b64Key('bad'));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /访问口令错误/);

    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        return new Response('x', { status: 200 });
    };
    t.after(() => { global.fetch = realFetch; });
    const resp = await serveLink(new Request(`https://w.example/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'));
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), 'CACHED-CONTENT');
    assert.equal(resp.headers.get('Content-Type'), 'text/yaml');
    assert.equal(fetchCalled, false);
});

test('源刷新后缓存失效 → 重新生成并回写新缓存', async (t) => {
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedCachedLink(db, env);
    const sourcesMod = await import('../../src/utils/shortlink/sources.js');
    const fetched0 = (await sourcesMod.getSource(db, env, src.id)).fetchedAt;
    await writeCache(db, env, code, { [src.id]: fetched0 });

    // 模板与上游全部 mock：模板 URL 返回 Mihomo.yaml fixture，其余返回样例订阅
    const template = await readFile('test/Mihomo.yaml', 'utf8');
    global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/template/')) return new Response(template, { status: 200, headers: { 'Content-Type': 'text/yaml' } });
        return new Response(SAMPLE_B64_SUB, { status: 200, headers: { 'subscription-userinfo': 'upload=0; total=100; expire=2000000000' } });
    };
    t.after(() => { global.fetch = realFetch; });

    // 刷新源 → fetched_at 变化 → 缓存失效
    await sourcesMod.refreshSource(db, env, src.id);
    const resp = await serveLink(new Request(`https://w.example/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'));
    assert.equal(resp.status, 200, '重新生成应成功，body=' + (await resp.text()).slice(0, 200));
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    const { encKey } = await getKeys(env);
    const obj = await decryptBlob(row.blob, encKey);
    assert.ok(obj.content && obj.content !== 'CACHED-CONTENT', '应回写新生成内容');
    assert.ok(obj.srcFetched[src.id] > fetched0, '快照应更新');
    // 流量信息头来自源缓存 headers
    assert.equal(resp.headers.get('subscription-userinfo'), 'upload=0; total=100; expire=2000000000');
});

test('源已删除且无缓存 → 明确报错', async (t) => {
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedCachedLink(db, env);
    const { deleteSource } = await import('../../src/utils/shortlink/sources.js');
    await deleteSource(db, src.id);
    global.fetch = async () => new Response('x', { status: 200 });
    t.after(() => { global.fetch = realFetch; });
    const resp = await serveLink(new Request(`https://w.example/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'));
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /原始订阅已删除/);
});

test('源已删除但有缓存 → 缓存仍可服务', async (t) => {
    const db = createMockD1();
    const env = createEnv(db);
    const { src, code } = await seedCachedLink(db, env);
    const sourcesMod = await import('../../src/utils/shortlink/sources.js');
    const fetched0 = (await sourcesMod.getSource(db, env, src.id)).fetchedAt;
    await writeCache(db, env, code, { [src.id]: fetched0 });
    await sourcesMod.deleteSource(db, src.id);
    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        return new Response('x', { status: 200 });
    };
    t.after(() => { global.fetch = realFetch; });
    const resp = await serveLink(new Request(`https://w.example/s/${code}?key=${b64Key('pw')}`), env, code, b64Key('pw'));
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), 'CACHED-CONTENT');
    assert.equal(fetchCalled, false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/shortlink/serve.test.mjs`
Expected: FAIL（serveLink 未定义）

- [ ] **Step 3: links.js 追加 serveLink**

在 `src/utils/shortlink/links.js` 末尾（isCacheFresh 之后）追加：

```js
// 访问短链接：GET /s/{code}?key=口令base64；缓存新鲜直接返回，否则注入源缓存内容重新生成
export async function serveLink(request, env, code, keyB64) {
    const db = env?.SHORT_LINK;
    await ensureShortLinkTable(db);
    const row = await db.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
    if (!row) return jsonError('短链接不存在', 404);
    if (!keyB64) return jsonError('该订阅内容已加密，请在短链接后附加 ?key=访问口令的base64编码', 400);

    const { encKey, hmacKey } = await getKeys(env);
    // key 为口令的 base64 编码（URL 传输中 + 会被解码为空格，需还原）
    const pw = new TextDecoder().decode(base64ToBytes(keyB64.replace(/ /g, '+')));
    if (!(await verifyPw(row.pw_hash, pw, hmacKey))) return jsonError('访问口令错误', 400);
    const obj = await decryptBlob(row.blob, encKey);

    // 收集源缓存内容与当前 fetched_at
    const items = [];
    const srcHeaders = [];
    const fetchedMap = {};
    for (const id of obj.sources || []) {
        let s = await getSource(db, env, id);
        if (!s) {
            if (obj.content && isCacheFresh(obj, fetchedMap)) break; // 走下方缓存返回
            return jsonError('原始订阅已删除，无法重新生成', 400);
        }
        if (!s.content) {
            await refreshSource(db, env, id);
            s = await getSource(db, env, id);
        }
        items.push(s.content);
        srcHeaders.push(s.headers);
        fetchedMap[id] = s.fetchedAt;
    }
    items.push(...(obj.rawUrls || []));

    if (obj.content && isCacheFresh(obj, fetchedMap)) {
        const headers = new Headers(obj.textHeaders || {});
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
        return new Response(obj.content, { status: 200, headers });
    }

    // 重新生成：内部请求携带除 url 外的全部参数，覆写 e.urls 注入缓存内容（绕过 URL 逗号拆分）
    const origin = new URL(request.url).origin;
    const qs = new URLSearchParams({ ...(obj.params || {}), target: obj.target });
    const genRequest = new Request(new URL(`/?${qs}`, origin), {
        method: 'GET',
        headers: { 'User-Agent': UA_MAP[obj.target] || 'clash-verge/2.0' },
    });
    const e = buildConfig(genRequest, env, false);
    e.urls = items;
    const result = await handleRequest(e);
    if ((result.status || 200) !== 200) {
        return new Response(result.body, { status: result.status, headers: result.headers });
    }
    const content = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    const textHeaders = Object.fromEntries(new Headers(result.headers));
    // 流量信息头优先取源缓存
    const userinfo = srcHeaders.map((h) => h && h['subscription-userinfo']).find(Boolean);
    if (userinfo) textHeaders['subscription-userinfo'] = userinfo;

    try {
        const blob = await encryptBlob({ ...obj, content, textHeaders, srcFetched: fetchedMap }, encKey);
        await db.prepare('UPDATE short_links SET blob = ? WHERE code = ?').bind(blob, code).run();
    } catch {
        // 回写失败不影响本次返回
    }
    return new Response(content, { status: 200, headers: new Headers(textHeaders) });
}

function jsonError(message, status) {
    return new Response(JSON.stringify({ success: false, error: message }), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}
```

实现注意：`buildConfig` 生成的 `e.userAgent` 取自请求头（我们已按 target 伪装），`e.urls` 覆写前是内部请求 url 参数解析结果（内部请求不带 url 参数）。若 `getProxies_Data` 实际消费的字段不是 `e.urls`（以 `src/core/mihomo/proxies.js` 为准），改为对应字段——测试「源刷新后缓存失效」会暴露此问题。

- [ ] **Step 4: 运行确认通过（允许迭代）**

Run: `node --test test/shortlink/serve.test.mjs`
Expected: 5 tests PASS。若再生成测试因管线细节失败（如 proxies.js 消费字段不同、模板 fixture 格式问题），修正实现或 fixture 后重跑直至通过。

- [ ] **Step 5: 创建路由 index.js**

`src/utils/shortlink/index.js`：

```js
import { saveSource, listSources, refreshSource, deleteSource } from './sources.js';
import { saveLink, listLinks, getLink, clearLink, serveLink } from './links.js';

const ID_RE = /^[A-Za-z0-9_-]{40,64}$/;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

function notFound(message) {
    return jsonResponse({ success: false, error: message }, 404);
}

// 短链接与原始订阅库路由（CF Workers 专用，依赖 D1 绑定 SHORT_LINK 与环境变量 LINK_ENC_KEY）
// 非本模块路由返回 null，交回主流程
export async function handleShortLink(request, env) {
    const db = env?.SHORT_LINK;
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/source/save' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { url: sourceUrl, name } = await request.json();
        if (!sourceUrl || !/^https?:\/\//.test(String(sourceUrl))) throw new Error('无效的订阅地址');
        const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 30) : '';
        if (!cleanName) throw new Error('请输入订阅名称');
        const r = await saveSource(db, env, String(sourceUrl), cleanName);
        return jsonResponse({ success: true, ...r });
    }
    if (path === '/api/source/list' && request.method === 'GET') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        return jsonResponse({ success: true, items: await listSources(db) });
    }
    if (path === '/api/source/refresh' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { id } = await request.json();
        if (!id || !ID_RE.test(String(id))) throw new Error('无效的订阅 ID');
        const r = await refreshSource(db, env, String(id));
        if (!r) return notFound('原始订阅不存在');
        return jsonResponse({ success: true, ...r });
    }
    if (path === '/api/source/delete' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { id } = await request.json();
        if (!id || !ID_RE.test(String(id))) throw new Error('无效的订阅 ID');
        await deleteSource(db, String(id));
        return jsonResponse({ success: true });
    }
    if (path.startsWith('/api/source/')) return notFound('未知接口');

    if (path === '/api/short' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const r = await saveLink(db, env, await request.json());
        if (r.notFound) return notFound('短链接不存在');
        return jsonResponse({ success: true, code: r.code });
    }
    if (path === '/api/short/list' && request.method === 'GET') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 5, 1), 20);
        const page = Math.max(parseInt(url.searchParams.get('page')) || 1, 1);
        const r = await listLinks(db, env, page, limit);
        return jsonResponse({ success: true, ...r });
    }
    if (path === '/api/short/get' && request.method === 'GET') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const code = url.searchParams.get('code') || '';
        const key = url.searchParams.get('key') || '';
        if (!/^[A-Za-z0-9]{4,16}$/.test(code)) throw new Error('无效的短码');
        if (!key) throw new Error('缺少访问口令');
        const r = await getLink(db, env, code, key);
        if (r.notFound) return notFound('短链接不存在');
        return jsonResponse({ success: true, code, ...r });
    }
    if (path === '/api/short/clear' && request.method === 'POST') {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        const { code, key } = await request.json();
        if (!code || !/^[A-Za-z0-9]{4,16}$/.test(String(code))) throw new Error('无效的短码');
        if (!key) throw new Error('缺少访问口令');
        const r = await clearLink(db, env, String(code), String(key));
        if (r.notFound) return notFound('短链接不存在');
        return jsonResponse({ success: true });
    }
    if (path.startsWith('/api/short/')) return notFound('未知接口');

    const match = path.match(/^\/s\/([A-Za-z0-9]{4,16})$/);
    if (match) {
        if (!db) throw new Error('短链接功能未启用：未绑定 D1 数据库');
        return serveLink(request, env, match[1], url.searchParams.get('key'));
    }

    return null;
}
```

- [ ] **Step 6: 接线 worker.js 并删除旧文件**

`src/worker.js` 第一行区域，将：

```js
import { handleShortLink } from './utils/shortlink.js';
```

改为：

```js
import { handleShortLink } from './utils/shortlink/index.js';
```

（先 Read `src/worker.js` 确认当前内容再改。）然后删除旧文件：

```bash
git rm src/utils/shortlink.js
```

- [ ] **Step 7: 构建验证**

Run: `node esbuild.js && node --test test/shortlink/`
Expected: 构建成功（仅 Sub-Store direct-eval 既有警告）；全部测试 PASS

- [ ] **Step 8: 提交**

```bash
git add src/utils/shortlink/index.js src/utils/shortlink/links.js src/worker.js test/shortlink/serve.test.mjs src/server.js
git commit -m "feat: /s/ 生成管线（注入源缓存内容）+ 新路由分发，替换旧短链模块"
```

---

### Task 6: 前端 — 订阅行三态 + 💾 入库 + 源下拉

**Files:**
- Modify: `src/core/page/page.js`（CSS、dialog HTML、addLinkRow/buildModePanel、行状态与下拉逻辑）

**Interfaces:**
- Consumes: `POST /api/source/save {url, name}` → `{success, id, name}`；`GET /api/source/list` → `{success, items: [{id, name, fetchedAt}]}`
- Produces（页内函数，Task 7/8 依赖）:
  - `buildLinkRow(containerId, modeId)` — 构建行（input + 💾 + ▾ + ＋），addLinkRow 保留为兼容别名
  - `setRowSource(rowEl, {id, name})` / `clearRowSource(rowEl)` — 行切换为「已入库标签」态/还原输入态；行上数据存 `rowEl.dataset.sourceId` / `rowEl.dataset.sourceName`
  - `collectLinkRows(wrapper)` → `{ sources: [{id,name}], rawUrls: string[] }` — 汇总行状态（generateConfigForMode 与保存用）
  - `askName(message, prefill)` → `Promise<string|null>` — 名称输入弹窗

- [ ] **Step 1: CSS（<style> 末尾、`@media (max-width: 560px)` 之前加入）**

```css
        .row-tool-btn {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 0.8rem;
            flex-shrink: 0;
            user-select: none;
        }
        .save-btn-circle { border: 1px solid var(--border-light); color: var(--primary); background: #fff; }
        .save-btn-circle:active { transform: scale(0.92); }
        .src-caret-btn { border: 1px solid var(--border-light); color: var(--text-muted); background: #fff; font-size: 0.6rem; }
        .src-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(99, 102, 241, 0.1);
            color: var(--primary);
            border-radius: 999px;
            padding: 5px 12px;
            font-size: 0.8rem;
            font-weight: 600;
            max-width: 100%;
        }
        .src-chip-x { cursor: pointer; font-weight: 400; opacity: 0.6; }
        .src-chip-x:hover { opacity: 1; }
        .src-dd {
            position: absolute;
            z-index: 30;
            background: #fff;
            border: 1px solid var(--border-light);
            border-radius: 0.8rem;
            box-shadow: var(--shadow-md);
            max-height: 200px;
            overflow-y: auto;
            min-width: 160px;
        }
        .src-dd-item { padding: 8px 14px; font-size: 0.82rem; cursor: pointer; }
        .src-dd-item:hover { background: rgba(99, 102, 241, 0.08); }
```

- [ ] **Step 2: 名称弹窗 HTML（`</dialog>`（keyDialog 结束）之后加入）**

```html
    <dialog id="nameDialog" style="border: none; border-radius: 1.2rem; padding: 1.5rem; box-shadow: var(--shadow-md); position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; width: min(22rem, calc(100vw - 3rem));">
        <p id="nameDialogMsg" style="font-size: 0.88rem; color: var(--text-dark); line-height: 1.6; margin-bottom: 1rem;"></p>
        <input type="text" id="nameDialogInput" placeholder="输入简短名称（如：机场A）"
            style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 0.8rem; font-size: 0.9rem; outline: none; text-align: center; margin-bottom: 1.2rem;" />
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button id="nameDialogCancel"
                style="border: 1px solid var(--border-light); background: transparent; color: var(--text-muted); border-radius: 999px; padding: 6px 18px; font-size: 0.82rem; cursor: pointer;">取消</button>
            <button id="nameDialogOk"
                style="border: none; background: var(--primary); color: #fff; border-radius: 999px; padding: 6px 18px; font-size: 0.82rem; cursor: pointer;">确定</button>
        </div>
    </dialog>
```

- [ ] **Step 3: 行构建逻辑 — 替换 addLinkRow（page.js 约 1144-1160 行）**

将现有 `addLinkRow` 整个函数替换为：

```js
        // 名称输入弹窗（原始订阅入库用）
        function askName(message, prefill = '') {
            return new Promise((resolve) => {
                const dlg = document.getElementById('nameDialog');
                const msg = document.getElementById('nameDialogMsg');
                const input = document.getElementById('nameDialogInput');
                const ok = document.getElementById('nameDialogOk');
                const cancel = document.getElementById('nameDialogCancel');
                msg.innerText = message;
                input.value = prefill;
                let settled = false;
                const done = (val) => {
                    if (settled) return;
                    settled = true;
                    ok.onclick = null;
                    cancel.onclick = null;
                    input.onkeydown = null;
                    dlg.close();
                    resolve(val);
                };
                ok.onclick = () => done(input.value.trim() || null);
                cancel.onclick = () => done(null);
                input.onkeydown = (ev) => { if (ev.key === 'Enter') done(input.value.trim() || null); };
                dlg.showModal();
                setTimeout(() => input.focus(), 50);
            });
        }

        // 行 → 已入库标签态（表单持有 id，URL 不落表单）
        function setRowSource(row, src) {
            row.dataset.sourceId = src.id;
            row.dataset.sourceName = src.name;
            const input = row.querySelector('.dynamic-link-input');
            input.style.display = 'none';
            let chip = row.querySelector('.src-chip');
            if (!chip) {
                chip = document.createElement('span');
                chip.className = 'src-chip';
                const x = document.createElement('span');
                x.className = 'src-chip-x';
                x.innerText = '✕';
                x.title = '移除该订阅源';
                x.onclick = () => clearRowSource(row);
                chip.appendChild(x);
                input.insertAdjacentElement('afterend', chip);
            }
            chip.innerHTML = '';
            const label = document.createElement('span');
            label.innerText = \`🗃️ \${src.name}\`;
            const x = document.createElement('span');
            x.className = 'src-chip-x';
            x.innerText = '✕';
            x.title = '移除该订阅源';
            x.onclick = () => clearRowSource(row);
            chip.append(label, x);
        }

        function clearRowSource(row) {
            delete row.dataset.sourceId;
            delete row.dataset.sourceName;
            const chip = row.querySelector('.src-chip');
            if (chip) chip.remove();
            const input = row.querySelector('.dynamic-link-input');
            input.style.display = '';
            input.value = '';
            input.focus();
        }

        // 汇总行状态：已入库源 + 裸 URL
        function collectLinkRows(wrapper) {
            const sources = [];
            const rawUrls = [];
            wrapper.querySelectorAll('.link-row').forEach((row) => {
                if (row.dataset.sourceId) {
                    sources.push({ id: row.dataset.sourceId, name: row.dataset.sourceName });
                } else {
                    const v = row.querySelector('.dynamic-link-input')?.value.trim();
                    if (v) rawUrls.push(v);
                }
            });
            return { sources, rawUrls };
        }

        // 💾 保存当前行 URL 到原始订阅库（保存即实时拉取上游）
        async function saveRowToLibrary(row) {
            const input = row.querySelector('.dynamic-link-input');
            const url = input.value.trim();
            if (!/^https?:\\/\\//.test(url)) {
                showToast('✗ 请先输入有效的订阅链接', 'error');
                return;
            }
            const name = await askName('将实时拉取该订阅内容并加密保存到服务器，请输入一个简短名称以便后续选用。');
            if (!name) return;
            try {
                showToast('⏳ 正在拉取并保存原始订阅…', 'success');
                const resp = await fetch('/api/source/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, name }),
                });
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(typeof data === 'string' ? data : data.error || '保存失败');
                setRowSource(row, { id: data.id, name: data.name });
                loadSourceLibrary();
                showToast(\`✓ 已保存原始订阅「\${data.name}」\`, 'success');
            } catch (err) {
                showToast(\`✗ \${err.message || '保存失败'}\`, 'error');
            }
        }

        // ▾ 下拉选择已保存的原始订阅（仅显示名称）
        async function openSourceDropdown(row) {
            document.querySelectorAll('.src-dd').forEach((d) => d.remove());
            const dd = document.createElement('div');
            dd.className = 'src-dd';
            dd.innerHTML = '<div style="padding:8px 14px;color:var(--text-muted);font-size:0.78rem;">加载中…</div>';
            document.body.appendChild(dd);
            const rect = row.getBoundingClientRect();
            dd.style.top = \`\${window.scrollY + rect.bottom + 4}px\`;
            dd.style.left = \`\${window.scrollX + rect.left}px\`;
            const close = (ev) => {
                if (!dd.contains(ev.target)) {
                    dd.remove();
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
            try {
                const resp = await fetch('/api/source/list');
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(data.error || '加载失败');
                dd.innerHTML = '';
                const items = data.items || [];
                if (!items.length) {
                    dd.innerHTML = '<div style="padding:8px 14px;color:var(--text-muted);font-size:0.78rem;">暂无已保存的原始订阅</div>';
                    return;
                }
                items.forEach((s) => {
                    const item = document.createElement('div');
                    item.className = 'src-dd-item';
                    item.innerText = \`🗃️ \${s.name}\`;
                    item.onclick = () => {
                        setRowSource(row, { id: s.id, name: s.name });
                        dd.remove();
                        document.removeEventListener('click', close);
                    };
                    dd.appendChild(item);
                });
            } catch (err) {
                dd.innerHTML = \`<div style="padding:8px 14px;color:#ef4444;font-size:0.78rem;">\${err.message}</div>\`;
            }
        }

        function addLinkRow(containerId, modeId) {
            const linksContainer = document.getElementById(containerId);
            if (!linksContainer) return;
            const newRow = document.createElement('div');
            newRow.className = 'link-row';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'link-input dynamic-link-input';
            input.placeholder = MODES_META[modeId]?.placeholder || '输入订阅地址';
            const addBtn = document.createElement('div');
            addBtn.className = 'add-btn-circle';
            addBtn.innerText = '＋';
            addBtn.onclick = () => addLinkRow(containerId, modeId);
            const saveBtn = document.createElement('div');
            saveBtn.className = 'row-tool-btn save-btn-circle';
            saveBtn.innerText = '💾';
            saveBtn.title = '保存到原始订阅库（输入名称后实时拉取内容）';
            saveBtn.onclick = () => saveRowToLibrary(newRow);
            const caretBtn = document.createElement('div');
            caretBtn.className = 'row-tool-btn src-caret-btn';
            caretBtn.innerText = '▾';
            caretBtn.title = '选择已保存的原始订阅';
            caretBtn.onclick = () => openSourceDropdown(newRow);
            newRow.append(input, saveBtn, caretBtn, addBtn);
            linksContainer.appendChild(newRow);
        }
```

注意：源码中该函数在模板字符串内，`\\` 与 `\${}` 转义保持与文件一致（上述代码按源码形态书写）。

- [ ] **Step 4: buildModePanel 首行同样加按钮（page.js 约 1227-1239 行）**

将：

```js
            const addFirstBtn = document.createElement('div');
            addFirstBtn.className = 'add-btn-circle';
            addFirstBtn.innerText = '＋';
            addFirstBtn.onclick = () => addLinkRow(\`links-wrapper-\${modeId}\`, modeId);
            firstRow.appendChild(firstInput);
            firstRow.appendChild(addFirstBtn);
```

替换为：

```js
            const addFirstBtn = document.createElement('div');
            addFirstBtn.className = 'add-btn-circle';
            addFirstBtn.innerText = '＋';
            addFirstBtn.onclick = () => addLinkRow(\`links-wrapper-\${modeId}\`, modeId);
            const saveFirstBtn = document.createElement('div');
            saveFirstBtn.className = 'row-tool-btn save-btn-circle';
            saveFirstBtn.innerText = '💾';
            saveFirstBtn.title = '保存到原始订阅库（输入名称后实时拉取内容）';
            saveFirstBtn.onclick = () => saveRowToLibrary(firstRow);
            const caretFirstBtn = document.createElement('div');
            caretFirstBtn.className = 'row-tool-btn src-caret-btn';
            caretFirstBtn.innerText = '▾';
            caretFirstBtn.title = '选择已保存的原始订阅';
            caretFirstBtn.onclick = () => openSourceDropdown(firstRow);
            firstRow.appendChild(firstInput);
            firstRow.appendChild(saveFirstBtn);
            firstRow.appendChild(caretFirstBtn);
            firstRow.appendChild(addFirstBtn);
```

- [ ] **Step 5: 构建验证**

Run: `node esbuild.js`
Expected: 打包成功。`grep -c 'save-btn-circle' src/server.js` ≥ 4（CSS 类 + 首行 + addLinkRow）

- [ ] **Step 6: 提交**

```bash
git add src/core/page/page.js src/server.js
git commit -m "feat: 订阅行三态（空/裸URL/已入库标签）+ 💾入库 + 源下拉"
```

---

### Task 7: 前端 — 生成/保存流程改造 + 移除客户端解密

**Files:**
- Modify: `src/core/page/page.js`

**Interfaces:**
- Consumes: Task 6 的 `collectLinkRows/setRowSource/clearRowSource`；`POST /api/short`（新 body）、`GET /api/short/get?code=&key=`（服务端验口令并解密）
- Produces: 页内 `lastGen = { sources: string[](id), rawUrls: string[], target, params: object } | null`（保存短链的数据源）；`fillFormFromParams(resp)` 改签名（resp = getLink 响应体）

- [ ] **Step 1: generateConfigForMode 改造（page.js 约 1073-1123 行）**

将函数开头到 `params.set('target', modeId);` 之间的 links 收集部分（`const linkInputs ...` 与 `const links = ...` 两行）替换为：

```js
            const { sources, rawUrls } = collectLinkRows(container);
```

并将「`if (links.length === 0)` 校验」替换为：

```js
            if (!sources.length && !rawUrls.length) {
                alert('请至少填写一个订阅链接或选择一个已保存的原始订阅');
                return;
            }
```

将 `if (links.length) params.set('url', links.join(','));` 一行删除。在 `params.set('target', modeId);` 之后、协议参数循环之后（`const fullUrl` 之前）加入：

```js
            // 生成的完整参数（保存短链用）；直接链接仅由裸 URL 构成
            const genParams = Object.fromEntries(params.entries());
            window.lastGen = { sources: sources.map((s) => s.id), rawUrls, target: modeId, params: genParams };
            let fullUrl = '';
            if (!sources.length) {
                const displayParams = new URLSearchParams(params);
                displayParams.set('url', rawUrls.join(','));
                fullUrl = \`\${origin}/?\${displayParams.toString()}\`;
            } else {
                fullUrl = \`\${origin}/?target=\${modeId}&src=\${sources.map((s) => s.name).join(',')}\`;
            }
```

同时删除原 `const fullUrl = \`\${origin}/?\${params.toString()}\`;` 行。注意 `origin` 定义在 params 构建之后，若 `fullUrl` 新代码块在 `const origin` 之前引用会报错——把新代码块放在 `const origin = window.location.origin;` 之后。

- [ ] **Step 2: saveEncryptedContent 改造（page.js 约 824-862 行）**

将函数体中的 `askKey` 消息与 POST body 替换。完整新函数：

```js
        // ===== 保存订阅内容（服务端环境变量密钥加密） =====
        async function saveEncryptedContent() {
            if (!window.lastGen) {
                showToast('✗ 请先生成订阅链接', 'error');
                return;
            }
            const res = (await askKey(
                '订阅配置将由服务端加密保存（仅本应用可解密）。请设置访问口令：访问/修改该短链接时需要提供，口令哈希存储于服务器，忘记后将无法找回。',
                '保存',
                { withLabel: true, labelValue: editingLabel }
            )) || {};
            const { key, label } = res;
            if (!key) return;
            try {
                showToast('⏳ 正在保存订阅配置…', 'success');
                const resp = await fetch('/api/short', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...window.lastGen,
                        key,
                        label: label || '',
                        ...(editingCode ? { code: editingCode, oldKey: editingOldKey } : {}),
                    }),
                });
                const data = await resp.json();
                if (!resp.ok || !data.success) {
                    throw new Error(typeof data === 'string' ? data : data.error || '保存失败');
                }
                editingCode = data.code;
                editingLabel = label || '';
                editingOldKey = key;
                loadSavedList(savedPager.page);
                const shortUrl = \`\${window.location.origin}/s/\${data.code}?key=\${b64EncodeKey(key)}\`;
                updateResultAndQR(shortUrl);
                navigator.clipboard.writeText(shortUrl).then(() => {
                    showToast('✓ 已加密保存，短链接（含访问口令）已复制', 'success');
                }).catch(() => {
                    showToast('✓ 已加密保存，短链接已生成', 'success');
                });
            } catch (err) {
                showToast(\`✗ \${err.message}\`, 'error');
            }
        }
```

- [ ] **Step 3: 删除客户端解密代码（page.js 约 803-821 行）**

删除整段：

```js
        // ===== 客户端解密（与后端 shortlink.js 算法一致：PBKDF2 + AES-GCM） =====
        const PBKDF2_ITERATIONS = 100000;
        const IV_LENGTH = 12;
```

及 `decryptBlobClient` 整个函数（保留其上方注释块中的 `b64EncodeKey`——它仍用于口令 base64）。即保留：

```js
        // 口令的 base64 编码（UTF-8 安全），用于短链接 ?key= 参数
        function b64EncodeKey(str) {
            return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
        }
```

- [ ] **Step 4: unlockEntry 改为服务端校验（page.js 约 919-928 行）**

替换为：

```js
        // 解锁条目：口令交服务端 HMAC 校验并解密，明文配置仅回传表单所需字段
        async function unlockEntry(code, message, btnText) {
            const { key } = (await askKey(message, btnText)) || {};
            if (!key) return null;
            const resp = await fetch(\`/api/short/get?code=\${code}&key=\${encodeURIComponent(b64EncodeKey(key))}\`).then((x) => x.json());
            if (!resp.success) {
                if (resp.error === '访问口令错误') throw new Error('访问口令错误');
                throw new Error(typeof resp === 'string' ? resp : resp.error || '获取失败');
            }
            unlockedInfo.set(code, { ...resp, key });
            unlockedKeys.set(code, key);
            return { key, resp };
        }
```

注意：服务端 `getLink` 收到的 `key` 是 base64 编码（与旧 /s/ 一致）。需在 index.js 的 `/api/short/get` 分支先把 `key` 还原为明文口令再传入 `getLink`（base64 → TextDecoder）。修改 `src/utils/shortlink/index.js` 对应分支：

```js
        const keyB64 = url.searchParams.get('key') || '';
        if (!keyB64) throw new Error('缺少访问口令');
        const pw = new TextDecoder().decode(base64ToBytes(keyB64.replace(/ /g, '+')));
        const r = await getLink(db, env, code, pw);
```

（index.js 顶部 import 追加 `base64ToBytes` from './crypto.js'。）

- [ ] **Step 5: renderSavedList 展示改造（page.js 约 930-1025 行）**

「已解锁展示」分支替换为（利用 list 返回的 label 与解锁信息）：

```js
                const unlocked = unlockedInfo.get(item.code);
                const info = document.createElement('div');
                info.className = 'saved-info';
                const labelText = unlocked?.label || item.label;
                if (unlocked) {
                    const modeName = MODES_META[unlocked.target]?.name || unlocked.target;
                    const srcCount = (unlocked.sources || []).length;
                    const rawCount = (unlocked.rawUrls || []).length;
                    info.innerHTML = \`<span class="saved-mode">\${labelText || modeName}</span><span class="saved-code">/s/\${item.code}</span><span class="saved-meta">\${modeName} · \${srcCount ? \`\${srcCount}个订阅源\` : ''}\${srcCount && rawCount ? ' + ' : ''}\${rawCount ? \`\${rawCount}条链接\` : ''} · \${date} · \${unlocked.hasContent ? '📦 已缓存' : '⏳ 待生成'}\`;</span>\`;
                } else {
                    info.innerHTML = \`<span class="saved-code">\${labelText ? '' : '🔒 '}/s/\${item.code}</span><span class="saved-meta">\${date}\${labelText ? \` · \${labelText}\` : ' · 输入口令后显示详情'}\`;</span>\`;
                }
```

`editBtn.onclick` 中回填调用改为 `fillFormFromParams(unlocked2.resp)`；`clearBtn` 中删除 `const u = unlockedInfo.get(item.code); if (u) {...}` 块，改为直接 `unlockedInfo.delete(item.code);` 后重渲染前重新拉列表（`loadSavedList(savedPager.page)` 替换 `renderSavedList(currentSavedItems)`），保证 hasContent 刷新。`copyBtn` 文案「解密密钥错误」统一改「访问口令错误」。

- [ ] **Step 6: fillFormFromParams 改签名（page.js 约 1028-1068 行）**

将函数开头（`const modeId = params.target;` 到模板/链接回填段）替换为：

```js
        // 将保存的配置回填到表单（resp = /api/short/get 响应）
        function fillFormFromParams(resp) {
            const modeId = resp.target;
            if (!MODES_META[modeId]) return;
            const modeOpt = document.querySelector(\`#modeDropdown .template-opt[data-mode-id="\${modeId}"]\`);
            if (modeOpt) modeOpt.click();

            const wrapper = document.getElementById(\`links-wrapper-\${modeId}\`);
            if (wrapper) {
                wrapper.innerHTML = '';
                (resp.sources || []).forEach((s) => {
                    if (!s.name) {
                        showToast(\`⚠️ 原始订阅（\${s.id.slice(0, 8)}…）已删除，已跳过\`, 'error');
                        return;
                    }
                    addLinkRow(\`links-wrapper-\${modeId}\`, modeId);
                    const row = wrapper.lastElementChild;
                    setRowSource(row, s);
                });
                (resp.rawUrls || []).forEach(() => addLinkRow(\`links-wrapper-\${modeId}\`, modeId));
                const inputs = wrapper.querySelectorAll('.dynamic-link-input');
                let idx = 0;
                (resp.rawUrls || []).forEach((u) => {
                    if (inputs[idx]) inputs[idx++].value = u;
                });
            }
            const params = resp.params || {};
```

其后模板/协议回填代码保持不变（仍引用 `params`）。

- [ ] **Step 7: 弹窗文案与占位符（page.js 约 686 行）**

- `placeholder="请输入密钥"` → `placeholder="请输入访问口令"`
- `title="显示/隐藏密钥"` → `title="显示/隐藏口令"`
- `keyDialogLabel` 的 `placeholder="备注（可选，加密存储）"` → `placeholder="备注（可选）"`

- [ ] **Step 8: 构建验证 + 全量测试**

Run: `node esbuild.js && node --test test/shortlink/`
Expected: 打包成功；测试 PASS。`grep -c 'decryptBlobClient' src/core/page/page.js` = 0

- [ ] **Step 9: 提交**

```bash
git add src/core/page/page.js src/utils/shortlink/index.js src/server.js
git commit -m "feat: 保存流程改造（服务端加密+访问口令），移除客户端解密"
```

---

### Task 8: 前端 — 原始订阅库管理区块

**Files:**
- Modify: `src/core/page/page.js`

**Interfaces:**
- Consumes: `GET /api/source/list`、`POST /api/source/refresh {id}`、`POST /api/source/delete {id}`；Task 6 的 `loadSourceLibrary`（本任务实现，Task 6 的 saveRowToLibrary 已引用）

- [ ] **Step 1: HTML（savedCard 之后加入新卡片）**

```html
        <!-- 原始订阅库 -->
        <div class="form-card" id="sourceCard">
            <div class="section-title">🗃️ 原始订阅库</div>
            <div id="sourceList" style="display: flex; flex-direction: column; gap: 8px;"></div>
        </div>
```

- [ ] **Step 2: 管理逻辑（已保存订阅列表代码块之后加入）**

```js
        // ===== 原始订阅库管理 =====
        async function loadSourceLibrary() {
            const box = document.getElementById('sourceList');
            if (!box) return;
            try {
                const resp = await fetch('/api/source/list');
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(data.error);
                box.innerHTML = '';
                const items = data.items || [];
                if (!items.length) {
                    box.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem;">暂无原始订阅（在订阅链接行点 💾 保存）</div>';
                    return;
                }
                items.forEach((s) => {
                    const row = document.createElement('div');
                    row.className = 'saved-item';
                    const time = s.fetchedAt ? new Date(s.fetchedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
                    const info = document.createElement('div');
                    info.className = 'saved-info';
                    info.innerHTML = \`<span class="saved-mode">🗃️ \${s.name}</span><span class="saved-meta">\${time} 拉取 · 内容加密存储</span>\`;
                    const actions = document.createElement('div');
                    actions.className = 'saved-actions';
                    const refreshBtn = document.createElement('button');
                    refreshBtn.className = 'saved-btn';
                    refreshBtn.innerText = '刷新';
                    refreshBtn.onclick = async () => {
                        try {
                            refreshBtn.disabled = true;
                            const r = await fetch('/api/source/refresh', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: s.id }),
                            }).then((x) => x.json());
                            if (!r.success) throw new Error(r.error || '刷新失败');
                            showToast(\`✓ 已刷新「\${s.name}」，相关短链将自动重新生成\`, 'success');
                            loadSourceLibrary();
                        } catch (err) {
                            showToast(\`✗ \${err.message}\`, 'error');
                        } finally {
                            refreshBtn.disabled = false;
                        }
                    };
                    const delBtn = document.createElement('button');
                    delBtn.className = 'saved-btn saved-btn-danger';
                    delBtn.innerText = '删除';
                    delBtn.onclick = async () => {
                        if (!confirm(\`删除原始订阅「\${s.name}」？已生成缓存的短链仍可访问，但无法重新生成。\`)) return;
                        try {
                            const r = await fetch('/api/source/delete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: s.id }),
                            }).then((x) => x.json());
                            if (!r.success) throw new Error(r.error || '删除失败');
                            showToast('✓ 已删除', 'success');
                            loadSourceLibrary();
                        } catch (err) {
                            showToast(\`✗ \${err.message}\`, 'error');
                        }
                    };
                    actions.append(refreshBtn, delBtn);
                    row.append(info, actions);
                    box.appendChild(row);
                });
            } catch (err) {
                box.innerHTML = \`<div style="color: var(--text-muted); font-size: 0.8rem;">原始订阅库不可用：\${err.message}</div>\`;
            }
        }
```

- [ ] **Step 3: 页面初始化调用**

找到初始化处对 `loadSavedList(...)` 的调用（约在脚本底部），在其后追加：

```js
        loadSourceLibrary();
```

- [ ] **Step 4: 构建验证**

Run: `node esbuild.js`
Expected: 打包成功。`grep -c 'loadSourceLibrary' src/core/page/page.js` = 3（定义、💾保存后调用、初始化调用）

- [ ] **Step 5: 提交**

```bash
git add src/core/page/page.js src/server.js
git commit -m "feat: 原始订阅库管理区块（列表/刷新/删除）"
```

---

### Task 9: 端到端验证与收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-shortlink-source-library-design.md`（状态改「已实现」）
- Verify: 本地 `wrangler dev` + 浏览器

- [ ] **Step 1: 本地 Worker 验证（D1 本地模式）**

```bash
LINK_ENC_KEY=local-test-key-0123456789abcdef npx wrangler dev --local
```

（若本地 D1 需要初始化：`npx wrangler d1 execute cf-subcloud-links --local --command "DROP TABLE IF EXISTS short_links"`）

curl 冒烟（另开终端）：

```bash
# 1. 保存原始订阅（用任一可访问的订阅 URL；离线环境可用 https://httpbin.org/base64/dm1lc3M6Ly90ZXN0 返回 base64 内容）
curl -s -X POST http://127.0.0.1:8787/api/source/save -H 'Content-Type: application/json' \
  -d '{"url":"<订阅URL>","name":"测试机场"}'
# 期望 {"success":true,"id":"...","name":"测试机场"}

# 2. 源列表
curl -s http://127.0.0.1:8787/api/source/list
# 期望 success:true 且不含 url 字段

# 3. 保存短链（sources 用第 1 步返回的 id）
curl -s -X POST http://127.0.0.1:8787/api/short -H 'Content-Type: application/json' \
  -d '{"sources":["<id>"],"rawUrls":[],"target":"mihomo","params":{},"key":"pw123","label":"e2e"}'
# 期望 {"success":true,"code":"........"}

# 4. 访问短链（口令 base64：cHcxMjM=）
curl -s "http://127.0.0.1:8787/s/<code>?key=cHcxMjM=" -o /dev/null -w '%{http_code}\n'
# 期望 200（首次生成）；再次访问命中缓存

# 5. 错误口令
curl -s "http://127.0.0.1:8787/s/<code>?key=YmFk" 
# 期望 {"success":false,"error":"访问口令错误"}

# 6. 刷新源后再访问 → 自动重生成
curl -s -X POST http://127.0.0.1:8787/api/source/refresh -H 'Content-Type: application/json' -d '{"id":"<id>"}'
```

- [ ] **Step 2: 浏览器 UI 验证**

打开 `http://127.0.0.1:8787/`，核对清单：
1. 订阅行出现 💾 与 ▾；＋仍为加行
2. 粘贴订阅 URL → 💾 → 弹名称框 → 保存后行变「🗃️ 名称」标签
3. ▾ 下拉仅显示名称；选中后行为标签
4. 含标签行时生成 → 结果区显示 `?target=...&src=名称`；点「🔒 保存订阅内容」→ 口令弹窗（新文案）→ 生成短链并复制
5. 已保存订阅列表出现 label；解锁（口令）后显示来源数/缓存状态；「修改」回填（标签 + 裸 URL + 模板）；「清除」后回到 ⏳ 待生成
6. 原始订阅库卡片：刷新/删除生效；删除后被引用短链访问报「原始订阅已删除」（若已缓存则仍 200）
7. 错误口令在各入口均提示「访问口令错误」

- [ ] **Step 3: 全量测试 + 构建收尾**

Run: `node --test test/shortlink/ && node esbuild.js`
Expected: 全部 PASS、构建成功

- [ ] **Step 4: 更新设计文档状态并提交**

设计文档头部 `状态：已确认（待实现）` → `状态：已实现`。

```bash
git add docs/superpowers/specs/2026-09-26-shortlink-source-library-design.md src/server.js
git commit -m "chore: 短链存储改造收尾（设计文档状态更新 + 产物重建）"
```

- [ ] **Step 5: 部署提醒（不执行，告知用户）**

```
wrangler secret put LINK_ENC_KEY        # ≥32 位随机串
wrangler d1 execute cf-subcloud-links --remote --command "DROP TABLE IF EXISTS short_links"
wrangler deploy
```

---

## Self-Review 记录

- **Spec 覆盖**：§2 加密层→Task 1；§3 数据模型→Task 2/3（含旧表 DROP 自动化）；§4 文件组织→Task 1/2/3/5；§5 API→Task 5（index.js 路由全量实现）；§6 生成与失效→Task 5 serveLink + Task 4 拆分防护；§7 前端→Task 6/7/8；§9 部署→Task 9 提醒；§10 验证→各任务测试 + Task 9 e2e。§8 已知限制无需实现。
- **类型一致性**：`getKeys/encryptBlob/decryptBlob/hmacB64url/timingSafeEqual/base64ToBytes`（Task 1 定义，2/3/5/7 消费一致）；`saveSource/listSources/getSource/refreshSource/deleteSource`（Task 2 定义，5 消费一致）；`saveLink/listLinks/getLink/clearLink/serveLink/isCacheFresh/generateCode/ensureShortLinkTable`（Task 3 定义，5 消费一致）；`collectLinkRows/setRowSource/clearRowSource/askName`（Task 6 定义，7 消费一致）。
- **已知实现期风险**（Task 5 Step 4 允许迭代）：`e.urls` 是否为管线实际消费字段；Mihomo.yaml fixture 是否满足模板链路；heruser 双拉在缓存路径下不再发生（行为变化已在设计 §8 注明）。
