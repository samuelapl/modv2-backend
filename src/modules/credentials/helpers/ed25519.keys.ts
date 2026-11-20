import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('Ed25519Keys');

export interface PublicKeyInfoDto {
  algorithm: 'Ed25519';
  keyId: string;
  publicKeyPem: string;
  rawPublicKeyHex: string;
  rawPublicKeyBase64: string;
  issuedAt: string;
}

let cachedPrivateKey: crypto.KeyObject | null = null;
let cachedPublicKey: crypto.KeyObject | null = null;
let cachedKeyInfo: PublicKeyInfoDto | null = null;

/**
 * Built-in standard fallback keypair for MoD IDLMS dev and CI environments.
 * Generated using RFC 8032 standard Ed25519 curve.
 */
export const DEV_FALLBACK_ED25519_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIOYJ164Ww15xYqFO2DOLKF3zhi2uYlbeKthJdLscFVMq
-----END PRIVATE KEY-----`;

export const DEV_FALLBACK_ED25519_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYPOY+syeyw0qonn9VB+W0Bb0258qnHuaDxdJfbzy4Ps=
-----END PUBLIC KEY-----`;

export const DEFAULT_KEY_ID = 'mod-root-2026-v1';

export function resolveEd25519PrivateKey(config?: { get<T = string>(key: string): T | undefined }): crypto.KeyObject {
  if (cachedPrivateKey) return cachedPrivateKey;

  const raw =
    config?.get<string>('ED25519_PRIVATE_KEY_PEM') ||
    config?.get<string>('ED25519_PRIVATE_KEY') ||
    process.env.ED25519_PRIVATE_KEY_PEM ||
    process.env.ED25519_PRIVATE_KEY;

  if (raw && raw.trim().length > 0) {
    try {
      const pem = normalizePem(raw, 'PRIVATE KEY');
      cachedPrivateKey = crypto.createPrivateKey(pem);
      return cachedPrivateKey;
    } catch (err: any) {
      logger.warn(`Failed to parse configured ED25519_PRIVATE_KEY: ${err.message}. Falling back to standard key.`);
    }
  }

  cachedPrivateKey = crypto.createPrivateKey(DEV_FALLBACK_ED25519_PRIVATE_KEY_PEM);
  return cachedPrivateKey;
}

export function resolveEd25519PublicKey(config?: { get<T = string>(key: string): T | undefined }): crypto.KeyObject {
  if (cachedPublicKey) return cachedPublicKey;

  const raw =
    config?.get<string>('ED25519_PUBLIC_KEY_PEM') ||
    config?.get<string>('ED25519_PUBLIC_KEY') ||
    process.env.ED25519_PUBLIC_KEY_PEM ||
    process.env.ED25519_PUBLIC_KEY;

  if (raw && raw.trim().length > 0) {
    try {
      const pem = normalizePem(raw, 'PUBLIC KEY');
      cachedPublicKey = crypto.createPublicKey(pem);
      return cachedPublicKey;
    } catch (err: any) {
      logger.warn(`Failed to parse configured ED25519_PUBLIC_KEY: ${err.message}. Deriving from private key.`);
    }
  }

  // Derive public key from the resolved private key
  const priv = resolveEd25519PrivateKey(config);
  cachedPublicKey = crypto.createPublicKey(priv);
  return cachedPublicKey;
}

export function getEd25519PublicKeyInfo(config?: { get<T = string>(key: string): T | undefined }): PublicKeyInfoDto {
  if (cachedKeyInfo) return cachedKeyInfo;

  const pubKey = resolveEd25519PublicKey(config);
  const pem = pubKey.export({ type: 'spki', format: 'pem' }) as string;
  const der = pubKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const raw32 = der.subarray(der.length - 32);

  cachedKeyInfo = {
    algorithm: 'Ed25519',
    keyId: config?.get<string>('ED25519_KEY_ID') || process.env.ED25519_KEY_ID || DEFAULT_KEY_ID,
    publicKeyPem: pem.trim(),
    rawPublicKeyHex: raw32.toString('hex'),
    rawPublicKeyBase64: raw32.toString('base64url'),
    issuedAt: '2026-01-01T00:00:00.000Z',
  };
  return cachedKeyInfo;
}

function normalizePem(input: string, label: string): string {
  const trimmed = input.trim();
  if (trimmed.includes(`-----BEGIN ${label}-----`)) {
    return trimmed.replace(/\\n/g, '\n');
  }
  return `-----BEGIN ${label}-----\n${trimmed}\n-----END ${label}-----`;
}

/** Utility to generate a fresh Ed25519 keypair on demand */
export function generateNewEd25519KeyPair(): {
  privateKeyPem: string;
  publicKeyPem: string;
  rawPublicKeyHex: string;
  keyId: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  const raw32 = der.subarray(der.length - 32);

  return {
    privateKeyPem: privateKey.trim(),
    publicKeyPem: publicKey.trim(),
    rawPublicKeyHex: raw32.toString('hex'),
    keyId: `mod-root-${new Date().getFullYear()}-${raw32.subarray(0, 4).toString('hex')}`,
  };
}

/** Reset cache for unit testing */
export function resetEd25519KeyCacheForTests(): void {
  cachedPrivateKey = null;
  cachedPublicKey = null;
  cachedKeyInfo = null;
}
