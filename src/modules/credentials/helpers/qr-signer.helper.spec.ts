import {
  signCredentialPayload,
  verifySignedQrToken,
  signCredentialPayloadAsymmetric,
  verifySignedQrTokenAsymmetric,
  signCredentialPayloadHmac,
  verifySignedQrTokenHmac,
  TOKEN_PREFIX_V1,
  TOKEN_PREFIX_V2,
  SignedQrPayload,
} from './qr-signer.helper';
import {
  getEd25519PublicKeyInfo,
  generateNewEd25519KeyPair,
  resolveEd25519PrivateKey,
  resolveEd25519PublicKey,
  resetEd25519KeyCacheForTests,
} from './ed25519.keys';

describe('MoD QR Signer & Asymmetric Cryptography (Ed25519)', () => {
  const samplePayload: SignedQrPayload = {
    cred: 'MOD-AUTH-2026-0001',
    serial: 'SN-MOD-2026-00A1B2',
    drv: 'MOD-DRV-001',
    name: 'Capt. Alazar Tadesse',
    rank: 'CAPTAIN',
    cats: ['B', 'C', 'ARMOR'],
    exp: '2030-01-15T00:00:00.000Z',
  };

  const hmacSecret = 'test_secret_for_mod_unit_tests_2026';

  beforeEach(() => {
    resetEd25519KeyCacheForTests();
  });

  describe('Ed25519 Key Management', () => {
    it('provides standard Ed25519 public key info with 32-byte raw key representation', () => {
      const info = getEd25519PublicKeyInfo();
      expect(info.algorithm).toBe('Ed25519');
      expect(info.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
      expect(info.rawPublicKeyHex).toHaveLength(64); // 32 bytes in hex = 64 hex chars
      expect(info.rawPublicKeyBase64).toBeDefined();
      expect(info.keyId).toBeDefined();
    });

    it('generates a fresh valid keypair on demand', () => {
      const pair = generateNewEd25519KeyPair();
      expect(pair.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
      expect(pair.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
      expect(pair.rawPublicKeyHex).toHaveLength(64);
      expect(pair.keyId).toMatch(/^mod-root-\d{4}-[a-f0-9]{8}$/);
    });
  });

  describe('Asymmetric Ed25519 QR Signing (IDLMS2)', () => {
    it('signs and verifies a genuine credential payload successfully', () => {
      const privKey = resolveEd25519PrivateKey();
      const pubKey = resolveEd25519PublicKey();

      const token = signCredentialPayloadAsymmetric(samplePayload, privKey);
      expect(token).toMatch(/^IDLMS2\./);

      const parts = token.split('.');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe(TOKEN_PREFIX_V2);

      const result = verifySignedQrTokenAsymmetric(token, pubKey);
      expect(result.valid).toBe(true);
      expect(result.algorithm).toBe('Ed25519');
      expect(result.version).toBe(2);
      expect(result.payload).toBeDefined();
      expect(result.payload?.cred).toBe(samplePayload.cred);
      expect(result.payload?.serial).toBe(samplePayload.serial);
      expect(result.payload?.drv).toBe(samplePayload.drv);
      expect(result.payload?.cats).toEqual(['ARMOR', 'B', 'C']); // sorted
    });

    it('rejects tampered payload data immediately', () => {
      const token = signCredentialPayloadAsymmetric(samplePayload);
      const parts = token.split('.');

      // Decode payload, modify driver ID, re-encode
      const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      decoded.drv = 'MOD-IMPOSTER-999';
      const tamperedEncoded = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

      const tamperedToken = `${TOKEN_PREFIX_V2}.${tamperedEncoded}.${parts[2]}`;
      const result = verifySignedQrTokenAsymmetric(tamperedToken);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('signature verification failed');
    });

    it('rejects tampered or corrupt signature bytes', () => {
      const token = signCredentialPayloadAsymmetric(samplePayload);
      const parts = token.split('.');

      // Corrupt a byte in the signature
      const sigBuf = Buffer.from(parts[2], 'base64url');
      sigBuf[0] ^= 0xff; // flip bits
      const corruptSig = sigBuf.toString('base64url');

      const corruptedToken = `${TOKEN_PREFIX_V2}.${parts[1]}.${corruptSig}`;
      const result = verifySignedQrTokenAsymmetric(corruptedToken);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('signature verification failed');
    });

    it('rejects invalid signature length', () => {
      const token = signCredentialPayloadAsymmetric(samplePayload);
      const parts = token.split('.');
      const shortSigToken = `${TOKEN_PREFIX_V2}.${parts[1]}.short`;
      const result = verifySignedQrTokenAsymmetric(shortSigToken);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid Ed25519 signature length');
    });
  });

  describe('Legacy Symmetric HMAC-SHA256 Signing (IDLMS1)', () => {
    it('signs and verifies IDLMS1 tokens correctly', () => {
      const token = signCredentialPayloadHmac(samplePayload, hmacSecret);
      expect(token).toMatch(/^IDLMS1\./);

      const result = verifySignedQrTokenHmac(token, hmacSecret);
      expect(result.valid).toBe(true);
      expect(result.algorithm).toBe('HMAC-SHA256');
      expect(result.version).toBe(1);
      expect(result.payload?.cred).toBe(samplePayload.cred);
    });

    it('rejects verification when using wrong secret', () => {
      const token = signCredentialPayloadHmac(samplePayload, hmacSecret);
      const result = verifySignedQrTokenHmac(token, 'wrong_secret_1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('HMAC signature mismatch');
    });
  });

  describe('Universal signCredentialPayload & verifySignedQrToken Helpers', () => {
    it('defaults to IDLMS2 (Ed25519) for new signatures', () => {
      const token = signCredentialPayload(samplePayload);
      expect(token).toMatch(/^IDLMS2\./);

      const result = verifySignedQrToken(token);
      expect(result.valid).toBe(true);
      expect(result.algorithm).toBe('Ed25519');
      expect(result.version).toBe(2);
    });

    it('automatically detects and verifies IDLMS1 legacy tokens', () => {
      const legacyToken = signCredentialPayloadHmac(samplePayload, hmacSecret);
      const result = verifySignedQrToken(legacyToken, hmacSecret);
      expect(result.valid).toBe(true);
      expect(result.algorithm).toBe('HMAC-SHA256');
      expect(result.version).toBe(1);
    });

    it('automatically detects and verifies IDLMS2 asymmetric tokens', () => {
      const modernToken = signCredentialPayloadAsymmetric(samplePayload);
      const result = verifySignedQrToken(modernToken);
      expect(result.valid).toBe(true);
      expect(result.algorithm).toBe('Ed25519');
      expect(result.version).toBe(2);
    });

    it('gracefully handles malformed or unknown token formats', () => {
      expect(verifySignedQrToken('UNKNOWN.payload.sig').valid).toBe(false);
      expect(verifySignedQrToken('not-a-token').valid).toBe(false);
      expect(verifySignedQrToken('').valid).toBe(false);
    });
  });
});
