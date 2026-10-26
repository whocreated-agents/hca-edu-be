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
import { FieldCipherService } from './common/field-cipher.service';
import { CONFIG, type Config } from './config';
import { MaintenanceService } from './jobs/maintenance.service';
import { MailerService } from './mail/mailer.service';
import { ParentController } from './parent/parent.controller';
import { ParentService } from './parent/parent.service';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage/storage.service';
import { FilesController } from './storage/files.controller';
import { AcademicController } from './academic/academic.controller';
import { AcademicService } from './academic/academic.service';
import { StudentsController } from './students/students.controller';
import { StudentsService } from './students/students.service';
import { AdmissionController } from './admission/admission.controller';
import { AdmissionService } from './admission/admission.service';
import { AdminAdmissionController } from './admission/admin-admission.controller';
import { PublicController } from './public/public.controller';
import { PublicService } from './public/public.service';
import { FeesController } from './fees/fees.controller';
import { FeesService } from './fees/fees.service';
import { ContentController } from './content/content.controller';
import { ContentService } from './content/content.service';
import { AuditController } from './audit/audit.controller';

// Controllers/providers are grouped by module below in comment headers; `public/` and this list
// are deliberately a flat array (Nest's single-module style used throughout this app) rather than
// a tree of feature modules, so a later agent can keep appending here without restructuring.
export function appModule(config: Config) {
  @Global()
  @Module({
    imports: [ScheduleModule.forRoot()],
    controllers: [
      AuthController,
      ParentController,
      AttendanceController,
      FilesController,
      // Academic (sessions, class levels, sections, staff)
      AcademicController,
      // Students (students, enrolments, guardians, sensitive tier)
      StudentsController,
      // Admissions (public enquiry/application + admin pipeline)
      AdmissionController,
      AdminAdmissionController,
      // Public reads (profile/content/notices/fees/session/class-levels)
      PublicController,
      // Fee ledger (heads, structure, invoices, office-recorded payments with gapless receipts)
      FeesController,
      // CMS (notices with expiry, content blocks, school profile, facilities, stats)
      ContentController,
      // Admin-only audit log read
      AuditController,
    ],
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
      FieldCipherService,
      StorageService,
      AcademicService,
      StudentsService,
      AdmissionService,
      PublicService,
      FeesService,
      ContentService,
      // Order matters: rate limit first (cheap), then access, then input validation.
      { provide: APP_GUARD, useClass: RateLimitGuard },
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_INTERCEPTOR, useClass: ValidationInterceptor },
      { provide: APP_FILTER, useClass: ProblemFilter },
    ],
    exports: [PrismaService, AuthService, AuditService, CryptoService, MailerService, CONFIG, FieldCipherService, StorageService, StudentsService],
  })
  class AppModule {}
  return AppModule;
}
