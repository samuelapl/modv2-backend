import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PersonnelService {
  constructor(private readonly prisma: PrismaService) {}

  getStatus() {
    return {
      module: 'personnel',
      description: 'Driver Registry & Organizational Units',
      status: 'READY',
    };
  }
}
