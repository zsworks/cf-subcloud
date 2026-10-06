# AGENTS.md

cf-subcloud（星尘转换器）：Cloudflare Workers 多合一订阅转换服务，支持 mihomo（Clash.Meta）/ sing-box / v2ray 三种目标；Node（`src/server.js`）为辅助部署目标，短链功能仅 Worker 链路（依赖 D1）。

## 常用命令

- 构建：`node esbuild.js` —— 产物 `dist/_worker.js`（Worker 入口，部署用）与 `src/server.js`（Node/Vercel 产物，构建产物随源码入库，源码改动后必须重建）
- 测试：`pnpm test` —— 全套应为绿色；裸 Node 跑 Sub-Store 源码依赖 `test/helpers/`（DOM stub + `@/` 别名/目录导入/JSON 导入 loader），勿删
- 本地起服务：`PORT=3000 node src/server.js`（注意 PORT 环境变量实际不生效，固定 3000）
- 部署：`source ~/.token/token_env.sh && npx wrangler deploy`（凭据机制见全局 `~/.zcode/AGENTS.md`）
- 开发调试：`pnpm dev`（`dist/min.js` 为 dev 构建，无 vendor 处理插件，若报 `document is not defined` 用 `node src/server.js` 代替）

## 出站 UA 约定

- 本服务的**所有出站请求**（拉取订阅源、规则模板、远程模板列表）的 User-Agent 必须附加 ` [REDACTED]` 后缀，例如 `clash-verge/2.0 [REDACTED]`，便于上游识别请求来自本服务
- 实现点：
  - `src/utils/fetchResponse.js` —— 订阅/模板拉取的唯一出口，`UA_SUFFIX` 常量定义于此，经 `withUaSuffix` 统一追加（含中转链路的 `ua` 参数透传）；改后缀值只改这一处
  - `src/core/page/page.js` —— `templates.json` 远程模板列表拉取单独带 `UA_SUFFIX`
- 新增出站请求时沿用同一约定，不要直连 `fetch` 裸 UA

## 架构要点

- 短链（`src/utils/shortlink/`）：仅存 URL 参数与来源引用（`url_md5` 唯一列按内容查重复用短码），访问 `/s/{code}` 时实时重新生成，不缓存生成内容；口令哈希存库，内容知道 ≠ 所有权（同内容不同口令复用短码但原口令仍有效）
- 模板：内置 `template/` 目录经 ASSETS 绑定进程内读取；`TEMPLATE_URL` 可整体替换模板列表，`TPLMH`/`TPLSB` 追加自定义远程模板（支持 `#名称` 自定义显示名）
- 上游拉取 UA 按客户端类型伪装（`src/utils/shortlink/ua.js` 的 `UA_MAP`），机场后端按 UA 嗅探返回格式
