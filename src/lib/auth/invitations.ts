import { createHash, randomBytes } from "crypto";

export function generateInviteToken() {
  return randomBytes(24).toString("hex");
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
