// 裸 Node 下解析 Sub-Store 后端源码：
// 1. '@/…' 别名（与 esbuild 经 jsconfig paths 的映射一致）
// 2. ESM 不支持的目录导入补全（'./x' → './x.js' / './x/index.js'）
// 3. 源码裸导入 package.json 且使用命名导入——合成 default + 顶层键命名导出的 ES 模块
// 4. vendor/open-api.js 的 isNode 判定替换为 false（与生产构建 replaceOpenApiIsNode 插件一致）
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BACKEND_ROOT = fileURLToPath(new URL('../../src/core/Sub-Store/backend/', import.meta.url));
const BACKEND_ROOT_URL = pathToFileURL(BACKEND_ROOT).href;

const isFile = (u) => {
    try {
        return statSync(u).isFile();
    } catch {
        return false;
    }
};

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
        const rel = specifier.slice(2);
        for (const candidate of [rel, `${rel}.js`, `${rel}/index.js`]) {
            const file = pathToFileURL(BACKEND_SRC + candidate);
            if (isFile(file)) return { url: file.href, shortCircuit: true, format: 'module' };
        }
    } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
        const parentDir = new URL('.', context.parentURL);
        const direct = new URL(specifier, parentDir);
        if (isFile(direct)) {
            // backend 内的 JSON：短路默认解析，绕过 import attributes 校验，交给 load 合成模块
            if (direct.href.startsWith(BACKEND_ROOT_URL) && direct.href.endsWith('.json')) {
                return { url: direct.href, shortCircuit: true, format: 'module' };
            }
            return nextResolve(specifier, context);
        }
        for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
            const u = new URL(candidate, parentDir);
            if (isFile(u)) return { url: u.href, shortCircuit: true, format: 'module' };
        }
    }
    return nextResolve(specifier, context);
}

const BACKEND_SRC = fileURLToPath(new URL('src/', pathToFileURL(BACKEND_ROOT)));

export async function load(url, context, nextLoad) {
    if (url.startsWith(BACKEND_ROOT_URL) && url.endsWith('.json')) {
        const raw = readFileSync(fileURLToPath(url), 'utf8');
        let source = raw;
        try {
            const json = JSON.parse(raw);
            const named = Object.keys(json)
                .filter((k) => /^[A-Za-z_$][\w$]*$/.test(k))
                .map((k) => `export const ${k} = pkg[${JSON.stringify(k)}];`)
                .join('\n');
            source = `const pkg = ${raw};\nexport default pkg;\n${named}`;
        } catch {}
        return { source, format: 'module', shortCircuit: true };
    }
    if (url.includes('/backend/src/vendor/open-api.js')) {
        let source = readFileSync(fileURLToPath(url), 'utf8');
        source = source.replace(/const\s+isNode\s*=\s*eval\(`typeof process !== "undefined"`\)\s*;/, 'const isNode = false;');
        return { source, format: 'module', shortCircuit: true };
    }
    return nextLoad(url, context);
}
