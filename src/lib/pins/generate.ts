import { createHash, randomBytes } from "crypto";

export type PinCharset = "numeric" | "alnum_upper";

const CHARSETS: Record<PinCharset, string> = {
  numeric: "0123456789",
  alnum_upper: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
};

export function hashPin(pin: string) {
  return createHash("sha256").update(pin).digest("hex");
}

export function buildPinHint(pin: string) {
  if (pin.length <= 4) return `****${pin}`;
  return `***${pin.slice(-4)}`;
}

export function generateRawPin(params: {
  length: number;
  charset: PinCharset;
  prefix?: string;
}) {
  const length = Math.max(4, Math.min(24, Math.trunc(params.length)));
  const prefix = (params.prefix ?? "").toUpperCase();
  const chars = CHARSETS[params.charset];
  const bytes = randomBytes(length);
  let body = "";
  for (let i = 0; i < length; i += 1) {
    body += chars[bytes[i] % chars.length];
  }
  return `${prefix}${body}`;
}
