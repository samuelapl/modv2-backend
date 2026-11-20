import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from './common/guards/must-change-password.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { KeycloakModule } from './modules/keycloak/keycloak.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PersonnelModule } from './modules/personnel/personnel.module';
import { NationalLicenseModule } from './modules/national-license/national-license.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { TrainingModule } from './modules/training/training.module';
import { ExaminationsModule } from './modules/examinations/examinations.module';
import { MedicalModule } from './modules/medical/medical.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { EligibilityModule } from './modules/eligibility/eligibility.module';
import { SafetyModule } from './modules/safety/safety.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuditModule } from './modules/audit/audit.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ExpiryModule } from './modules/expiry/expiry.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PoliciesModule } from './modules/policies/policies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    RedisModule,
    CommonModule,
    KeycloakModule,
    // All 15 Domain Modules
    AuthModule,
    UsersModule,
    PersonnelModule,
    NationalLicenseModule,
    CategoriesModule,
    ApplicationsModule,
    TrainingModule,
    ExaminationsModule,
    MedicalModule,
    CredentialsModule,
    EligibilityModule,
    SafetyModule,
    StorageModule,
    AuditModule,
    ReportsModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ExpiryModule,
    NotificationsModule,
    PoliciesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
