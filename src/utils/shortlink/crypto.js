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
