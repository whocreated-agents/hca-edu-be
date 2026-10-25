import { z } from 'zod';
import { DateOnly, Email, IdParam, IsoDateTime, Page, PageQuery, Phone, ShortText, Uuid } from './common';
import { EnrollmentDto, GuardianDto, StudentDto } from './dto';
import { EnrollmentState, Gender, MONEY_ROLES, STAFF_ADMIN_ROLES, StudentStatus } from './enums';
import { IssuedActivationCode } from './auth';
import { roles, route } from './route';

/**
 * Admin control plane, part 2: students, enrolments, guardians, and the stage-3 sensitive tier.
 * ACCOUNTS may READ students (fee screens need lookup) but never write them and never see sensitive.
 */

const WRITE = STAFF_ADMIN_ROLES;
const READ = MONEY_ROLES;

/**
 * A guardian either already exists (sibling already in school — link, don't duplicate) or is
 * created. `createLogin` provisions a PARENT User keyed on `phone`; if that phone already belongs
 * to a parent User the server links the existing user, which is what gives a two-child family one
 * login and one dashboard. Fresh logins come back with a one-time activation code.
 */
export const GuardianInput = z.union([
  z.strictObject({ guardianId: Uuid, isPrimary: z.boolean().default(false) }),
  z.strictObject({
    fullName: ShortText(100),
    relation: ShortText(40),
    phone: Phone,
    email: Email.optional(),
    occupation: z.string().trim().max(100).optional(),
    isPrimary: z.boolean().default(false),
    createLogin: z.boolean().default(true),
  }),
]);
export type GuardianInput = z.input<typeof GuardianInput>;

export const GuardianLinked = z.object({ guardian: GuardianDto, activation: IssuedActivationCode.nullable() });

export const EnrollInput = z.strictObject({ sectionId: Uuid, rollNo: z.number().int().min(1).max(999) });

export const StudentCreate = z.strictObject({
  admissionNo: ShortText(30),
  fullName: ShortText(120),
  dob: DateOnly,
  gender: Gender,
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  /** Set when the seat came from an approved application (links them for traceability). */
  applicationId: Uuid.optional(),
  /** Enrol into the RUNNING session in the same call. */
  enrollment: EnrollInput.optional(),
  guardians: z.array(GuardianInput).max(4).default([]),
});
export type StudentCreate = z.input<typeof StudentCreate>;

export const StudentCreated = z.object({
  student: StudentDto,
  guardians: z.array(GuardianLinked),
});

export const StudentUpdate = z.strictObject({
  fullName: ShortText(120).optional(),
  dob: DateOnly.optional(),
  gender: Gender.optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(),
  admissionNo: ShortText(30).optional(),
  status: StudentStatus.optional(),
});

export const StudentDetail = z.object({
  student: StudentDto,
  guardians: z.array(GuardianDto),
  enrollments: z.array(EnrollmentDto),
  /** Whether a StudentSensitive row exists. The data itself is NEVER in this payload. */
  hasSensitiveRecord: z.boolean(),
});
export type StudentDetail = z.infer<typeof StudentDetail>;

export const GuardianUpdate = z.strictObject({
  fullName: ShortText(100).optional(),
  relation: ShortText(40).optional(),
  email: Email.nullable().optional(),
  occupation: z.string().trim().max(100).nullable().optional(),
});

export const EnrollmentUpdate = z.strictObject({
  sectionId: Uuid.optional(),
  rollNo: z.number().int().min(1).max(999).optional(),
  state: EnrollmentState.optional(),
});

export const PromoteInput = z.strictObject({
  toSessionId: Uuid,
  /** Each ACTIVE student in `fromSectionId` gets an enrolment in `toSectionId`, roll numbers continuing in prior order. */
  mappings: z.array(z.strictObject({ fromSectionId: Uuid, toSectionId: Uuid })).min(1).max(60),
});
export const PromoteResult = z.object({
  enrolled: z.number().int(),
  skippedAlreadyEnrolled: z.number().int(),
});

// ---- Stage-3 sensitive tier ---------------------------------------------------------------

export const SensitiveDto = z.object({
  studentId: Uuid,
  /** 12 digits, or null. Decrypted on read; every read is written to AuditLog. */
  aadhaar: z.string().nullable(),
  category: z.string().nullable(),
  medicalNotes: z.string().nullable(),
  consentRecordedAt: IsoDateTime,
  consentBy: z.object({ id: Uuid, displayName: z.string() }),
});
export type SensitiveDto = z.infer<typeof SensitiveDto>;

export const SensitiveUpsert = z.strictObject({
  aadhaar: z.string().regex(/^\d{12}$/, '12 digits').nullable().optional(),
  category: z.enum(['GENERAL', 'OBC', 'SC', 'ST', 'EWS', 'OTHER']).nullable().optional(),
  medicalNotes: z.string().trim().max(2000).nullable().optional(),
  /** The office confirms the parent consented to this collection (stage 3, after a seat is offered). */
  consentConfirmed: z.literal(true),
});

export const adminStudentRoutes = {
  students: route({
    method: 'GET', path: '/admin/students', access: roles(READ),
    summary: 'Search/list students. `q` matches name or admission number. Never includes sensitive data.',
    query: PageQuery.extend({
      q: z.string().trim().max(100).optional(),
      sessionId: Uuid.optional(),
      classLevelId: Uuid.optional(),
      sectionId: Uuid.optional(),
      status: StudentStatus.optional(),
    }),
    response: Page(StudentDto),
  }),
  createStudent: route({
    method: 'POST', path: '/admin/students', access: roles(WRITE),
    summary: 'Create a student, optionally enrol (RUNNING session) and attach/create guardians + parent logins in one transaction.',
    body: StudentCreate, response: StudentCreated,
  }),
  student: route({
    method: 'GET', path: '/admin/students/:id', access: roles(READ), summary: 'One student with guardians and enrolment history.',
    params: IdParam, response: StudentDetail,
  }),
  updateStudent: route({
    method: 'PATCH', path: '/admin/students/:id', access: roles(WRITE), summary: 'Edit core fields. Audited with before/after.',
    params: IdParam, body: StudentUpdate, response: StudentDto,
  }),
  uploadPhoto: route({
    method: 'PUT', path: '/admin/students/:id/photo', access: roles(WRITE),
    summary: 'Multipart `file`. jpeg/png, 2 MB, sniffed. Stored privately; served by signed URL.', params: IdParam,
    body: z.object({}), bodyKind: 'multipart', response: StudentDto, status: 200,
  }),

  enroll: route({
    method: 'POST', path: '/admin/students/:id/enrollments', access: roles(WRITE),
    summary: 'Enrol in a section of the RUNNING (or an UPCOMING) session. 409 if already enrolled that session or roll number taken.',
    params: IdParam, body: EnrollInput.extend({ sessionId: Uuid.optional() }), response: EnrollmentDto,
  }),
  updateEnrollment: route({
    method: 'PATCH', path: '/admin/enrollments/:id', access: roles(WRITE), summary: 'Move section / change roll number / withdraw.',
    params: IdParam, body: EnrollmentUpdate, response: EnrollmentDto,
  }),
  promote: route({
    method: 'POST', path: '/admin/enrollments/promote', access: roles(WRITE),
    summary: 'Year rollover: bulk-create next-session enrolments from section mappings. Idempotent (already-enrolled students are skipped).',
    body: PromoteInput, response: PromoteResult, status: 200,
  }),

  linkGuardian: route({
    method: 'POST', path: '/admin/students/:id/guardians', access: roles(WRITE),
    summary: 'Attach an existing guardian or create one (+ parent login). Returns a one-time activation code for a newly created login.',
    params: IdParam, body: GuardianInput, response: GuardianLinked,
  }),
  unlinkGuardian: route({
    method: 'DELETE', path: '/admin/students/:id/guardians/:guardianId', access: roles(WRITE),
    summary: 'Detach a guardian from a student. If it was their last child the parent login is suspended.',
    params: z.object({ id: Uuid, guardianId: Uuid }),
  }),
  updateGuardian: route({
    method: 'PATCH', path: '/admin/guardians/:id', access: roles(WRITE),
    summary: 'Edit guardian details. An email set here counts as verified (office-entered). Phone is the login id and changes only via reissue.',
    params: IdParam, body: GuardianUpdate, response: GuardianDto,
  }),

  getSensitive: route({
    method: 'GET', path: '/admin/students/:id/sensitive', access: roles(WRITE),
    summary: 'Stage-3 data. OFFICE+ only; separate guard; EVERY read is written to AuditLog. 404 if none recorded.',
    params: IdParam, response: SensitiveDto,
  }),
  putSensitive: route({
    method: 'PUT', path: '/admin/students/:id/sensitive', access: roles(WRITE),
    summary: 'Create/replace stage-3 data (encrypted at rest). Requires consentConfirmed; audited (field names only, never values).',
    params: IdParam, body: SensitiveUpsert, response: SensitiveDto, status: 200,
  }),
};
