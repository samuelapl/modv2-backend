import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApplicationStatus,
  ApplicationType,
  ApprovalAction,
  PersonnelStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Permission } from '../../common/enums/permissions.enum';
import { ApplicationsService } from './applications.service';
import * as validatorHelper from './helpers/application-validator.helper';

describe('ApplicationsService', () => {
  let service: ApplicationsService;

  const mockTx = {
    applicationApproval: { create: jest.fn() },
    applicationItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    application: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
    priorPermit: { upsert: jest.fn() },
    issuedCredential: { findUnique: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const mockPrisma: any = {
    driverProfile: { findUnique: jest.fn() },
    vehicleCategory: { findMany: jest.fn(), count: jest.fn() },
    credentialCategoryItem: { findMany: jest.fn() },
    priorPermit: { findMany: jest.fn() },
    application: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const coordinatorUser = {
    id: 'user-coord-1',
    serviceNumber: 'MOD-COORD-001',
    unitId: 'unit-1',
    resolvedPermissions: [
      Permission.DRIVERS_VIEW_UNIT,
      Permission.APPLICATIONS_CREATE,
      Permission.APPLICATIONS_VIEW_OWN,
    ],
  };

  const cmdrUser = {
    id: 'user-cmdr-1',
    serviceNumber: 'MOD-CMDR-001',
    unitId: 'unit-1',
    resolvedPermissions: [
      Permission.APPLICATIONS_VIEW_ALL,
      Permission.APPLICATIONS_APPROVE,
    ],
  };

  const licOfficer = {
    id: 'user-lic-1',
    serviceNumber: 'MOD-LIC-001',
    unitId: 'unit-1',
    resolvedPermissions: [
      Permission.APPLICATIONS_VIEW_ALL,
      Permission.APPLICATIONS_SCREEN,
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ApplicationsService>(ApplicationsService);
    // The profile-completeness gate has its own tests below; stub it elsewhere.
    jest.spyOn(service as any, 'assertProfileComplete').mockResolvedValue(undefined);
    // ...and so does the application photo rule.
    jest.spyOn(service as any, 'attachApplicationPhoto').mockResolvedValue(undefined);
  });

  describe('application photo (3 x 4), supplied with the application', () => {
    const attach = (driverId: string, photo: string | undefined, required: boolean) =>
      (service as any).attachApplicationPhoto(driverId, photo, required);

    beforeEach(() => {
      (service as any).attachApplicationPhoto.mockRestore();
      mockPrisma.driverProfile.update = jest.fn().mockResolvedValue({});
    });

    it('is required to submit when there is neither an upload nor a photo on file', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValueOnce({ photoUrl: null });
      await expect(attach('drv-1', undefined, true)).rejects.toMatchObject({
        response: { code: 'APPLICATION_PHOTO_REQUIRED' },
      });
      expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
    });

    it('treats a blank upload as no upload', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValueOnce({ photoUrl: null });
      await expect(attach('drv-1', '   ', true)).rejects.toMatchObject({
        response: { code: 'APPLICATION_PHOTO_REQUIRED' },
      });
    });

    it('reuses the photo already on file when none is uploaded', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValueOnce({ photoUrl: 'old.jpg' });
      await expect(attach('drv-1', undefined, true)).resolves.toBeUndefined();
      expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
    });

    it('stores a newly uploaded photo as the one on file', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValueOnce({ photoUrl: 'old.jpg' });
      await attach('drv-1', ' new.jpg ', true);
      expect(mockPrisma.driverProfile.update).toHaveBeenCalledWith({
        where: { id: 'drv-1' },
        data: { photoUrl: 'new.jpg' },
      });
    });

    it('is not demanded for a draft, but an uploaded one is still kept', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValueOnce({ photoUrl: null });
      await expect(attach('drv-1', undefined, false)).resolves.toBeUndefined();

      mockPrisma.driverProfile.findUnique.mockResolvedValueOnce({ photoUrl: null });
      await attach('drv-1', 'draft.jpg', false);
      expect(mockPrisma.driverProfile.update).toHaveBeenCalledTimes(1);
    });

    it('does not rewrite the profile when the same photo is sent again', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValueOnce({ photoUrl: 'same.jpg' });
      await attach('drv-1', 'same.jpg', true);
      expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('profile completeness gate', () => {
    const completeProfile = {
      dateOfBirth: new Date('1994-01-01'),
      gender: 'MALE',
      nationalIdNumber: 'FAN-1',
      bloodGroup: 'O+',
      emergencyContactName: 'Almaz',
      emergencyContactPhone: '+251911887766',
    };

    it('blocks creating an application while the driver profile is incomplete', async () => {
      (service as any).assertProfileComplete.mockRestore();
      mockPrisma.driverProfile.findUnique
        .mockResolvedValueOnce({ id: 'drv-1', userId: 'user-drv-1', unitId: 'unit-1' })
        .mockResolvedValueOnce({ ...completeProfile, nationalIdNumber: null, bloodGroup: ' ' });

      await expect(
        service.create(
          {
            driverProfileId: 'drv-1',
            type: ApplicationType.NEW_AUTHORIZATION,
            categoryIds: ['cat-lv'],
          },
          coordinatorUser,
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'PROFILE_INCOMPLETE',
          params: { fields: 'nationalIdNumber, bloodGroup' },
        },
      });
      expect(mockPrisma.application.create).not.toHaveBeenCalled();
    });

    it('lets a complete profile through the gate', async () => {
      (service as any).assertProfileComplete.mockRestore();
      mockPrisma.driverProfile.findUnique.mockResolvedValueOnce(completeProfile);
      await expect((service as any).assertProfileComplete('drv-1')).resolves.toBeUndefined();
    });

    it('blocks submitting a standard application but not an officer-recorded pre-trained one', async () => {
      const gate = (service as any).assertProfileComplete as jest.Mock;
      const base = {
        id: 'app-1',
        status: ApplicationStatus.DRAFT,
        driverProfileId: 'drv-1',
        driverProfile: { id: 'drv-1', userId: 'user-drv-1', unitId: 'unit-1' },
        requestedCategories: [],
        priorPermit: null,
      };

      gate.mockRejectedValueOnce(new BadRequestException('PROFILE_INCOMPLETE'));
      mockPrisma.application.findUnique.mockResolvedValue({
        ...base,
        type: ApplicationType.NEW_AUTHORIZATION,
      });
      await expect(service.submit('app-1', {}, coordinatorUser)).rejects.toThrow(
        'PROFILE_INCOMPLETE',
      );
      expect(gate).toHaveBeenCalledWith('drv-1');

      gate.mockClear();
      mockPrisma.application.findUnique.mockResolvedValue({
        ...base,
        type: ApplicationType.PRE_TRAINED,
      });
      await service.submit('app-1', {}, coordinatorUser).catch(() => undefined);
      expect(gate).not.toHaveBeenCalled();
    });
  });

  it('blocks underage applicant for CAT-HV (minAgeRequired = 22)', async () => {
    const nineteenYearsAgo = new Date();
    nineteenYearsAgo.setFullYear(nineteenYearsAgo.getFullYear() - 19);

    mockPrisma.driverProfile.findUnique
      .mockResolvedValueOnce({ id: 'drv-1', userId: 'user-drv-1', unitId: 'unit-1' })
      .mockResolvedValueOnce({
        id: 'drv-1',
        userId: 'user-drv-1',
        unitId: 'unit-1',
        dateOfBirth: nineteenYearsAgo,
        personnelStatus: PersonnelStatus.ACTIVE,
        nationalLicense: {
          verificationStatus: VerificationStatus.VERIFIED,
          expiryDate: new Date('2030-01-01'),
        },
      });

    mockPrisma.vehicleCategory.findMany.mockResolvedValue([
      {
        id: 'cat-hv',
        code: 'CAT-HV',
        minAgeRequired: 22,
        requiresNationalLicense: true,
        prerequisiteCatId: null,
        isActive: true,
      },
    ]);

    await expect(
      service.create(
        {
          driverProfileId: 'drv-1',
          type: ApplicationType.NEW_AUTHORIZATION,
          categoryIds: ['cat-hv'],
        },
        coordinatorUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks road category submission when National License is UNVERIFIED', async () => {
    mockPrisma.driverProfile.findUnique
      .mockResolvedValueOnce({ id: 'drv-1', userId: 'user-drv-1', unitId: 'unit-1' })
      .mockResolvedValueOnce({
        id: 'drv-1',
        userId: 'user-drv-1',
        unitId: 'unit-1',
        dateOfBirth: new Date('1994-01-01'),
        personnelStatus: PersonnelStatus.ACTIVE,
        nationalLicense: {
          verificationStatus: VerificationStatus.UNVERIFIED,
          expiryDate: new Date('2030-01-01'),
        },
      });

    mockPrisma.vehicleCategory.findMany.mockResolvedValue([
      {
        id: 'cat-lv',
        code: 'CAT-LV',
        minAgeRequired: 18,
        requiresNationalLicense: true,
        prerequisiteCatId: null,
        isActive: true,
      },
    ]);

    await expect(
      service.create(
        {
          driverProfileId: 'drv-1',
          type: ApplicationType.NEW_AUTHORIZATION,
          categoryIds: ['cat-lv'],
        },
        coordinatorUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows CAT-SP base equipment without National License', async () => {
    mockPrisma.driverProfile.findUnique
      .mockResolvedValueOnce({ id: 'drv-1', userId: 'user-drv-1', unitId: 'unit-1' })
      .mockResolvedValueOnce({
        id: 'drv-1',
        userId: 'user-drv-1',
        unitId: 'unit-1',
        dateOfBirth: new Date('1994-01-01'),
        personnelStatus: PersonnelStatus.ACTIVE,
        nationalLicense: null,
      });

    mockPrisma.vehicleCategory.findMany.mockResolvedValue([
      {
        id: 'cat-sp',
        code: 'CAT-SP',
        minAgeRequired: 21,
        requiresNationalLicense: false,
        prerequisiteCatId: null,
        isActive: true,
      },
    ]);

    mockPrisma.application.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrisma.application.create.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-00001',
      status: ApplicationStatus.SUBMITTED,
    });

    const created = await service.create(
      {
        driverProfileId: 'drv-1',
        type: ApplicationType.NEW_AUTHORIZATION,
        categoryIds: ['cat-sp'],
      },
      coordinatorUser,
    );
    expect(created.status).toBe(ApplicationStatus.SUBMITTED);
  });

  it('rejects duplicate in-flight applications for same driver & category', async () => {
    mockPrisma.driverProfile.findUnique
      .mockResolvedValueOnce({ id: 'drv-1', userId: 'user-drv-1', unitId: 'unit-1' })
      .mockResolvedValueOnce({
        id: 'drv-1',
        userId: 'user-drv-1',
        unitId: 'unit-1',
        dateOfBirth: new Date('1994-01-01'),
        personnelStatus: PersonnelStatus.ACTIVE,
        nationalLicense: {
          verificationStatus: VerificationStatus.VERIFIED,
          expiryDate: new Date('2030-01-01'),
        },
      });

    mockPrisma.vehicleCategory.findMany.mockResolvedValue([
      {
        id: 'cat-lv',
        code: 'CAT-LV',
        minAgeRequired: 18,
        requiresNationalLicense: true,
        prerequisiteCatId: null,
        isActive: true,
      },
    ]);

    mockPrisma.application.findFirst
      .mockResolvedValueOnce(null) // no open permit declaration
      .mockResolvedValueOnce({ applicationNumber: 'APP-2026-00009' });

    await expect(
      service.create(
        {
          driverProfileId: 'drv-1',
          type: ApplicationType.NEW_AUTHORIZATION,
          categoryIds: ['cat-lv'],
        },
        coordinatorUser,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('routes REPLACEMENT to READY_FOR_APPROVAL on screening', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-rep',
      type: ApplicationType.REPLACEMENT,
      status: ApplicationStatus.SUBMITTED,
      driverProfile: { id: 'drv-1', userId: 'user-drv-1' },
      requestedCategories: [{ category: { requiresMedical: true } }],
    });

    mockTx.application.update.mockResolvedValue({
      id: 'app-rep',
      status: ApplicationStatus.READY_FOR_APPROVAL,
    });

    const res = await service.screen(
      'app-rep',
      { action: 'ADVANCE_STAGE', comments: 'Replacement verified' },
      licOfficer,
    );
    expect(res.status).toBe(ApplicationStatus.READY_FOR_APPROVAL);
    expect(mockTx.applicationApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: ApprovalAction.RECOMMENDED,
        officerUserId: 'user-lic-1',
      }),
    });
  });

  it('advances NEW_AUTHORIZATION exactly one stage forward from MEDICAL_PENDING to TRAINING_PENDING', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-new',
      type: ApplicationType.NEW_AUTHORIZATION,
      status: ApplicationStatus.MEDICAL_PENDING,
      driverProfile: { id: 'drv-1', userId: 'user-drv-1' },
      requestedCategories: [{ category: { requiresMedical: true } }],
    });
    mockTx.application.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'app-new', ...data }),
    );

    const res = await service.screen(
      'app-new',
      { action: 'ADVANCE_STAGE' },
      licOfficer,
    );
    expect(res.status).toBe(ApplicationStatus.TRAINING_PENDING);
  });

  it('routes NEW_AUTHORIZATION to MEDICAL_PENDING first after screening', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-new',
      type: ApplicationType.NEW_AUTHORIZATION,
      status: ApplicationStatus.SCREENING,
      driverProfile: { id: 'drv-1', userId: 'user-drv-1' },
      requestedCategories: [{ category: { requiresMedical: true } }],
    });
    mockTx.application.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'app-new', ...data }),
    );

    const res = await service.screen(
      'app-new',
      { action: 'ADVANCE_STAGE' },
      licOfficer,
    );
    expect(res.status).toBe(ApplicationStatus.MEDICAL_PENDING);
  });

  it('skips medical stage when no requested category requires it', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-new',
      type: ApplicationType.NEW_AUTHORIZATION,
      status: ApplicationStatus.EXAM_PENDING,
      driverProfile: { id: 'drv-1', userId: 'user-drv-1' },
      requestedCategories: [{ category: { requiresMedical: false } }],
    });
    mockTx.application.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'app-new', ...data }),
    );

    const res = await service.screen(
      'app-new',
      { action: 'ADVANCE_STAGE' },
      licOfficer,
    );
    expect(res.status).toBe(ApplicationStatus.READY_FOR_APPROVAL);
  });

  it('blocks routing NEW_AUTHORIZATION straight to command approval', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-new',
      type: ApplicationType.NEW_AUTHORIZATION,
      status: ApplicationStatus.SCREENING,
      driverProfile: { id: 'drv-1', userId: 'user-drv-1' },
      requestedCategories: [{ category: { requiresMedical: true } }],
    });

    await expect(
      service.screen(
        'app-new',
        {
          action: 'ADVANCE_STAGE',
          targetStage: ApplicationStatus.READY_FOR_APPROVAL,
        },
        licOfficer,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces Maker-Checker rule blocking creator from approving own created application', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      createdById: 'user-cmdr-1',
      status: ApplicationStatus.READY_FOR_APPROVAL,
      driverProfile: { id: 'drv-1', userId: 'user-drv-1' },
    });

    await expect(
      service.decide(
        'app-1',
        { action: ApprovalAction.APPROVED },
        cmdrUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires comments on rejection and approves valid READY_FOR_APPROVAL application', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      createdById: 'user-coord-1',
      status: ApplicationStatus.READY_FOR_APPROVAL,
      driverProfile: { id: 'drv-1', userId: 'user-drv-1' },
    });

    await expect(
      service.decide(
        'app-1',
        { action: ApprovalAction.REJECTED, comments: '   ' },
        cmdrUser,
      ),
    ).rejects.toThrow(BadRequestException);

    mockTx.application.update.mockResolvedValue({
      id: 'app-1',
      status: ApplicationStatus.APPROVED,
    });

    const approved = await service.decide(
      'app-1',
      { action: ApprovalAction.APPROVED, comments: 'Approved by HQ' },
      cmdrUser,
    );
    expect(approved.status).toBe(ApplicationStatus.APPROVED);
  });

  it('bulk-approves PRE_TRAINED cases, skipping ones the approver created (maker-checker)', async () => {
    mockPrisma.auditLog = { create: jest.fn() };
    const base = {
      type: ApplicationType.PRE_TRAINED,
      status: ApplicationStatus.READY_FOR_APPROVAL,
      driverProfile: { userId: 'u-driver' },
    };
    mockPrisma.application.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'app-own'
        ? { ...base, id: 'app-own', createdById: cmdrUser.id }
        : { ...base, id: where.id, createdById: coordinatorUser.id },
    );
    mockTx.application.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      applicationNumber: `APP-${where.id}`,
      status: data.status,
    }));
    mockTx.application.findUniqueOrThrow.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      driverProfileId: 'drv-1',
      requestedCategories: [{ categoryId: 'cat-lv' }],
      priorPermit: {
        permitNumber: `P-${where.id}`,
        issueDate: new Date('2024-01-01'),
        expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    }));
    mockTx.issuedCredential.findUnique.mockResolvedValue(null);
    mockTx.issuedCredential.create.mockResolvedValue({ id: 'c', credentialNumber: 'P' });

    const summary = await service.bulkApprove(
      { applicationIds: ['app-a', 'app-own', 'app-b', 'app-a'] },
      cmdrUser,
    );

    expect(summary.totalRequested).toBe(3);
    expect(summary.approvedCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    const own = summary.results.find((r) => r.applicationId === 'app-own');
    expect(own?.status).toBe('FAILED');
    // Approval records the permit as an authorization WITHOUT a card.
    expect(mockTx.issuedCredential.create).toHaveBeenCalledTimes(2);
    expect(mockTx.issuedCredential.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cardIssued: false }),
      }),
    );
    expect(own?.error).toMatch(/Maker-Checker/);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('refuses PRE_TRAINED through the generic create endpoint', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'u-drv-1',
      unitId: 'unit-1',
    });
    await expect(
      service.create(
        {
          driverProfileId: 'drv-1',
          type: ApplicationType.PRE_TRAINED,
          categoryIds: ['5b0c8f8e-2a8a-4b8e-9d6a-1c2d3e4f5a6b'],
        },
        coordinatorUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });
  describe('resubmitting a returned application', () => {
    const returnedPreTrained = {
      id: 'app-ret-1',
      type: ApplicationType.PRE_TRAINED,
      status: ApplicationStatus.RETURNED_FOR_CORRECTION,
      rejectionReason: 'Permit number does not match unit records',
      driverProfileId: 'drv-1',
      driverProfile: {
        id: 'drv-1',
        userId: 'user-drv-1',
        unitId: 'unit-1',
        dateOfBirth: new Date('1990-01-01'),
      },
      requestedCategories: [{ categoryId: 'cat-lv', category: { code: 'CAT-LV' } }],
      priorPermit: {
        permitNumber: 'OLD-1',
        issueDate: new Date('2022-01-01'),
        expiryDate: new Date('2030-01-01'),
        trainingReference: null,
        documentUrl: null,
      },
    };

    beforeEach(() => {
      jest
        .spyOn(validatorHelper, 'validateApplicationPrerequisites')
        .mockResolvedValue(undefined as any);
    });

    it('requires a correction note', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(returnedPreTrained);
      await expect(
        service.submit('app-ret-1', {}, coordinatorUser),
      ).rejects.toThrow(/Describe what was corrected/);
    });

    it('rejects existing-permit details on a standard application', async () => {
      mockPrisma.application.findUnique.mockResolvedValue({
        ...returnedPreTrained,
        type: ApplicationType.NEW_AUTHORIZATION,
      });
      await expect(
        service.submit(
          'app-ret-1',
          {
            notes: 'fixed',
            priorPermit: {
              categoryCodes: ['CAT-LV'],
              permitNumber: 'X',
              issueDate: '2022-01-01',
              expiryDate: '2030-01-01',
            },
          },
          coordinatorUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('applies corrected permit details and categories, ignoring its own permit number', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(returnedPreTrained);
      mockPrisma.vehicleCategory.findMany.mockResolvedValue([
        { id: 'cat-lv', code: 'CAT-LV', minAgeRequired: 18 },
        { id: 'cat-mv', code: 'CAT-MV', minAgeRequired: 20 },
      ]);
      mockPrisma.priorPermit.findMany.mockResolvedValue([]);
      mockTx.application.update.mockResolvedValue({ id: 'app-ret-1', status: 'SUBMITTED' });

      await service.submit(
        'app-ret-1',
        {
          notes: 'Corrected permit number and added CAT-MV',
          priorPermit: {
            categoryCodes: ['cat-lv', 'CAT-MV'],
            permitNumber: 'old-1-a',
            issueDate: '2022-01-01',
            expiryDate: '2030-01-01',
          },
        },
        coordinatorUser,
      );

      expect(mockPrisma.priorPermit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ applicationId: { not: 'app-ret-1' } }),
        }),
      );
      expect(mockTx.applicationItem.createMany).toHaveBeenCalledWith({
        data: [
          { applicationId: 'app-ret-1', categoryId: 'cat-lv' },
          { applicationId: 'app-ret-1', categoryId: 'cat-mv' },
        ],
      });
      expect(mockTx.priorPermit.upsert.mock.calls[0][0].update.permitNumber).toBe('OLD-1-A');
      const audit = mockTx.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('RESUBMIT_APPLICATION');
      expect(audit.oldValue.returnReason).toContain('Permit number');
      expect(mockTx.application.update.mock.calls[0][0].data.status).toBe(
        ApplicationStatus.SUBMITTED,
      );
    });
  });
});
