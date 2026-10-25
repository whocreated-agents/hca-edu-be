import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AttendanceController } from './attendance/attendance.controller';
import { AttendanceService } from './attendance/attendance.service';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CryptoService } from './auth/crypto.service';
import { AccessGuard } from './authz/access.guard';
import { RelationsService } from './authz/relations.service';
import { ProblemFilter } from './common/problem';
import { RateLimitGuard } from './common/rate-limit.guard';
import { ValidationInterceptor } from './common/validation.interceptor';
import { CONFIG, type Config } from './config';
import { MaintenanceService } from './jobs/maintenance.service';
import { MailerService } from './mail/mailer.service';
import { ParentController } from './parent/parent.controller';
import { ParentService } from './parent/parent.service';
import { PrismaService } from './prisma.service';

export function appModule(config: Config) {
  @Global()
  @Module({
    imports: [ScheduleModule.forRoot()],
    controllers: [AuthController, ParentController, AttendanceController],
    providers: [
      { provide: CONFIG, useValue: config },
      PrismaService,
      CryptoService,
      AuditService,
      MailerService,
      AuthService,
      RelationsService,
      ParentService,
      AttendanceService,
      MaintenanceService,
      // Order matters: rate limit first (cheap), then access, then input validation.
      { provide: APP_GUARD, useClass: RateLimitGuard },
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_INTERCEPTOR, useClass: ValidationInterceptor },
      { provide: APP_FILTER, useClass: ProblemFilter },
    ],
    exports: [PrismaService, AuthService, AuditService, CryptoService, MailerService, CONFIG],
  })
  class AppModule {}
  return AppModule;
}
