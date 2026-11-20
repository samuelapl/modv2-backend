import { Test, TestingModule } from '@nestjs/testing';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { CardPrintService } from './card/card-print.service';
import { CardReprintService } from './card/card-reprint.service';

describe('CredentialsController', () => {
  let controller: CredentialsController;
  let service: jest.Mocked<Partial<CredentialsService>>;

  beforeEach(async () => {
    service = {
      getStatus: jest.fn().mockReturnValue({ module: 'credentials', status: 'READY' }),
      getPublicKeyInfo: jest.fn().mockReturnValue({
        algorithm: 'Ed25519',
        keyId: 'mod-root-2026-v1',
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
        rawPublicKeyHex: 'abcdef123456...',
        rawPublicKeyBase64: 'q83...',
        issuedAt: '2026-01-01T00:00:00.000Z',
      }),
      verifyQrToken: jest.fn().mockResolvedValue({
        cryptographicValid: true,
        valid: true,
        status: 'ACTIVE',
        reason: 'Valid active MoD driving authorization.',
        credential: { id: 'c-1', credentialNumber: 'MOD-AUTH-2026-0001' } as any,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialsController],
      providers: [
        { provide: CredentialsService, useValue: service },
        { provide: CardPrintService, useValue: {} },
        { provide: CardReprintService, useValue: {} },
      ],
    }).compile();

    controller = module.get<CredentialsController>(CredentialsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getHealth returns module readiness', () => {
    expect(controller.getHealth()).toEqual({ module: 'credentials', status: 'READY' });
    expect(service.getStatus).toHaveBeenCalled();
  });

  it('getPublicKey returns Ed25519 public key info', () => {
    const res = controller.getPublicKey();
    expect(res.algorithm).toBe('Ed25519');
    expect(res.keyId).toBe('mod-root-2026-v1');
    expect(service.getPublicKeyInfo).toHaveBeenCalled();
  });

  it('verifyQr validates a QR token', async () => {
    const res = await controller.verifyQr({ token: 'IDLMS2.payload.sig' });
    expect(res.valid).toBe(true);
    expect(service.verifyQrToken).toHaveBeenCalledWith('IDLMS2.payload.sig');
  });
});
