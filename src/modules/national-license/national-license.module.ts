import { Module } from '@nestjs/common';
import { NationalLicenseController } from './national-license.controller';
import { NationalLicenseService } from './national-license.service';
import { LICENSE_VERIFIER_TOKEN } from './interfaces/license-verifier.interface';
import { ManualLicenseVerifier } from './providers/manual-license.verifier';

@Module({
  controllers: [NationalLicenseController],
  providers: [
    NationalLicenseService,
    {
      provide: LICENSE_VERIFIER_TOKEN,
      useClass: ManualLicenseVerifier,
    },
  ],
  exports: [NationalLicenseService],
})
export class NationalLicenseModule {}
