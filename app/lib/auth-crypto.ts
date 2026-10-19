import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_VERSION = "v1";
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

function deriveScrypt(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        nodeScrypt(password, salt, keyLength, {
            N: SCRYPT_N,
            r: SCRYPT_R,
            p: SCRYPT_P,
            maxmem: SCRYPT_MAX_MEMORY,
        }, (error, derivedKey) => {
            if (error) reject(error);
            else resolve(derivedKey);
        });
    });
}

export async function hashAccountPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await deriveScrypt(password, salt, SCRYPT_KEY_LENGTH);
    return [
        "scrypt",
        SCRYPT_VERSION,
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        salt.toString("base64url"),
        derivedKey.toString("base64url"),
    ].join("$");
}

export async function verifyAccountPassword(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split("$");
    if (
        parts.length !== 7
        || parts[0] !== "scrypt"
        || parts[1] !== SCRYPT_VERSION
        || Number(parts[2]) !== SCRYPT_N
        || Number(parts[3]) !== SCRYPT_R
        || Number(parts[4]) !== SCRYPT_P
    ) return false;

    try {
        const salt = Buffer.from(parts[5] ?? "", "base64url");
        const expected = Buffer.from(parts[6] ?? "", "base64url");
        if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
        const actual = await deriveScrypt(password, salt, expected.length);
        return timingSafeEqual(actual, expected);
    }
    catch {
        return false;
    }
}

/**
 * Role PINs deliberately use a distinct encoding prefix so a PIN credential
 * can never be mistaken for an account password hash (or vice versa).
 */
export async function hashRolePin(pin: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await deriveScrypt(pin, salt, SCRYPT_KEY_LENGTH);
    return [
        "scrypt-pin",
        SCRYPT_VERSION,
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        salt.toString("base64url"),
        derivedKey.toString("base64url"),
    ].join("$");
}

export async function verifyRolePin(pin: string, encoded: string): Promise<boolean> {
    const parts = encoded.split("$");
    if (
        parts.length !== 7
        || parts[0] !== "scrypt-pin"
        || parts[1] !== SCRYPT_VERSION
        || Number(parts[2]) !== SCRYPT_N
        || Number(parts[3]) !== SCRYPT_R
        || Number(parts[4]) !== SCRYPT_P
    ) return false;

    try {
        const salt = Buffer.from(parts[5] ?? "", "base64url");
        const expected = Buffer.from(parts[6] ?? "", "base64url");
        if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
        const actual = await deriveScrypt(pin, salt, expected.length);
        return timingSafeEqual(actual, expected);
    }
    catch {
        return false;
    }
}

export function createOpaqueToken(): string {
    return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
    return `sha256:v1:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export const createSessionToken = createOpaqueToken;
export const hashSessionToken = hashOpaqueToken;
