// 测试用内存 D1 mock，仅覆盖 shortlink 模块使用的 SQL 形态
export function createMockD1({ legacy = false, legacySources = false, noMd5 = false } = {}) {
    const state = {
        sub_sources: [],
        short_links: legacy ? [{ code: 'old00000', salt: 's', blob: 'b', created: 1 }] : [],
        legacy,
        legacySources,
        noCode: legacySources, // 旧表同时缺 code 列
        noMd5, // 有 pw_hash 但缺 url_md5 列的中间版本旧表
    };
    const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
    function exec(sql, args) {
        const s = norm(sql);
        if (/^CREATE TABLE IF NOT EXISTS \w+/.test(s)) return null;
        if (/^CREATE UNIQUE INDEX/.test(s)) return null;
        if (/^DROP TABLE short_links$/.test(s)) {
            state.short_links = [];
            state.legacy = false;
            return null;
        }
        if (/^ALTER TABLE short_links ADD COLUMN url_md5 TEXT$/.test(s)) {
            state.noMd5 = false;
            return null;
        }
        if (/^ALTER TABLE sub_sources ADD COLUMN ua TEXT NOT NULL DEFAULT 'v2ray'$/.test(s)) {
            state.legacySources = false;
            return null;
        }
        if (/^ALTER TABLE sub_sources ADD COLUMN code TEXT$/.test(s)) {
            state.noCode = false;
            return null;
        }
        if (/^SELECT ua FROM sub_sources LIMIT 1$/.test(s)) {
            if (state.legacySources) throw new Error('no such column: ua');
            return state.sub_sources[0] || null;
        }
        if (/^SELECT code FROM sub_sources LIMIT 1$/.test(s)) {
            if (state.noCode) throw new Error('no such column: code');
            return state.sub_sources[0] || null;
        }
        if (/^SELECT id FROM sub_sources WHERE code = \? LIMIT 1$/.test(s)) {
            const hit = state.sub_sources.find((r) => r.code === args[0]);
            return hit ? { id: hit.id } : null;
        }
        if (/^INSERT INTO sub_sources/.test(s)) {
            const [id, name, blob, fetchedAt, ua, code] = args;
            const row = { id, name, blob, fetched_at: fetchedAt, ua: ua ?? 'v2ray', code: code ?? null };
            const i = state.sub_sources.findIndex((r) => r.id === id);
            if (i >= 0) state.sub_sources[i] = row;
            else state.sub_sources.push(row);
            return null;
        }
        if (/^INSERT INTO short_links/.test(s)) {
            const [code, blob, pwHash, created, urlMd5] = args;
            const row = { code, blob, pw_hash: pwHash, created, url_md5: urlMd5 ?? null };
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
        if (/^SELECT url_md5 FROM short_links LIMIT 1$/.test(s)) {
            if (state.noMd5) throw new Error('no such column: url_md5');
            return state.short_links[0] || null;
        }
        if (/^SELECT \* FROM sub_sources WHERE id = \?$/.test(s)) {
            return state.sub_sources.find((r) => r.id === args[0]) || null;
        }
        if (/^SELECT \* FROM short_links WHERE code = \?$/.test(s)) {
            return state.short_links.find((r) => r.code === args[0]) || null;
        }
        if (/^SELECT code, pw_hash FROM short_links WHERE url_md5 = \? LIMIT 1$/.test(s)) {
            const hit = state.short_links.find((r) => r.url_md5 === args[0]);
            return hit ? { code: hit.code, pw_hash: hit.pw_hash } : null;
        }
        if (/^DELETE FROM short_links WHERE code = \?$/.test(s)) {
            state.short_links = state.short_links.filter((r) => r.code !== args[0]);
            return null;
        }
        if (/^SELECT id, name, code, fetched_at FROM sub_sources ORDER BY fetched_at DESC$/.test(s)) {
            return [...state.sub_sources].sort((a, b) => b.fetched_at - a.fetched_at).map((r) => ({ id: r.id, name: r.name, code: r.code ?? null, fetched_at: r.fetched_at }));
        }
        if (/^SELECT COUNT\(\*\) AS total FROM short_links$/.test(s)) {
            return { total: state.short_links.length };
        }
        if (/^SELECT code, created, pw_hash FROM short_links ORDER BY created DESC, code LIMIT \? OFFSET \?$/.test(s)) {
            const rows = [...state.short_links].sort((a, b) => b.created - a.created || (a.code < b.code ? -1 : 1));
            return rows.slice(args[1], args[1] + args[0]).map((r) => ({ code: r.code, created: r.created, pw_hash: r.pw_hash }));
        }
        if (/^UPDATE sub_sources SET name = \? WHERE id = \?$/.test(s)) {
            const row = state.sub_sources.find((r) => r.id === args[1]);
            if (row) row.name = args[0];
            return null;
        }
        if (/^UPDATE sub_sources SET name = \?, code = \? WHERE id = \?$/.test(s)) {
            const row = state.sub_sources.find((r) => r.id === args[2]);
            if (row) {
                row.name = args[0];
                row.code = args[1];
            }
            return null;
        }
        if (/^UPDATE sub_sources SET code = \? WHERE id = \?$/.test(s)) {
            const row = state.sub_sources.find((r) => r.id === args[1]);
            if (row) row.code = args[0];
            return null;
        }
        if (/^UPDATE sub_sources SET blob = \?, fetched_at = \?, ua = \? WHERE id = \?$/.test(s)) {
            const row = state.sub_sources.find((r) => r.id === args[3]);
            if (row) {
                row.blob = args[0];
                row.fetched_at = args[1];
                row.ua = args[2];
            }
            return null;
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

// 标准 v2ray 订阅格式：base64( "vmess://" + base64(vmess json) )，可被 ProxyUtils.parse 识别
const VMESS_URI = 'vmess://' + btoa(JSON.stringify({ v: '2', ps: 'test-node', add: '1.2.3.4', port: '443', id: '0b8a1dd3-dc5a-4e33-8f1f-4e6f6e6f6e6f', aid: '0', net: 'tcp', type: 'none', scy: 'auto' }));
export const SAMPLE_B64_SUB = btoa(VMESS_URI);
