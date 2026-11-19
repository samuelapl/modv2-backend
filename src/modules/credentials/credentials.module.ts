import { Module } from '@nestjs/common';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { StorageModule } from '../storage/storage.module';
import { CardPdfService } from './card/card-pdf.service';
import { CardPrintService } from './card/card-print.service';
import { CardReprintService } from './card/card-reprint.service';

@Module({
  imports: [StorageModule],
  controllers: [CredentialsController],
  providers: [CredentialsService, CardPdfService, CardPrintService, CardReprintService],
  exports: [CredentialsService],
})
export class CredentialsModule {}
