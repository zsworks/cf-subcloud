# Vercel 出站中转（fetch relay）

一个单文件 Vercel Serverless 函数，代替 Cloudflare Worker 出站拉取订阅上游。
用途：部分机场/订阅转换站按来源 IP 封禁 Cloudflare 出口段（403/连接挂起），
Vercel 的出口 IP 不在其列。cf-subcloud 主应用配置两个环境变量后，
所有订阅拉取（订阅源入库/刷新、订阅转换）自动改经本服务。

## 接口

```
GET /api/relay?url=<目标URL>&ua=<可选User-Agent>
     头部: x-relay-token: <RELAY_TOKEN>
（也支持 POST JSON {url, ua}；/relay 为别名）
```

- 返回上游真实状态码与响应体，透传 `content-type`、`subscription-userinfo` 等头
- 鉴权失败/参数错误/内网目标返回 4xx/5xx JSON，并带 `x-relay-error: 1` 头
  （主应用据此自动回退直连）
- 安全：令牌常数时间比较；拒绝内网/链路本地地址（含 DNS 解析结果与逐跳重定向复查）

## 环境变量

| 变量 | 说明 |
|------|------|
| `RELAY_TOKEN` | 必填，访问令牌，任意高熵随机串（`openssl rand -hex 24`） |

## 部署

```bash
cd relay
npx vercel login            # 或后续命令统一加 --token <VERCEL_TOKEN>
npx vercel env add RELAY_TOKEN production
npx vercel deploy --prod
```

## 主应用接入（Cloudflare Worker）

```bash
npx wrangler secret put FETCH_RELAY_URL    # 输入 https://<app>.vercel.app/api/relay
npx wrangler secret put FETCH_RELAY_TOKEN  # 输入与 RELAY_TOKEN 相同的值
```

secret 即刻生效，无需重新部署 worker。取消中转：删除两个 secret 即回退全直连。

## 本地调试

```bash
RELAY_TOKEN=devtoken node dev.mjs   # 监听 127.0.0.1:9990
curl 'http://127.0.0.1:9990/api/relay?url=https%3A%2F%2Fexample.com&token=devtoken'
```
