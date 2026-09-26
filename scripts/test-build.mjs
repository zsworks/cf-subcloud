// 测试套件先经 esbuild 打包再跑：解析 Sub-Store 的 jsconfig @/ 别名（Node 原生不支持），
// 并与生产构建一致地强制 vendor open-api 的 isNode=false
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import fs from 'node:fs/promises';

const replaceOpenApiIsNode = {
    name: 'replace-open-api-is-node',
    setup(build) {
        build.onLoad({ filter: /open-api\.js$/ }, async (args) => {
            let contents = await fs.readFile(args.path, 'utf8');
            if (args.path.includes(path.join('src', 'core', 'Sub-Store', 'backend', 'src', 'vendor'))) {
                contents = contents.replace(/const\s+isNode\s*=\s*eval\(`typeof process !== "undefined"`\)\s*;/, 'const isNode = false;');
            }
            return { contents, loader: 'js' };
        });
    },
};

const files = readdirSync('test/shortlink')
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => `test/shortlink/${f}`);

await build({
    entryPoints: files,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outdir: '.test-dist',
    logLevel: 'warning',
    plugins: [replaceOpenApiIsNode],
});

const outs = files.map((f) => `.test-dist/${f.split('/').pop().replace(/\.mjs$/, '.js')}`);
const run = spawnSync('node', ['--test', ...outs], { stdio: 'inherit' });
process.exit(run.status ?? 1);
