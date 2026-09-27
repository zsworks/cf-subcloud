#!/usr/bin/env node
// 本机拉取订阅 → 推送到 cf-subcloud 订阅库
// 用途：机场 WAF 封禁数据中心出口（Cloudflare/Vercel 均被拒）时，
//       用你自己的网络（住宅 IP）拉取订阅内容，推送到服务端加密入库。
//
// 用法:
//   node scripts/pull-source.mjs --url <订阅地址> --name <名称> [--target mihomo] \
//        [--host https://ss.zworks.me] [--token <ADMIN_TOKEN>]
//
// token 也可用环境变量 ADMIN_TOKEN 传入。

import { spawnSync } from 'node:child_process';
import { UA_MAP, resolveSourceUa } from '../src/utils/shortlink/ua.js';

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const key = argv[i]?.replace(/^--/, '');
        const next = argv[i + 1];
        if (!key || next === undefined || next.startsWith('--')) {
            if (key) args[key] = true;
            continue;
        }
        args[key] = next;
        i++;
    }
    return args;
}

const args = parseArgs(process.argv);
if (!args.url || !args.name) {
    console.error('用法: node scripts/pull-source.mjs --url <订阅地址> --name <名称> [--target mihomo] [--host https://ss.zworks.me] [--token <ADMIN_TOKEN>]');
    process.exit(2);
}

const host = (args.host || 'https://ss.zworks.me').replace(/\/+$/, '');
const target = String(args.target || 'mihomo');
const token = args.token || process.env.ADMIN_TOKEN;
if (!token) {
    console.error('缺少 ADMIN_TOKEN（--token 或环境变量）');
    process.exit(2);
}
const ua = resolveSourceUa(target);
console.log(`拉取 ${args.url}`);
console.log(`UA: ${ua}`);
// 经 curl 拉取：部分机场 WAF 检测 TLS 指纹，Node fetch(undici) 会被拒，curl 可通过
const curl = spawnSync('curl', ['-fsSL', '--max-time', '60', '-A', ua, String(args.url)], {
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
});
if (curl.error) {
    console.error(`curl 执行失败: ${curl.error.message}`);
    process.exit(1);
}
if (curl.status !== 0) {
    console.error(`拉取失败: curl 退出码 ${curl.status}${curl.stderr ? '\n' + curl.stderr.slice(0, 300) : ''}`);
    process.exit(1);
}
const content = curl.stdout;
console.log(`拉取成功: ${content.length} 字节`);

const push = await fetch(`${host}/api/source/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ url: args.url, name: args.name, target, content }),
});
const out = await push.json();
if (!push.ok || !out.success) {
    console.error(`推送失败: ${push.status}`, out);
    process.exit(1);
}
console.log(`已入库: ${out.name} (${out.id})`);
