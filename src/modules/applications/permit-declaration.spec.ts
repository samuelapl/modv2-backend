import { Test } from '@nestjs/testing';
import { ApplicationStatus, ApplicationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApplicationsService } from './applications.service';
import { VerifyDeclarationAction } from './dto/prior-permit.dto';
import { resolvePermitState } from './helpers/permit-state.helper';

describe('Existing-permit declaration (driver declares, officer verifies)', () => {
  let service: ApplicationsService;

  const mockTx: any = {
    application: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    applicationApproval: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const mockPrisma: any = {
    driverProfile: { findUnique: jest.fn() },
    issuedCredential: { findFirst: jest.fn() },
    vehicleCategory: { findMany: jest.fn() },
    priorPermit: { findMany: jest.fn() },
    application: { findFirst: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const driverUser: any = {
    id: 'u-driver',
    serviceNumber: 'ND-1',
    unitId: 'unit-1',
    resolvedPermissions: [],
  };
  const officer: any = { ...driverUser, id: 'u-officer' };

  const completeProfile = {
    id: 'drv-1',
    userId: 'u-driver',
    dateOfBirth: new Date('1990-01-01'),
    gender: 'MALE',
    nationalIdNumber: '123',
    bloodGroup: 'A+',
    fullNameAm: 'አበበ ቢቂላ',
    emergencyContactName: 'Mother',
    emergencyContactPhone: '0911',
    personnelStatus: 'ACTIVE',
  };

  const future = new Date();
  future.setFullYear(future.getFullYear() + 2);
  const input = (over: any = {}) => ({
    priorPermit: {
      categoryCodes: ['CAT-LV'],
      permitNumber: 'MOD-P-77',
      issueDate: '2023-01-01',
      expiryDate: future.toISOString().slice(0, 10),
      documentUrl: 'certificates/scan.pdf',
      ...over,
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.driverProfile.findUnique.mockResolvedValue(completeProfile);
    mockPrisma.issuedCredential.findFirst.mockResolvedValue(null);
    mockPrisma.application.findFirst.mockResolvedValue(null);
    mockPrisma.priorPermit.findMany.mockResolvedValue([]);
    mockPrisma.vehicleCategory.findMany.mockResolvedValue([
      { id: 'cat-lv', code: 'CAT-LV', minAgeRequired: 18 },
    ]);
    mockTx.application.findFirst.mockResolvedValue(null);
    mockTx.application.create.mockImplementation(async ({ data }: any) => ({
      id: 'app-new',
      applicationNumber: data.applicationNumber,
      status: data.status,
      type: data.type,
    }));
    mockPrisma.application.findUnique.mockResolvedValue({ id: 'app-new' });

    const module = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ApplicationsService);
  });

  describe('declarePermit', () => {
    it('creates a PRE_TRAINED application waiting for verification, not approval', async () => {
      await service.declarePermit(input() as any, driverUser);

      const data = mockTx.application.create.mock.calls[0][0].data;
      expect(data.type).toBe(ApplicationType.PRE_TRAINED);
      expect(data.status).toBe(ApplicationStatus.PENDING_VERIFICATION);
      expect(data.createdById).toBe('u-driver');
      expect(data.priorPermit.create.permitNumber).toBe('MOD-P-77');
      expect(mockTx.auditLog.create.mock.calls[0][0].data.action).toBe(
        'DECLARE_EXISTING_PERMIT',
      );
    });

    it('looks the driver up from the signed-in user only', async () => {
      await service.declarePermit(input() as any, driverUser);
      expect(mockPrisma.driverProfile.findUnique.mock.calls[0][0].where).toEqual({
        userId: 'u-driver',
      });
    });

    it('requires the permit scan', async () => {
      await expect(
        service.declarePermit(input({ documentUrl: '  ' }) as any, driverUser),
      ).rejects.toThrow(/scan/i);
      expect(mockTx.application.create).not.toHaveBeenCalled();
    });

    it('refuses when the driver already has a permit record', async () => {
      mockPrisma.issuedCredential.findFirst.mockResolvedValue({
        credentialNumber: 'MOD-AUTH-2026-0001',
      });
      await expect(
        service.declarePermit(input() as any, driverUser),
      ).rejects.toThrow(/already holds/i);
    });

    it('refuses a second declaration while one is in flight', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({
        applicationNumber: 'APP-2026-00001',
      });
      await expect(
        service.declarePermit(input() as any, driverUser),
      ).rejects.toThrow(/already open/i);
    });

    it('refuses to declare a permit while another application is in flight', async () => {
      mockPrisma.application.findFirst
        .mockResolvedValueOnce(null) // no other declaration
        .mockResolvedValueOnce({ applicationNumber: 'APP-2026-00042' }); // a new-authorization case
      await expect(service.declarePermit(input() as any, driverUser)).rejects.toThrow(/in progress/i);
      expect(mockTx.application.create).not.toHaveBeenCalled();
    });

    it('refuses a permit number that is already recorded', async () => {
      mockPrisma.priorPermit.findMany.mockResolvedValue([
        { permitNumber: 'MOD-P-77' },
      ]);
      await expect(
        service.declarePermit(input() as any, driverUser),
      ).rejects.toThrow(/already recorded/i);
    });

    it('refuses an expired permit', async () => {
      await expect(
        service.declarePermit(input({ expiryDate: '2023-06-01' }) as any, driverUser),
      ).rejects.toThrow(/expired/i);
    });

    it('refuses an incomplete profile', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({
        ...completeProfile,
        bloodGroup: null,
      });
      await expect(
        service.declarePermit(input() as any, driverUser),
      ).rejects.toThrow(/profile/i);
    });
  });

  describe('verifyDeclaration', () => {
    const pending = (over: any = {}) => ({
      id: 'app-1',
      type: ApplicationType.PRE_TRAINED,
      status: ApplicationStatus.PENDING_VERIFICATION,
      driverProfile: { userId: 'u-driver' },
      ...over,
    });

    beforeEach(() => {
      mockTx.application.update.mockImplementation(async ({ data }: any) => ({
        id: 'app-1',
        applicationNumber: 'APP-1',
        ...data,
      }));
    });

    it('approve sends the case to command approval', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(pending());
      const res: any = await service.verifyDeclaration(
        'app-1',
        { action: VerifyDeclarationAction.APPROVE },
        officer,
      );
      expect(res.status).toBe(ApplicationStatus.READY_FOR_APPROVAL);
    });

    it('return needs a reason, then goes back to the driver with it', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(pending());
      await expect(
        service.verifyDeclaration(
          'app-1',
          { action: VerifyDeclarationAction.RETURN, comments: ' ' },
          officer,
        ),
      ).rejects.toThrow(/reason/i);

      const res: any = await service.verifyDeclaration(
        'app-1',
        { action: VerifyDeclarationAction.RETURN, comments: 'Scan unreadable' },
        officer,
      );
      expect(res.status).toBe(ApplicationStatus.RETURNED_FOR_CORRECTION);
      expect(res.rejectionReason).toBe('Scan unreadable');
    });

    it('a driver cannot verify their own declaration', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(pending());
      await expect(
        service.verifyDeclaration(
          'app-1',
          { action: VerifyDeclarationAction.APPROVE },
          driverUser,
        ),
      ).rejects.toThrow(/Separation of Duties/);
    });

    it('only works on declarations awaiting verification', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(
        pending({ status: ApplicationStatus.READY_FOR_APPROVAL }),
      );
      await expect(
        service.verifyDeclaration(
          'app-1',
          { action: VerifyDeclarationAction.APPROVE },
          officer,
        ),
      ).rejects.toThrow(/not waiting for verification/);
    });
  });

  describe('resolvePermitState', () => {
    const driver = { id: 'drv-1', userId: 'u-driver' };
    const client = (creds: any[], app: any) => ({
      issuedCredential: { findMany: jest.fn().mockResolvedValue(creds) },
      application: { findFirst: jest.fn().mockResolvedValue(app) },
    });
    const cred = (over: any) => ({
      id: 'c1',
      credentialNumber: 'P-1',
      cardIssued: true,
      status: 'ACTIVE',
      issueDate: new Date(),
      expiryDate: new Date(),
      categories: [],
      ...over,
    });

    it('NONE with no records', async () => {
      expect((await resolvePermitState(client([], null), driver)).permitState).toBe('NONE');
    });
    it('EXISTING_PERMIT for a credential without a card', async () => {
      const r = await resolvePermitState(client([cred({ cardIssued: false })], null), driver);
      expect(r.permitState).toBe('EXISTING_PERMIT');
    });
    it('CARD_ISSUED once a real card supersedes the existing permit', async () => {
      const r = await resolvePermitState(
        client(
          [cred({ id: 'new' }), cred({ id: 'old', cardIssued: false, status: 'SUPERSEDED' })],
          null,
        ),
        driver,
      );
      expect(r.permitState).toBe('CARD_ISSUED');
      expect(r.permit?.id).toBe('new');
    });
    it('PENDING_VERIFICATION while a declaration is open', async () => {
      const r = await resolvePermitState(
        client([], {
          id: 'a',
          applicationNumber: 'APP-1',
          status: ApplicationStatus.PENDING_VERIFICATION,
          createdById: 'u-driver',
          rejectionReason: null,
        }),
        driver,
      );
      expect(r.permitState).toBe('PENDING_VERIFICATION');
    });
    it('RETURNED carries the officer reason for a driver-declared case', async () => {
      const r = await resolvePermitState(
        client([], {
          id: 'a',
          applicationNumber: 'APP-1',
          status: ApplicationStatus.RETURNED_FOR_CORRECTION,
          createdById: 'u-driver',
          rejectionReason: 'Scan unreadable',
        }),
        driver,
      );
      expect(r.permitState).toBe('RETURNED');
      expect(r.declaration?.reason).toBe('Scan unreadable');
    });
    describe('activeApplication', () => {
      // The open-case lookup excludes declarations (type != PRE_TRAINED); the declaration
      // lookup is the PRE_TRAINED one. Answer each from its own query.
      const split = (creds: any[], other: any, declaration: any = null) => ({
        issuedCredential: { findMany: jest.fn().mockResolvedValue(creds) },
        application: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.type?.not === ApplicationType.PRE_TRAINED ? other : declaration,
          ),
        },
      });
      const open = {
        id: 'app-9',
        applicationNumber: 'APP-2026-00009',
        type: ApplicationType.NEW_AUTHORIZATION,
        status: ApplicationStatus.TRAINING_PENDING,
        currentStage: 'TRAINING',
      };

      it('reports a new-authorization case in flight, with the permit state still NONE', async () => {
        const r = await resolvePermitState(split([], open), driver);
        expect(r.permitState).toBe('NONE');
        expect(r.activeApplication).toEqual(open);
      });

      it('is null when nothing is in flight', async () => {
        expect((await resolvePermitState(split([], null), driver)).activeApplication).toBeNull();
      });

      it('is reported alongside a current permit (for example a renewal in flight)', async () => {
        const r = await resolvePermitState(
          split([cred({})], { ...open, type: ApplicationType.RENEWAL }),
          driver,
        );
        expect(r.permitState).toBe('CARD_ISSUED');
        expect(r.activeApplication?.type).toBe(ApplicationType.RENEWAL);
      });

      it('only looks at in-flight, non-declaration cases', async () => {
        const c = split([], null);
        await resolvePermitState(c, driver);
        const where = c.application.findFirst.mock.calls.find(([a]: any[]) => a.where.type?.not)![0].where;
        expect(where.type).toEqual({ not: ApplicationType.PRE_TRAINED });
        expect(where.status.in).not.toContain(ApplicationStatus.APPROVED);
        expect(where.status.in).not.toContain(ApplicationStatus.REJECTED);
        expect(where.status.in).toContain(ApplicationStatus.RETURNED_FOR_CORRECTION);
      });
    });

    it('an officer-recorded case never asks the driver to act', async () => {
      const r = await resolvePermitState(
        client([], {
          id: 'a',
          applicationNumber: 'APP-1',
          status: ApplicationStatus.RETURNED_FOR_CORRECTION,
          createdById: 'u-officer',
          rejectionReason: 'x',
        }),
        driver,
      );
      expect(r.permitState).toBe('PENDING_VERIFICATION');
    });
  });
});
