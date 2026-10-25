import { z } from 'zod';
import { DateOnly, Email, IsoDateTime, Money, Uuid } from './common';
import {
  AttendanceStatus,
  ClassStage,
  EnrollmentState,
  Gender,
  InvoiceStatus,
  PaymentMode,
  Role,
  SessionState,
  StudentStatus,
} from './enums';

/** Response shapes shared by more than one route group. Responses never include internal columns
 *  (passwordHash, tokenHash, *Enc, fileKey): files are exposed only as short-lived signed URLs. */

export const SessionDto = z.object({
  id: Uuid,
  label: z.string(),
  startsOn: DateOnly,
  endsOn: DateOnly,
  state: SessionState,
  isAdmissionOpen: z.boolean(),
});
export type SessionDto = z.infer<typeof SessionDto>;

export const ClassLevelDto = z.object({
  id: Uuid,
  name: z.string(),
  order: z.number().int(),
  stage: ClassStage,
  minAge: z.number().int().nullable(),
  maxAge: z.number().int().nullable(),
});
export type ClassLevelDto = z.infer<typeof ClassLevelDto>;

export const StaffRefDto = z.object({ id: Uuid, fullName: z.string() });

export const SectionDto = z.object({
  id: Uuid,
  sessionId: Uuid,
  classLevelId: Uuid,
  className: z.string(),
  name: z.string(),
  classTeacher: StaffRefDto.nullable(),
  /** ACTIVE enrolments only. */
  studentCount: z.number().int(),
});
export type SectionDto = z.infer<typeof SectionDto>;

export const StaffDto = z.object({
  id: Uuid,
  userId: Uuid,
  employeeCode: z.string(),
  fullName: z.string(),
  designation: z.string(),
  phone: z.string(),
  email: Email.nullable(),
  role: Role,
  joinedOn: DateOnly,
  isActive: z.boolean(),
});
export type StaffDto = z.infer<typeof StaffDto>;

export const EnrollmentDto = z.object({
  id: Uuid,
  sessionId: Uuid,
  sessionLabel: z.string(),
  sectionId: Uuid,
  className: z.string(),
  sectionName: z.string(),
  rollNo: z.number().int(),
  state: EnrollmentState,
});
export type EnrollmentDto = z.infer<typeof EnrollmentDto>;

/** Never includes anything from StudentSensitive. That tier has its own routes, guard and audit. */
export const StudentDto = z.object({
  id: Uuid,
  admissionNo: z.string(),
  fullName: z.string(),
  dob: DateOnly,
  gender: Gender,
  bloodGroup: z.string().nullable(),
  status: StudentStatus,
  /** Short-lived signed URL, or null. Never a permanent public path. */
  photoUrl: z.string().nullable(),
  /** Enrolment in the RUNNING session, if any. */
  currentEnrollment: EnrollmentDto.nullable(),
});
export type StudentDto = z.infer<typeof StudentDto>;

export const GuardianDto = z.object({
  id: Uuid,
  fullName: z.string(),
  relation: z.string(),
  phone: z.string(),
  email: Email.nullable(),
  occupation: z.string().nullable(),
  isPrimary: z.boolean(),
  /** Whether this guardian has a portal login, and where they are in setting it up. */
  loginStatus: z.enum(['NONE', 'INVITED', 'ACTIVE', 'SUSPENDED']),
});
export type GuardianDto = z.infer<typeof GuardianDto>;

export const InvoiceLineDto = z.object({ feeHeadId: Uuid, feeHeadName: z.string(), amount: Money });

export const PaymentDto = z.object({
  id: Uuid,
  receiptNo: z.string(),
  amount: Money,
  paidOn: DateOnly,
  mode: PaymentMode,
  reference: z.string().nullable(),
  /** Voided receipts keep their number and are shown struck through; they no longer count. */
  voided: z.boolean(),
  voidReason: z.string().nullable(),
});
export type PaymentDto = z.infer<typeof PaymentDto>;

export const InvoiceDto = z.object({
  id: Uuid,
  studentId: Uuid,
  sessionId: Uuid,
  periodLabel: z.string(),
  amountDue: Money,
  amountPaid: Money,
  balance: Money,
  dueOn: DateOnly,
  /** Derived server-side: dueOn is past and balance > 0. */
  isOverdue: z.boolean(),
  status: InvoiceStatus,
  waivedReason: z.string().nullable(),
  lines: z.array(InvoiceLineDto),
  payments: z.array(PaymentDto),
});
export type InvoiceDto = z.infer<typeof InvoiceDto>;

export const AttendanceEntryDto = z.object({
  studentId: Uuid,
  status: AttendanceStatus,
  note: z.string().nullable(),
});

export const AuditEntryDto = z.object({
  id: Uuid,
  at: IsoDateTime,
  actor: z.object({ id: Uuid, displayName: z.string(), role: Role }).nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDto>;
