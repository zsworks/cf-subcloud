// 本地运行 relay 处理器（与 Vercel @vercel/node 相同的 req/res 形态）
// 用法: RELAY_TOKEN=devtoken node dev.mjs [port]
import http from 'node:http';
import handler from './api/relay.js';

process.env.RELAY_TOKEN ||= 'devtoken';
const port = Number(process.argv[2] || process.env.PORT || 9990);

http.createServer((req, res) => handler(req, res)).listen(port, '127.0.0.1', () => {
    console.log(`relay(dev) on http://127.0.0.1:${port}/api/relay  RELAY_TOKEN=${process.env.RELAY_TOKEN}`);
});
