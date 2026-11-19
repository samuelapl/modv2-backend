import { readFileSync } from 'fs';
import * as path from 'path';

export interface CardAssets {
  /** data:image/png;base64,... */
  logoDataUri: string;
  /** base64 of the TTF files (embedded via @font-face — never rely on OS fonts) */
  fontRegularB64: string;
  fontBoldB64: string;
}

let cached: CardAssets | null = null;

/** backend/assets/card by default (the backend always starts from backend/). */
export function cardAssetsDir(): string {
  return process.env.CARD_ASSETS_DIR || path.join(process.cwd(), 'assets', 'card');
}

/** Reads the logo and fonts once and keeps them in memory. */
export function loadCardAssets(dir = cardAssetsDir()): CardAssets {
  if (cached) return cached;
  const b64 = (file: string) => readFileSync(path.join(dir, file)).toString('base64');
  cached = {
    logoDataUri: `data:image/png;base64,${b64('logo.png')}`,
    fontRegularB64: b64('fonts/NotoSansEthiopic-Regular.ttf'),
    fontBoldB64: b64('fonts/NotoSansEthiopic-Bold.ttf'),
  };
  return cached;
}
