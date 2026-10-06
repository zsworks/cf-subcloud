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

// 纯 JS MD5（十六进制小写）：短链内容查重摘要用。
// Node 的 webcrypto 不支持 MD5、Workers 无 node:crypto，故不依赖运行时实现
export function md5Hex(input) {
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K = new Int32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

    const msg = encoder.encode(input);
    const bitLen = msg.length * 8;
    const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64);
    padded.set(msg);
    padded[msg.length] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, bitLen >>> 0, true);
    dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

    const rl = (x, c) => (x << c) | (x >>> (32 - c));
    let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    for (let chunk = 0; chunk < padded.length; chunk += 64) {
        const M = new Int32Array(16);
        for (let j = 0; j < 16; j++) M[j] = dv.getInt32(chunk + j * 4, true);
        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            F = (F + A + K[i] + M[g]) | 0;
            A = D; D = C; C = B;
            B = (B + rl(F, S[i])) | 0;
        }
        a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new DataView(new ArrayBuffer(16));
    out.setInt32(0, a0, true); out.setInt32(4, b0, true); out.setInt32(8, c0, true); out.setInt32(12, d0, true);
    return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 键序无关的规范化 JSON（递归排序对象键）：查重摘要输入，保证同内容不同键序得到同一 MD5
export function canonicalStringify(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
