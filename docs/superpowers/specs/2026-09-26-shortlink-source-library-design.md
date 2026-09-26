# 短链存储改造：环境变量密钥加密 + 原始订阅库设计

- 日期：2026-09-26
- 状态：已确认（待实现）
- 分支：feature/r2-shortlink

## 1. 背景与目标

当前短链实现（`src/utils/shortlink.js`）用**用户自设密钥**（PBKDF2 + AES-GCM）加密订阅配置存入 D1，密钥以 base64 附在分享链接 `?key=` 中，前端弹窗输入密钥后从 `/api/short/get` 拿密文本地解密。

本次改造目标：

1. **存储态加密改为环境变量密钥**：D1 中密文仅持有 `LINK_ENC_KEY` 的应用自身可解（整库泄露亦不可解）。
2. **原始订阅与生成订阅分离**：上游原始订阅单独建库，以 URL 的 HMAC 为主键（去重、可直接 UPDATE），可命名、可从下拉选用；生成内容独立缓存。
3. **用户密钥降级为访问口令**：访问短链 / 更新 / 清除时校验口令（存 HMAC 哈希，不参与加密）。

### 已确认的决策

| 决策点 | 结论 |
|--------|------|
| 用户密钥体系 | 保留为访问口令（HMAC 哈希校验），不再参与加密 |
| 存量旧密文数据 | 清空重建（应用无法自行解密旧数据） |
| 下拉选用原始订阅 | 只回名称，URL 不出服务端 |
| 原始内容拉取时机 | 保存即拉取（实时拉上游，成功才入库） |
| 入库触发方式 | 每行独立 💾 保存按钮，弹窗输入名称；＋按钮保持加行职能 |
| 未保存的裸 URL | 保持现状：生成时实时拉上游，不入库 |

## 2. 加密层

环境变量：`LINK_ENC_KEY`（≥32 位随机串，`wrangler secret put` 配置）。

派生（域分离）：

```
encKey  = SHA-256( UTF8(LINK_ENC_KEY) || "enc" )   → AES-256-GCM 密钥
authKey = SHA-256( UTF8(LINK_ENC_KEY) || "auth" )  → HMAC-SHA256 密钥
```

- **加密**：`blob = base64( IV(12B 随机) ‖ AES-GCM(明文) )`，明文为 JSON 序列化对象。无 PBKDF2（环境密钥高熵，无需慢哈希，且比现状每次 10 万轮快）。
- **源主键**：`id = base64url( HMAC-SHA256(authKey, url) )`。确定性（同 URL 同 id，去重/upsert），无环境变量不可枚举碰撞测试。
- **口令哈希**：`pw_hash = base64url( HMAC-SHA256(authKey, 口令) )`，比较用恒时比较（`crypto.subtle.timingSafeEqual`）。
- 未配置环境变量：所有短链/源接口返回 500，错误信息「未配置加密密钥环境变量 LINK_ENC_KEY」。
- 密钥轮换：全部密文与哈希失效，属预期行为，需清表重建（部署文档注明）。

## 3. 数据模型（D1，绑定 `SHORT_LINK`）

```sql
-- 原始订阅库
CREATE TABLE IF NOT EXISTS sub_sources (
    id         TEXT PRIMARY KEY,  -- base64url(HMAC-SHA256(authKey, url))
    name       TEXT NOT NULL,     -- 简短名称（明文，仅下拉展示）
    blob       TEXT NOT NULL,     -- AES-GCM{url, content, headers}
    fetched_at INTEGER NOT NULL   -- 内容拉取时间（失效判断）
);

-- 生成订阅（分享短链）
CREATE TABLE IF NOT EXISTS short_links (
    code    TEXT PRIMARY KEY,
    blob    TEXT NOT NULL,        -- AES-GCM{version:3, target, params, sources[], rawUrls[], label,
                                  --        content?, textHeaders?, srcFetched[]}
    pw_hash TEXT NOT NULL,        -- base64url(HMAC-SHA256(authKey, 口令))
    created INTEGER NOT NULL
);
```

`sub_sources.blob` 内部结构：`{url, content(上游原始内容文本), headers(含 subscription-userinfo)}`。

`short_links.blob` 内部结构：

- `sources`：引用的原始订阅 id 列表；`rawUrls`：裸 URL 列表（加密存储，不入源库）
- `content` / `textHeaders`：生成内容缓存（惰性生成后回写）
- `srcFetched[]`：生成时各 source 的 `fetched_at` 快照，用于失效判断

对比旧表：去掉 `salt` 列，新增 `pw_hash` 列；旧 `short_links` 表一次性 DROP。

## 4. 文件组织

`shortlink.js`（263 行）拆分为模块目录，单一职责：

```
src/utils/shortlink/
  crypto.js    — 密钥派生、AES-GCM 加解密、HMAC、恒时比较、id/pw_hash 生成
  sources.js   — 原始订阅库：save/list/refresh/delete + fetchSource（实时拉上游）
  links.js     — 生成订阅：save/get/list/clear + /s/{code} 生成管线
  index.js     — handleShortLink 路由分发（worker.js 导入点不变）
```

## 5. API 设计（全部 Workers 端）

### 原始订阅库

| 接口 | 语义 |
|------|------|
| `POST /api/source/save` `{url, name}` | 校验 URL → 实时拉上游（`fetchResponse(url, 'v2ray')`）→ 成功才 upsert（同 URL 重复保存 = 改名 + 刷新内容）→ `{id, name}`；失败报错不入库 |
| `GET /api/source/list` | `{name, id, fetchedAt}[]`，不含 URL |
| `POST /api/source/refresh` `{id}` | 重新拉上游 → UPDATE `blob` + `fetched_at` |
| `POST /api/source/delete` `{id}` | 删除该源 |

### 生成订阅

| 接口 | 语义 |
|------|------|
| `POST /api/short` `{sources[], rawUrls[], target, template及协议参数, label?, key(口令), code?, oldKey?}` | 新建：随机 base62 短码 + 加密 blob + pw_hash；更新：oldKey HMAC 恒时校验后覆盖。生成参数以现有表单参数为准 |
| `GET /api/short/list?page=&limit=` | code + created + 解密后的 label（分页不变） |
| `GET /api/short/get?code=&key=` | 服务端验口令 → 解密 → 返回回填数据（source 以名称表示、rawUrls 明文返回给表单） |
| `POST /api/short/clear` `{code, key}` | 验口令 → 清除生成内容缓存（源库内容不动） |
| `GET /s/{code}?key=口令base64` | 验口令（HMAC）→ 见 §6 生成逻辑 |

错误区分：缺 `key` 参数与口令错误返回不同提示（沿用现有文案基调）。

## 6. 生成逻辑与失效

`GET /s/{code}`：

1. 查行 → 验口令（HMAC 恒时比较）→ 解密 blob。
2. 有 `content` 缓存且 `srcFetched[]` 与各源当前 `fetched_at` 一致 → 直接返回缓存。
3. 否则重新生成：
   - 每个 `source.id` 取源库缓存内容；源缺失则实时拉上游并回填库；
   - `rawUrls` 实时拉上游；
   - **将原始内容直接作为非 URL 项喂给转换管线**（`src/core/sub/index.js` 的 `produceArtifact` 对非 URL 项走 `ProxyUtils.parse`，不回源）；
   - 流量信息从源缓存 `headers` 提供（替代现状 heruser 双拉）；
   - 生成成功 → 连同 `srcFetched[]` 快照加密回写缓存；失败 → 返回错误。
4. 源被删除：已有生成缓存仍可 serve；需重生成时报「原始订阅已删除」。
5. 仅含裸 URL（无 source 引用）的配置：`srcFetched[]` 为空 → 缓存恒有效，直到手动清除（与现状行为一致）。

生成请求仍按 target 伪装合法 UA 通过 CHECKUA（沿用 `UA_MAP`）。

**喂管线机制**：两种实现路径——(a) 内部构造请求复用 `handleRequest` 全管线（模板/规则完整应用，但内容进 URL 参数可能超长）；(b) 直接调用 `processSubscription`/`getNodeConversion`（无 URL 长度限制，需自行传递其余参数）。实现计划阶段以 (b) 为基准评估，若模板/规则链路复杂则回退 (a)。

## 7. 前端（`src/core/page/page.js`）

- **订阅行三态**：空输入（可下拉选源）→ 裸 URL 输入 → 名称标签（已入库源，表单持有 `id`）。
- **💾 每行保存按钮**：粘贴 URL → 点击 → 弹窗输入名称 → 调 `/api/source/save`（按钮 loading，实时拉上游）→ 成功后该行变名称标签、URL 清空；失败 toast 报错、行不变。
- **下拉选源**：空行下拉箭头 → 列出已保存源（仅名称）→ 选中变名称标签。URL 不回显。
- **＋按钮**：保持加行职能不变。
- **生成**：裸 URL 行为不变；名称标签行以 id 引用参与保存。
- **已保存订阅列表**：展示来源名称标签 + label；解锁（口令）后回填表单 / 复制 `/s/短码?key=口令base64` / 清除缓存。会话内已验证口令缓存逻辑沿用。
- **原始订阅管理区块**（新增）：名称 + 拉取时间 + 刷新 / 删除操作。
- **删除**：客户端解密代码（`decryptBlobClient`、前端 PBKDF2）整体移除；解锁/回填改调 `/api/short/get`。
- **密钥弹窗文案**：改为访问口令语义（「口令用于访问/修改校验，数据加密由服务端环境变量密钥完成」）。

## 8. 已知限制（有意接受）

- 口令遗忘无法找回，只能弃用短码重建（无管理端重置，YAGNI）。
- 源管理接口与生成接口无鉴权（与现状一致；自托管单用户前提）。
- 环境密钥轮换 = 全部数据失效，需清表重建。
- 上游按 UA 返回不同内容：源缓存固定 v2ray UA 拉取（解析兼容性最好）。
- Vercel 产物（`src/server.js`）包含页面 UI 但短链/源接口仅 Workers + D1 可用（与现状一致）。

## 9. 部署步骤

```
wrangler secret put LINK_ENC_KEY        # ≥32 位随机串
wrangler d1 execute cf-subcloud-links --remote --command "DROP TABLE IF EXISTS short_links"
wrangler deploy
# sub_sources / short_links 新表由应用惰性建表自动创建
```

## 10. 验证计划

`wrangler dev` + 本地 D1，覆盖：

1. 💾 保存源（含实时拉取、重名改名、URL 重复 upsert、上游失败不入库）
2. 下拉选源回名称、生成配置、保存短链（口令）
3. 列表 / 解锁回填（口令正确与错误）
4. `/s/短码`：首次生成缓存 → 再次访问命中缓存 → 刷新源后自动重生成
5. 更新短链（验 oldKey）、清除缓存
6. 未配置 `LINK_ENC_KEY` 时各接口报错
7. `node esbuild.js` 重新构建 `src/server.js` / `dist/_worker.js`，确认打包产物包含新模块
