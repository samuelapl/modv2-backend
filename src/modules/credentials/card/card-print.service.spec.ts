import { CredentialStatus } from '@prisma/client';
import { Permission } from '../../../common/enums/permissions.enum';
import { CardPrintService } from './card-print.service';

// qrcode's PNG encoder is ~1.5 s per call inside jest's sandbox (33 ms in Node); QR
// rendering is covered by the template and real-Chromium specs, so stub it here.
jest.mock('../helpers/qr-signer.helper', () => ({
  ...jest.requireActual('../helpers/qr-signer.helper'),
  generateQrDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,QR'),
}));

describe('CardPrintService', () => {
  const PDF = Buffer.from('%PDF-fake');

  const credential = (over: Record<string, unknown> = {}): any => ({
    id: 'cred-1',
    credentialNumber: 'MOD-AUTH-2026-0042',
    serialNumber: 'SN-MOD-2026-AAAAAA',
    qrHashSignature: 'IDLMS1.payload.sig',
    cardIssued: true,
    status: CredentialStatus.ACTIVE,
    issueDate: new Date('2026-10-19'),
    expiryDate: new Date('2099-10-19'),
    printCount: 0,
    printedAt: null,
    categories: [{ category: { code: 'CAT-HV', name: 'Heavy Vehicle' } }],
    driverProfile: {
      serviceNumber: 'MOD-DEMO-006',
      rank: 'Sgt.',
      fullName: 'Kidist Mengistu Zewdie',
      fullNameAm: 'ክድስት መንግስቱ ዘውዴ',
      dateOfBirth: new Date('1999-09-25'),
      bloodGroup: 'O+',
      photoUrl: null,
      unit: { code: 'MED-CORPS', name: 'Military Health & Ambulance Directorate' },
    },
    ...over,
  });

  const issuer: any = {
    id: 'issuer-1',
    serviceNumber: 'MOD-ISSUER-001',
    resolvedPermissions: [Permission.CREDENTIALS_PRINT],
  };

  let tx: any;
  let prisma: any;
  let pdf: { render: jest.Mock };
  let service: CardPrintService;

  beforeEach(() => {
    tx = {
      issuedCredential: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      issuedCredential: { findUnique: jest.fn().mockResolvedValue(credential()) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    pdf = { render: jest.fn().mockResolvedValue(PDF) };
    service = new CardPrintService(prisma, pdf as any, {} as any);
  });

  it('returns the PDF, takes the lock atomically and writes the audit entry', async () => {
    const res = await service.printCard('cred-1', issuer);

    expect(res.pdf).toBe(PDF);
    expect(res.filename).toBe('MOD-AUTH-2026-0042.pdf');
    expect(tx.issuedCredential.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cred-1', printCount: 0, status: CredentialStatus.ACTIVE },
        data: expect.objectContaining({
          printCount: { increment: 1 },
          printedById: 'issuer-1',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PRINT_CREDENTIAL',
          entityId: 'cred-1',
          newValue: expect.objectContaining({ printCount: 1 }),
        }),
      }),
    );
  });

  it('renders HTML with the statutory content (and no clerk name)', async () => {
    await service.printCard('cred-1', issuer);
    const html: string = pdf.render.mock.calls[0][0];
    expect(html).toContain('FOR OFFICIAL MILITARY USE ONLY');
    expect(html).toContain('MOD-DEMO-006');
    expect(html).toContain('MoND Transport &amp; Logistics Main Department');
    expect(html).not.toContain('MOD-ISSUER-001');
  });

  it('rejects a second print (409) without rendering', async () => {
    prisma.issuedCredential.findUnique.mockResolvedValue(
      credential({ printCount: 1, printedAt: new Date() }),
    );
    await expect(service.printCard('cred-1', issuer)).rejects.toThrow(/already been printed/i);
    expect(pdf.render).not.toHaveBeenCalled();
    expect(tx.issuedCredential.updateMany).not.toHaveBeenCalled();
  });

  it('only one of two concurrent requests wins the lock', async () => {
    // Both pass the pre-check; the atomic update lets exactly one through.
    tx.issuedCredential.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([
      service.printCard('cred-1', issuer),
      service.printCard('cred-1', issuer),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(lost.reason.message)).toMatch(/already been printed/i);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not burn the print when rendering fails', async () => {
    pdf.render.mockRejectedValue(new Error('chromium crashed'));
    await expect(service.printCard('cred-1', issuer)).rejects.toThrow('chromium crashed');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.issuedCredential.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['driver', [Permission.CREDENTIALS_VIEW_OWN]],
    ['gate officer', [Permission.CREDENTIALS_VERIFY_QR]],
    ['issuer without print permission', [Permission.CREDENTIALS_ISSUE]],
  ])('forbids %s from printing', async (_label, perms) => {
    await expect(
      service.printCard('cred-1', { ...issuer, resolvedPermissions: perms }),
    ).rejects.toThrow(/authorized credential issuers/i);
    expect(prisma.issuedCredential.findUnique).not.toHaveBeenCalled();
  });

  it('refuses an existing-permit record (no card issued)', async () => {
    prisma.issuedCredential.findUnique.mockResolvedValue(credential({ cardIssued: false }));
    await expect(service.printCard('cred-1', issuer)).rejects.toThrow(/no MoD card/i);
  });

  it.each([CredentialStatus.SUSPENDED, CredentialStatus.REVOKED, CredentialStatus.SUPERSEDED])(
    'refuses a %s permit',
    async (status) => {
      prisma.issuedCredential.findUnique.mockResolvedValue(credential({ status }));
      await expect(service.printCard('cred-1', issuer)).rejects.toThrow(/not active/i);
      expect(pdf.render).not.toHaveBeenCalled();
    },
  );

  it('refuses an expired permit', async () => {
    prisma.issuedCredential.findUnique.mockResolvedValue(
      credential({ expiryDate: new Date('2020-01-01') }),
    );
    await expect(service.printCard('cred-1', issuer)).rejects.toThrow(/not active/i);
  });

  it('refuses to print when a statutory field is missing (422)', async () => {
    const c = credential();
    c.driverProfile.fullNameAm = null;
    c.driverProfile.bloodGroup = '';
    prisma.issuedCredential.findUnique.mockResolvedValue(c);
    await expect(service.printCard('cred-1', issuer)).rejects.toThrow(
      /Blood Group, Amharic Full Name/,
    );
    expect(pdf.render).not.toHaveBeenCalled();
  });

  it('falls back to the silhouette when the photo cannot be read', async () => {
    const c = credential();
    c.driverProfile.photoUrl = '1731-abc.jpg';
    prisma.issuedCredential.findUnique.mockResolvedValue(c);
    const storage = { getObjectBuffer: jest.fn().mockRejectedValue(new Error('minio down')) };
    service = new CardPrintService(prisma, pdf as any, storage as any);

    await expect(service.printCard('cred-1', issuer)).resolves.toBeDefined();
    expect(pdf.render.mock.calls[0][0]).toContain('<svg viewBox="0 0 40 52"');
  });
});
