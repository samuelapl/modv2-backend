import { CredentialStatus, ReprintReason } from '@prisma/client';
import { verifySignedQrToken, signCredentialPayload } from '../helpers/qr-signer.helper';
import { CardReprintService } from './card-reprint.service';

describe('CardReprintService', () => {
  const supervisor: any = { id: 'sup-1', serviceNumber: 'MOD-SUP-001' };

  const printedCredential = (over: Record<string, unknown> = {}): any => ({
    id: 'cred-1',
    credentialNumber: 'MOD-AUTH-2026-0042',
    serialNumber: 'SN-MOD-2026-OLDOLD',
    cardIssued: true,
    status: CredentialStatus.ACTIVE,
    expiryDate: new Date('2099-10-19'),
    printCount: 1,
    categories: [{ category: { code: 'CAT-HV' } }],
    driverProfile: { serviceNumber: 'MOD-DEMO-006' },
    ...over,
  });

  let tx: any;
  let prisma: any;
  let service: CardReprintService;

  beforeEach(() => {
    tx = {
      issuedCredential: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cardReprint: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      issuedCredential: { findUnique: jest.fn().mockResolvedValue(printedCredential()) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    service = new CardReprintService(prisma);
  });

  it('rotates serial + signed QR, resets the print lock, logs reason and old serial', async () => {
    const res = await service.authorizeReprint(
      'cred-1',
      ReprintReason.DAMAGED,
      'Cracked PVC',
      supervisor,
    );

    expect(res!.oldSerial).toBe('SN-MOD-2026-OLDOLD');
    expect(res!.newSerial).not.toBe(res!.oldSerial);
    expect(res!.newSerial).toMatch(/^SN-MOD-\d{4}-[0-9A-F]{6}$/);

    const swap = tx.issuedCredential.updateMany.mock.calls[0][0];
    expect(swap.where).toEqual({
      id: 'cred-1',
      serialNumber: 'SN-MOD-2026-OLDOLD',
      printCount: { gte: 1 },
    });
    expect(swap.data).toMatchObject({
      serialNumber: res!.newSerial,
      printCount: 0,
      printedAt: null,
      printedById: null,
    });

    // The new QR is signed for the NEW serial (default dev secret).
    const verified = verifySignedQrToken(
      swap.data.qrHashSignature,
      'idlms_qr_secret_fallback_2026',
    );
    expect(verified.valid).toBe(true);
    expect(verified.payload).toMatchObject({
      cred: 'MOD-AUTH-2026-0042',
      serial: res!.newSerial,
      cats: ['CAT-HV'],
    });

    expect(tx.cardReprint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        credentialId: 'cred-1',
        oldSerial: 'SN-MOD-2026-OLDOLD',
        newSerial: res!.newSerial,
        reasonCode: ReprintReason.DAMAGED,
        note: 'Cracked PVC',
        authorizedById: 'sup-1',
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REPRINT_OVERRIDE',
          newValue: expect.objectContaining({ reasonCode: ReprintReason.DAMAGED }),
        }),
      }),
    );
  });

  it('refuses when the card was never printed (nothing to override)', async () => {
    prisma.issuedCredential.findUnique.mockResolvedValue(printedCredential({ printCount: 0 }));
    await expect(
      service.authorizeReprint('cred-1', ReprintReason.LOST, undefined, supervisor),
    ).rejects.toThrow(/not been printed yet/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a non-active permit', async () => {
    prisma.issuedCredential.findUnique.mockResolvedValue(
      printedCredential({ status: CredentialStatus.SUSPENDED }),
    );
    await expect(
      service.authorizeReprint('cred-1', ReprintReason.LOST, undefined, supervisor),
    ).rejects.toThrow(/not active/i);
  });

  it('a second supervisor racing the first changes nothing', async () => {
    tx.issuedCredential.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.authorizeReprint('cred-1', ReprintReason.STOLEN, undefined, supervisor),
    ).rejects.toThrow(/not been printed yet/i);
    expect(tx.cardReprint.create).not.toHaveBeenCalled();
  });

  it('retries with a fresh serial on a unique-constraint collision', async () => {
    tx.issuedCredential.updateMany
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
      .mockResolvedValue({ count: 1 });
    const res = await service.authorizeReprint(
      'cred-1',
      ReprintReason.PRINT_DEFECT,
      undefined,
      supervisor,
    );
    expect(res!.newSerial).toBeDefined();
    expect(tx.issuedCredential.updateMany).toHaveBeenCalledTimes(2);
  });

  it('404s for an unknown credential', async () => {
    prisma.issuedCredential.findUnique.mockResolvedValue(null);
    await expect(
      service.authorizeReprint('nope', ReprintReason.LOST, undefined, supervisor),
    ).rejects.toThrow(/not found/i);
  });

  // keep the import honest: the signer is what verify-qr uses for the old card
  it('signs deterministic tokens (sanity)', () => {
    const p = { cred: 'c', serial: 's', drv: 'd', cats: ['A'], exp: 'x' };
    expect(signCredentialPayload(p, 'k')).toBe(signCredentialPayload(p, 'k'));
  });
});
