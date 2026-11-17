import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { EligibilityController } from './eligibility.controller';
import { EligibilityService } from './eligibility.service';

@Module({
  imports: [CredentialsModule],
  controllers: [EligibilityController],
  providers: [EligibilityService],
  exports: [EligibilityService],
})
export class EligibilityModule {}
