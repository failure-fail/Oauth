import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { config } from "./config";

function keyBytes() {
  return createHash("sha256").update(config.encryptionKey).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid secret payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function sha256Base64Url(input: string) {
  return createHash("sha256").update(input).digest("base64url");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function pkceChallengeFromVerifier(verifier: string) {
  return sha256Base64Url(verifier);
}
