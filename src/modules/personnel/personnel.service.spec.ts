import { Test, TestingModule } from '@nestjs/testing';
import { PersonnelService } from './personnel.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PersonnelService', () => {
  let service: PersonnelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonnelService,
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PersonnelService>(PersonnelService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return READY status', () => {
    expect(service.getStatus()).toEqual({
      module: 'personnel',
      description: 'Driver Registry & Organizational Units',
      status: 'READY',
    });
  });
});
