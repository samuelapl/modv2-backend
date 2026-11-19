import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialStatus, ReprintReason } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppConflictException, AppNotFoundException } from '../../../common/errors';
import { RequestUserContext } from '../../personnel/services/drivers.service';
import { effectiveCredentialStatus } from '../helpers/credential-status.helper';
import { resolveQrSecret, signCredentialPayload } from '../helpers/qr-signer.helper';

/**
 * Supervisor Reprint Override: replaces the physical card (new serial + new
 * signed QR) and re-opens exactly one print. The permit itself is unchanged.
 * The old serial is kept in CardReprint so a scan of the old card answers
 * "CARD_REPLACED".
 */
@Injectable()
export class CardReprintService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async authorizeReprint(
    id: string,
    reasonCode: ReprintReason,
    note: string | undefined,
    user: RequestUserContext,
  ) {
    const cred = await this.prisma.issuedCredential.findUnique({
      where: { id },
      include: {
        categories: { include: { category: { select: { code: true } } } },
        driverProfile: { select: { serviceNumber: true } },
      },
    });
    if (!cred) {
      throw new AppNotFoundException(
        'CREDENTIAL_NOT_FOUND',
        {},
        'Issued credential not found.',
      );
    }

    const state = effectiveCredentialStatus(cred.status, cred.expiryDate);
    if (state !== CredentialStatus.ACTIVE) {
      throw new AppConflictException(
        'CREDENTIAL_PRINT_NOT_ACTIVE',
        { permit: cred.credentialNumber, state },
        `Permit ${cred.credentialNumber} is not active (${state}); only an active permit's card can be reprinted.`,
      );
    }
    if (!cred.cardIssued || cred.printCount < 1) {
      throw this.notPrinted(cred.credentialNumber);
    }

    const secret = resolveQrSecret(this.config);
    const year = new Date().getFullYear();
    const cleanNote = note?.trim() || null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const newSerial = `SN-MOD-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const newToken = signCredentialPayload(
        {
          cred: cred.credentialNumber,
          serial: newSerial,
          drv: cred.driverProfile.serviceNumber,
          cats: cred.categories.map((c) => c.category.code),
          exp: cred.expiryDate.toISOString(),
        },
        secret,
      );

      try {
        await this.prisma.$transaction(async (tx) => {
          // Guarded on the serial we read: two supervisors cannot both override.
          const swapped = await tx.issuedCredential.updateMany({
            where: { id, serialNumber: cred.serialNumber, printCount: { gte: 1 } },
            data: {
              serialNumber: newSerial,
              qrHashSignature: newToken,
              printCount: 0,
              printedAt: null,
              printedById: null,
            },
          });
          if (swapped.count !== 1) throw this.notPrinted(cred.credentialNumber);

          await tx.cardReprint.create({
            data: {
              credentialId: id,
              oldSerial: cred.serialNumber,
              newSerial,
              reasonCode,
              note: cleanNote,
              authorizedById: user.id,
            },
          });
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: 'REPRINT_OVERRIDE',
              entityType: 'IssuedCredential',
              entityId: id,
              oldValue: { serialNumber: cred.serialNumber, printCount: cred.printCount },
              newValue: {
                credentialNumber: cred.credentialNumber,
                serialNumber: newSerial,
                printCount: 0,
                reasonCode,
                note: cleanNote,
                authorizedByServiceNumber: user.serviceNumber,
              },
            },
          });
        });
        return {
          credentialId: id,
          credentialNumber: cred.credentialNumber,
          oldSerial: cred.serialNumber,
          newSerial,
          reasonCode,
        };
      } catch (err: any) {
        // Extremely unlikely serial collision: draw another one.
        if (err?.code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
  }

  private notPrinted(credentialNumber: string) {
    return new AppConflictException(
      'CREDENTIAL_REPRINT_NOT_PRINTED',
      { credentialNumber },
      'This card has not been printed yet, so a reprint override is not needed.',
    );
  }
}
