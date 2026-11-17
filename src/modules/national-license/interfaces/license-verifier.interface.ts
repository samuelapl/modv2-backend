import { NationalLicense, VerificationStatus } from '@prisma/client';

export const LICENSE_VERIFIER_TOKEN = 'INationalLicenseVerifier';

export interface LicenseVerificationInput {
  status: VerificationStatus;
  notes?: string;
}

export interface LicenseVerificationOutput {
  accepted: boolean;
  source: string;
  notes?: string;
}

export interface INationalLicenseVerifier {
  verify(
    license: NationalLicense,
    input: LicenseVerificationInput,
  ): Promise<LicenseVerificationOutput>;
}
