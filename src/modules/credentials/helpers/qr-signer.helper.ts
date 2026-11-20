import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import {
  getEd25519KeyId,
  resolveEd25519PrivateKey,
  resolveEd25519PublicKey,
} from './ed25519.keys';
import { requireSecret } from '../../../common/utils/secrets';

export interface SignedQrPayload {
  v?: number;
  kid?: string;
  cred: string;
  serial: string;
  drv: string;
  cats: string[];
  exp: string;
  iss?: string;
  name?: string;
  nameAm?: string;
  rank?: string;
}

export interface VerifyQrResult {
  valid: boolean;
  payload?: SignedQrPayload;
  algorithm?: 'Ed25519' | 'HMAC-SHA256';
  version?: 1 | 2;
  reason?: string;
}

export const TOKEN_PREFIX_V1 = 'IDLMS1';
export const TOKEN_PREFIX_V2 = 'IDLMS2';
/** Default legacy export alias */
export const TOKEN_PREFIX = TOKEN_PREFIX_V1;

/**
 * Signs a payload using Asymmetric Ed25519 cryptography (RFC 8032).
 * Output format: IDLMS2.<base64url_canonical_payload>.<base64url_ed25519_sig>
 */
export function signCredentialPayloadAsymmetric(
  payload: SignedQrPayload,
  privateKey?: crypto.KeyObject | string,
): string {
  const canonical: SignedQrPayload = {
    v: 2,
    kid: payload.kid || getEd25519KeyId(),
    cred: payload.cred,
    serial: payload.serial,
    drv: payload.drv,
    cats: [...payload.cats].sort(),
    exp: payload.exp,
    ...(payload.iss ? { iss: payload.iss } : {}),
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.nameAm ? { nameAm: payload.nameAm } : {}),
    ...(payload.rank ? { rank: payload.rank } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(canonical), 'utf8').toString('base64url');
  const message = Buffer.from(`${TOKEN_PREFIX_V2}.${encoded}`, 'utf8');

  const keyObj = privateKey
    ? typeof privateKey === 'string'
      ? crypto.createPrivateKey(privateKey)
      : privateKey
    : resolveEd25519PrivateKey();

  const signature = crypto.sign(null, message, keyObj).toString('base64url');
  return `${TOKEN_PREFIX_V2}.${encoded}.${signature}`;
}

/**
 * Verifies an Asymmetric Ed25519 QR token (IDLMS2).
 */
export function verifySignedQrTokenAsymmetric(
  token: string,
  publicKey?: crypto.KeyObject | string,
): VerifyQrResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX_V2) {
    return { valid: false, reason: 'Invalid IDLMS2 token structure' };
  }

  const [, encoded, sigBase64] = parts;
  const message = Buffer.from(`${TOKEN_PREFIX_V2}.${encoded}`, 'utf8');

  try {
    const sigBuf = Buffer.from(sigBase64, 'base64url');
    if (sigBuf.length !== 64) {
      return { valid: false, reason: 'Invalid Ed25519 signature length (must be 64 bytes)' };
    }

    const keyObj = publicKey
      ? typeof publicKey === 'string'
        ? crypto.createPublicKey(publicKey)
        : publicKey
      : resolveEd25519PublicKey();

    const isValid = crypto.verify(null, message, keyObj, sigBuf);
    if (!isValid) {
      return { valid: false, reason: 'Ed25519 cryptographic signature verification failed' };
    }

    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as SignedQrPayload;
    return {
      valid: true,
      payload,
      algorithm: 'Ed25519',
      version: 2,
    };
  } catch (err: any) {
    return { valid: false, reason: err?.message || 'Verification exception' };
  }
}

/**
 * Signs a payload using legacy Symmetric HMAC-SHA256.
 * Output format: IDLMS1.<base64url_canonical_payload>.<hmac_hex>
 */
export function signCredentialPayloadHmac(
  payload: SignedQrPayload,
  secret: string,
): string {
  const canonical: SignedQrPayload = {
    cred: payload.cred,
    serial: payload.serial,
    drv: payload.drv,
    cats: [...payload.cats].sort(),
    exp: payload.exp,
    ...(payload.iss ? { iss: payload.iss } : {}),
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.nameAm ? { nameAm: payload.nameAm } : {}),
    ...(payload.rank ? { rank: payload.rank } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(canonical), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${TOKEN_PREFIX_V1}.${encoded}`)
    .digest('hex');

  return `${TOKEN_PREFIX_V1}.${encoded}.${sig}`;
}

/**
 * Verifies a legacy Symmetric HMAC-SHA256 QR token (IDLMS1).
 */
export function verifySignedQrTokenHmac(
  token: string,
  secret: string,
): VerifyQrResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX_V1) {
    return { valid: false, reason: 'Invalid IDLMS1 token structure' };
  }

  const [, encoded, providedHex] = parts;
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(`${TOKEN_PREFIX_V1}.${encoded}`)
    .digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return { valid: false, reason: 'HMAC signature mismatch' };
  }

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as SignedQrPayload;
    return {
      valid: true,
      payload,
      algorithm: 'HMAC-SHA256',
      version: 1,
    };
  } catch {
    return { valid: false, reason: 'Invalid JSON payload' };
  }
}

/**
 * Universal signing helper:
 * By default signs with Asymmetric Ed25519 (IDLMS2).
 * If QR_SIGNING_ALGORITHM=hmac is explicitly configured, signs with IDLMS1.
 */
export function signCredentialPayload(
  payload: SignedQrPayload,
  keyOrSecret?: string | crypto.KeyObject | { privateKey?: string | crypto.KeyObject; secret?: string; algorithm?: 'ed25519' | 'hmac' },
): string {
  if (typeof keyOrSecret === 'object' && 'algorithm' in keyOrSecret && keyOrSecret.algorithm === 'hmac') {
    return signCredentialPayloadHmac(payload, keyOrSecret.secret || resolveQrSecret());
  }

  if (typeof keyOrSecret === 'string' && keyOrSecret.startsWith('-----BEGIN PRIVATE KEY-----')) {
    return signCredentialPayloadAsymmetric(payload, keyOrSecret);
  }

  if (typeof keyOrSecret === 'object' && 'type' in keyOrSecret && (keyOrSecret as any).type === 'private') {
    return signCredentialPayloadAsymmetric(payload, keyOrSecret as crypto.KeyObject);
  }

  if (typeof keyOrSecret === 'object' && 'privateKey' in keyOrSecret && keyOrSecret.privateKey) {
    return signCredentialPayloadAsymmetric(payload, keyOrSecret.privateKey);
  }

  const algorithm = process.env.QR_SIGNING_ALGORITHM?.toLowerCase();
  if (algorithm === 'hmac' && typeof keyOrSecret === 'string') {
    return signCredentialPayloadHmac(payload, keyOrSecret);
  }

  // Default to Asymmetric Ed25519
  return signCredentialPayloadAsymmetric(payload);
}

/**
 * Universal verification helper:
 * Automatically inspects the token prefix:
 * - IDLMS2.* -> verifies with Ed25519 Public Key
 * - IDLMS1.* -> verifies with HMAC secret
 */
export function verifySignedQrToken(
  token: string,
  secretOrOptions?: string | { secret?: string; publicKey?: crypto.KeyObject | string },
): VerifyQrResult {
  const trimmed = token.trim();
  if (trimmed.startsWith(`${TOKEN_PREFIX_V2}.`)) {
    const pubKey = typeof secretOrOptions === 'object' && secretOrOptions?.publicKey
      ? secretOrOptions.publicKey
      : undefined;
    return verifySignedQrTokenAsymmetric(trimmed, pubKey);
  }

  if (trimmed.startsWith(`${TOKEN_PREFIX_V1}.`)) {
    const secret = typeof secretOrOptions === 'string'
      ? secretOrOptions
      : secretOrOptions?.secret || resolveQrSecret();
    return verifySignedQrTokenHmac(trimmed, secret);
  }

  return { valid: false, reason: 'Unknown token prefix or unsupported format' };
}

/** Legacy IDLMS1 secret: QR_SIGNING_SECRET, else JWT_SECRET. Never a built-in default. */
export function resolveQrSecret(config?: { get<T = string>(key: string): T | undefined }): string {
  const configured = config?.get<string>('QR_SIGNING_SECRET') || process.env.QR_SIGNING_SECRET;
  return configured ? requireSecret('QR_SIGNING_SECRET', config) : requireSecret('JWT_SECRET', config);
}

export async function generateQrDataUrl(token: string, width = 240): Promise<string> {
  return QRCode.toDataURL(token, {
    width,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}
