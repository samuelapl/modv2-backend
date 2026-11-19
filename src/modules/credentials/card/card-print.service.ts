import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { Permission } from '../../../common/enums/permissions.enum';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
  AppUnprocessableException,
} from '../../../common/errors';
import { RequestUserContext } from '../../personnel/services/drivers.service';
import { effectiveCredentialStatus } from '../helpers/credential-status.helper';
import {
  getMissingCardFields,
  missingCardFieldsLabel,
} from '../helpers/issuance-readiness.helper';
import { resolveIssuingAuthority } from '../helpers/issuing-authority';
import { generateQrDataUrl } from '../helpers/qr-signer.helper';
import { buildCardData, CARD_CREDENTIAL_INCLUDE } from './card-data.builder';
import { loadCardAssets } from './card-assets';
import { CardPdfService } from './card-pdf.service';
import { renderCard } from './card-template';

const PHOTO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * One-time print of the physical CR80 card.
 *
 * Order matters:
 *   1. checks (no side effects)  2. render the PDF (no side effects)
 *   3. take the lock + write the audit entry in one transaction
 * so a rendering failure never uses up the single print, and two concurrent
 * requests can never both succeed.
 */
@Injectable()
export class CardPrintService {
  private readonly logger = new Logger(CardPrintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: CardPdfService,
    private readonly storage: StorageService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async printCard(
    id: string,
    user: RequestUserContext,
  ): Promise<{ pdf: Buffer; filename: string }> {
    // Defence in depth: the controller already requires this permission.
    if (!new Set(user.resolvedPermissions || []).has(Permission.CREDENTIALS_PRINT)) {
      throw new AppForbiddenException(
        'CREDENTIAL_ACCESS_DENIED',
        {},
        'Only authorized credential issuers can print driving permits.',
      );
    }

    const cred = await this.prisma.issuedCredential.findUnique({
      where: { id },
      include: CARD_CREDENTIAL_INCLUDE,
    });
    if (!cred) {
      throw new AppNotFoundException(
        'CREDENTIAL_NOT_FOUND',
        {},
        'Issued credential not found.',
      );
    }
    if (!cred.cardIssued) {
      throw new AppBadRequestException(
        'CREDENTIAL_NO_CARD_ISSUED',
        { credentialNumber: cred.credentialNumber },
        'No MoD card has been issued for this permit, so there is nothing to print.',
      );
    }

    const state = effectiveCredentialStatus(cred.status, cred.expiryDate);
    if (state !== CredentialStatus.ACTIVE) {
      throw new AppConflictException(
        'CREDENTIAL_PRINT_NOT_ACTIVE',
        { permit: cred.credentialNumber, state },
        `Permit ${cred.credentialNumber} is not active (${state}); only an active permit's card can be printed.`,
      );
    }

    const missing = getMissingCardFields(cred.driverProfile);
    if (missing.length > 0) {
      throw new AppUnprocessableException(
        'CREDENTIAL_ISSUANCE_BLOCKED_MISSING_FIELDS',
        { fields: missingCardFieldsLabel(missing) },
        `Cannot print the card: required driver details are missing (${missingCardFieldsLabel(missing)}).`,
      );
    }

    // Fast fail before the expensive render; the real guard is the atomic update below.
    if (cred.printCount > 0 || cred.printedAt) {
      throw this.alreadyPrinted(cred.credentialNumber, cred.printedAt);
    }

    const data = buildCardData(cred, {
      qrDataUrl: await generateQrDataUrl(cred.qrHashSignature, 600),
      photoDataUri: await this.loadPhoto(cred.driverProfile.photoUrl),
      issuingAuthority: resolveIssuingAuthority(this.config),
    });
    const pdf = await this.pdf.render(renderCard(data, loadCardAssets()));

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.issuedCredential.updateMany({
        where: { id, printCount: 0, status: CredentialStatus.ACTIVE },
        data: { printCount: { increment: 1 }, printedAt: now, printedById: user.id },
      });
      if (locked.count !== 1) {
        // Another request won the race: discard this PDF.
        throw this.alreadyPrinted(cred.credentialNumber, null);
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'PRINT_CREDENTIAL',
          entityType: 'IssuedCredential',
          entityId: id,
          oldValue: { printCount: 0, printedAt: null },
          newValue: {
            credentialNumber: cred.credentialNumber,
            serialNumber: cred.serialNumber,
            driverName: cred.driverProfile.fullName,
            driverServiceNumber: cred.driverProfile.serviceNumber,
            printCount: 1,
            printedAt: now.toISOString(),
            printedByServiceNumber: user.serviceNumber,
          },
        },
      });
    });

    return { pdf, filename: `${cred.credentialNumber}.pdf` };
  }

  private alreadyPrinted(credentialNumber: string, printedAt: Date | null) {
    return new AppConflictException(
      'CREDENTIAL_ALREADY_PRINTED',
      { credentialNumber, printedAt: printedAt?.toISOString() },
      'This driving licence has already been printed. Military regulations permit printing credentials only once.',
    );
  }

  /** Photo -> data URI. A missing/unreadable photo falls back to the silhouette. */
  private async loadPhoto(photoKey: string | null): Promise<string | null> {
    if (!photoKey) return null;
    try {
      const ext = photoKey.slice(photoKey.lastIndexOf('.')).toLowerCase();
      const mime = PHOTO_MIME[ext];
      if (!mime) return null;
      const bytes = await this.storage.getObjectBuffer('driver-photos', photoKey);
      return `data:${mime};base64,${bytes.toString('base64')}`;
    } catch (err) {
      this.logger.warn(`Card photo unavailable (${photoKey}): ${(err as Error).message}`);
      return null;
    }
  }
}
