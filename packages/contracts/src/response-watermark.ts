import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

export const responseWatermarkTokenVersion = "rwm1";

export type ResponseWatermarkClaims = {
  v: 1;
  l: string;
  s: string;
  i: string;
  m?: string | null;
  p?: string | null;
  q?: string | null;
  rid?: string | null;
  cid?: string | null;
  sid?: string | null;
  wid?: string | null;
  oid?: string | null;
  bid?: string | null;
  inst?: string | null;
  ctx?: Record<string, string | null | undefined> | null;
};

export type IssuedResponseWatermark = {
  fingerprint: string;
  keyId: string;
  token: string;
};

function deriveResponseWatermarkKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function normalizeBase64UrlPart(part: string, fieldName: string) {
  const normalized = part.trim();
  if (!normalized) {
    throw new Error(`Response watermark ${fieldName} is empty`);
  }

  return normalized;
}

export function digestResponseWatermarkToken(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

export function createResponseWatermarkBinding(secret: string, purpose: string, value: string) {
  return createHmac("sha256", secret)
    .update(`${purpose}\u001f${value}`)
    .digest("base64url");
}

export function digestResponseWatermarkQuery(search: string) {
  const normalized = search.trim();
  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

export function issueOpaqueResponseWatermark(args: {
  claims: ResponseWatermarkClaims;
  keyId?: string | null;
  secret: string;
}): IssuedResponseWatermark {
  const keyId = args.keyId?.trim() || "k1";
  const aad = Buffer.from(`${responseWatermarkTokenVersion}.${keyId}`, "utf8");
  const key = deriveResponseWatermarkKey(args.secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(JSON.stringify(args.claims), "utf8");

  cipher.setAAD(aad);

  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  const token = [
    responseWatermarkTokenVersion,
    keyId,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");

  return {
    token,
    keyId,
    fingerprint: digestResponseWatermarkToken(token),
  };
}

export function decodeOpaqueResponseWatermark(args: {
  secret: string;
  token: string;
}) {
  const [version, keyIdPart, ivPart, ciphertextPart, extraPart] = args.token.split(".");
  if (
    version !== responseWatermarkTokenVersion ||
    !keyIdPart ||
    !ivPart ||
    !ciphertextPart ||
    extraPart
  ) {
    throw new Error("Response watermark token format is invalid");
  }

  const keyId = normalizeBase64UrlPart(keyIdPart, "keyId");
  const iv = Buffer.from(normalizeBase64UrlPart(ivPart, "iv"), "base64url");
  const ciphertext = Buffer.from(
    normalizeBase64UrlPart(ciphertextPart, "ciphertext"),
    "base64url",
  );

  if (ciphertext.length < 17) {
    throw new Error("Response watermark ciphertext is too short");
  }

  const aad = Buffer.from(`${responseWatermarkTokenVersion}.${keyId}`, "utf8");
  const key = deriveResponseWatermarkKey(args.secret);
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encryptedPayload = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);

  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);

  const payload = Buffer.concat([
    decipher.update(encryptedPayload),
    decipher.final(),
  ]).toString("utf8");

  return {
    keyId,
    fingerprint: digestResponseWatermarkToken(args.token),
    claims: JSON.parse(payload) as ResponseWatermarkClaims,
  };
}
