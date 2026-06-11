// Gmail session token storage: encrypt the access token into an opaque cookie
// value. The token is NEVER persisted server-side (no Firestore/log/memory) —
// the encrypted blob lives only in the user's httpOnly/Secure/SameSite=Lax
// cookie. AES-256-GCM gives both confidentiality and tamper detection (auth
// tag), so a forged or truncated cookie decrypts to null rather than a
// half-valid token.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length

export const SESSION_COOKIE = "gmail_session";
export const STATE_COOKIE = "gmail_oauth_state";

export type GmailSession = {
  accessToken: string;
  expiresAt: number; // epoch ms
};

function getKey(): Buffer | null {
  const raw = process.env.GMAIL_SESSION_KEY;
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  if (key.length !== KEY_BYTES) return null;
  return key;
}

// True when a usable 32-byte key is configured. Used by the auth route to fail
// fast with 503 instead of starting a flow it cannot complete at callback.
export function sessionKeyConfigured(): boolean {
  return getKey() !== null;
}

export function encryptSession(session: GmailSession): string | null {
  const key = getKey();
  if (!key) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptSession(
  value: string | undefined | null,
): GmailSession | null {
  const key = getKey();
  if (!key || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], "base64url");
    const ciphertext = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    if (iv.length !== IV_BYTES) return null;
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as GmailSession).accessToken === "string" &&
      typeof (parsed as GmailSession).expiresAt === "number"
    ) {
      const { accessToken, expiresAt } = parsed as GmailSession;
      return { accessToken, expiresAt };
    }
    return null;
  } catch {
    // Bad key, tampered ciphertext, or malformed JSON — all collapse to null.
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

export type CookieOptions = {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
};

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const segments = [`${name}=${value}`];
  segments.push(`Path=${options.path ?? "/"}`);
  if (options.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) segments.push("HttpOnly");
  if (options.secure) segments.push("Secure");
  if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
  return segments.join("; ");
}

// httpOnly/Secure/SameSite=Lax is the fixed posture for both cookies (per the
// G1 design constraint). Secure stays on even for local dev — Chrome honors
// Secure cookies on http://localhost; Safari does not (see gmail-integration
// notes: local dev/demo is Chrome-only).
const BASE_COOKIE: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
};

export function sessionCookieOptions(maxAgeSeconds: number): CookieOptions {
  return { ...BASE_COOKIE, maxAge: Math.max(0, Math.floor(maxAgeSeconds)) };
}

export function stateCookieOptions(maxAgeSeconds: number): CookieOptions {
  return { ...BASE_COOKIE, maxAge: Math.max(0, Math.floor(maxAgeSeconds)) };
}

export function clearCookie(name: string): string {
  return serializeCookie(name, "", { ...BASE_COOKIE, maxAge: 0 });
}
