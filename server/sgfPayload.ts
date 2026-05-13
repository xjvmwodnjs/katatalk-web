import { createHash } from "node:crypto";

/** UTF-8 바이트 기준 SHA-256 hex (로그에는 사용하지 말 것 — prefix 만). */
export function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
