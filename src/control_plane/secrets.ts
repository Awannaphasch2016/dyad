import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

function keyBytes(): Buffer {
  const secret = process.env.WEWEBPLUS_SECRETS_KEY?.trim();
  if (!secret) {
    throw new DyadError(
      "Set WEWEBPLUS_SECRETS_KEY before saving an account connection.",
      DyadErrorKind.Precondition,
    );
  }
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM payload. The key never leaves the main process. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(":");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new DyadError(
      "This account connection could not be read.",
      DyadErrorKind.Precondition,
    );
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
