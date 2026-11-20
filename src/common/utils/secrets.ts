import * as crypto from 'crypto';

/** Values that used to be hard-coded fallbacks. Never accepted as real secrets. */
const KNOWN_INSECURE = new Set([
  'idlms_super_secret_jwt_key_2026_defense_grade',
  'idlms_qr_secret_fallback_2026',
]);

type ConfigLike = { get<T = string>(key: string): T | undefined };

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

let ephemeral: Record<string, string> = {};

/**
 * Reads a required secret. Missing or known-insecure values are a startup
 * error everywhere except automated tests, which get a random per-process
 * value so no secret is ever shared through the source code.
 */
export function requireSecret(name: string, config?: ConfigLike): string {
  const value = (config?.get<string>(name) || process.env[name] || '').trim();

  if (value && !KNOWN_INSECURE.has(value)) return value;

  if (value && KNOWN_INSECURE.has(value)) {
    throw new Error(
      `${name} is set to a publicly known default. Generate a new random value.`,
    );
  }

  if (isTest()) {
    return (ephemeral[name] ??= crypto.randomBytes(32).toString('hex'));
  }

  throw new Error(
    `${name} is not set. Add it to the environment before starting the server ` +
      `(for example: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))").`,
  );
}

/** Test helper: forget generated test secrets. */
export function resetEphemeralSecretsForTests(): void {
  ephemeral = {};
}
