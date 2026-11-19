export const DEFAULT_AUTHORITY_EN = 'MoND Transport & Logistics Main Department';
export const DEFAULT_AUTHORITY_AM = 'የመከላከያ ሚኒስቴር የትራንስፖርትና ሎጂስቲክስ ዋና መምሪያ';

export interface IssuingAuthority {
  en: string;
  am: string;
}

/**
 * Official issuing department shown on the card (print and digital views).
 * Configurable with ISSUING_AUTHORITY_EN / ISSUING_AUTHORITY_AM; the individual
 * clerk is never shown, only recorded in the audit log.
 */
export function resolveIssuingAuthority(config?: {
  get<T = string>(key: string): T | undefined;
}): IssuingAuthority {
  return {
    en: config?.get<string>('ISSUING_AUTHORITY_EN') || DEFAULT_AUTHORITY_EN,
    am: config?.get<string>('ISSUING_AUTHORITY_AM') || DEFAULT_AUTHORITY_AM,
  };
}
