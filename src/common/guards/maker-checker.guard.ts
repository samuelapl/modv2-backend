import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppForbiddenException, AppNotFoundException } from '../errors';

@Injectable()
export class MakerCheckerGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const applicationId = request.params.id || request.params.applicationId;

    if (!user || !applicationId) {
      return true;
    }

    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { createdById: true },
    });

    if (!application) {
      throw new AppNotFoundException(
      'MAKER_CHECKER_APPLICATION_NOT_FOUND', {}, 'Application not found');
    }

    if (application.createdById === user.id) {
      throw new AppForbiddenException(
      'MAKER_CHECKER_VIOLATION', {}, 
        'Maker-Checker Violation: You cannot approve an application you initiated.',
      );
    }

    return true;
  }
}
