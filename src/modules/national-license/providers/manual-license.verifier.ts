import { Injectable } from '@nestjs/common';
import { NationalLicense } from '@prisma/client';
import {
  INationalLicenseVerifier,
  LicenseVerificationInput,
  LicenseVerificationOutput,
} from '../interfaces/license-verifier.interface';

@Injectable()
export class ManualLicenseVerifier implements INationalLicenseVerifier {
  async verify(
    _license: NationalLicense,
    input: LicenseVerificationInput,
  ): Promise<LicenseVerificationOutput> {
    return {
      accepted: true,
      source: 'MANUAL_OFFICER_REVIEW',
      notes: input.notes,
    };
  }
}
