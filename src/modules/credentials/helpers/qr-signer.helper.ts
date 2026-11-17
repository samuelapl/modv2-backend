import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

export interface SignedQrPayload {
  cred: string;
  serial: string;
  drv: string;
  cats: string[];
  exp: string;
}

const TOKEN_PREFIX = 'IDLMS1';

export function signCredentialPayload(
  payload: SignedQrPayload,
  secret: string,
): string {
  const canonical: SignedQrPayload = {
    cred: payload.cred,
    serial: payload.serial,
    drv: payload.drv,
    cats: [...payload.cats].sort(),
    exp: payload.exp,
  };
  const encoded = Buffer.from(JSON.stringify(canonical), 'utf8').toString(
    'base64url',
  );
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${TOKEN_PREFIX}.${encoded}`)
    .digest('hex');

  return `${TOKEN_PREFIX}.${encoded}.${sig}`;
}

export function verifySignedQrToken(
  token: string,
  secret: string,
): { valid: boolean; payload?: SignedQrPayload } {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { valid: false };
  }

  const [, encoded, providedHex] = parts;
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(`${TOKEN_PREFIX}.${encoded}`)
    .digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return { valid: false };
  }

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as SignedQrPayload;
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

export async function generateQrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, {
    width: 240,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}
