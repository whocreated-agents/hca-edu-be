import { z } from 'zod';

/**
 * Mirrors prisma/schema.prisma enums one-for-one. test/prisma-parity.test.ts parses the schema and
 * fails if these drift, so a new enum value cannot reach the database without reaching the contract.
 */

export const Role = z.enum(['SUPER_ADMIN', 'OFFICE', 'ACCOUNTS', 'TEACHER', 'PARENT', 'STUDENT']);
export const UserStatus = z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']);
export const EmailTokenPurpose = z.enum(['PASSWORD_RESET', 'VERIFY_EMAIL']);
export const SessionState = z.enum(['UPCOMING', 'RUNNING', 'CLOSED']);
export const ClassStage = z.enum(['PRE_PRIMARY', 'PRIMARY', 'MIDDLE', 'SECONDARY']);
export const Gender = z.enum(['MALE', 'FEMALE', 'OTHER']);
export const StudentStatus = z.enum(['ACTIVE', 'TRANSFERRED_OUT', 'ALUMNUS']);
export const EnrollmentState = z.enum(['ACTIVE', 'WITHDRAWN', 'COMPLETED']);
export const EnquiryState = z.enum(['NEW', 'CONTACTED', 'INVITED_TO_APPLY', 'CLOSED']);
export const ApplicationStatus = z.enum(['SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED']);
export const DocumentKind = z.enum(['PHOTO', 'BIRTH_CERTIFICATE', 'TC', 'OTHER']);
export const FeeFrequency = z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_TIME']);
export const InvoiceStatus = z.enum(['PENDING', 'PARTIAL', 'PAID', 'WAIVED']);
export const PaymentMode = z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI_MANUAL']);
export const AttendanceStatus = z.enum(['PRESENT', 'ABSENT', 'LATE', 'LEAVE']);
export const NoticeTag = z.enum(['ADMISSION', 'EXAM', 'HOLIDAY', 'EVENT', 'FEE']);
export const NoticeAudience = z.enum(['PUBLIC', 'PARENTS', 'STAFF', 'STUDENTS']);
export const MediaUsage = z.enum(['PUBLIC_SITE', 'PORTAL_ONLY', 'UNPUBLISHED']);
export const ConsentScope = z.enum(['PUBLIC_WEBSITE', 'WEBSITE_AND_SOCIAL']);

export type Role = z.infer<typeof Role>;
export type UserStatus = z.infer<typeof UserStatus>;
export type SessionState = z.infer<typeof SessionState>;
export type ClassStage = z.infer<typeof ClassStage>;
export type Gender = z.infer<typeof Gender>;
export type StudentStatus = z.infer<typeof StudentStatus>;
export type EnrollmentState = z.infer<typeof EnrollmentState>;
export type EnquiryState = z.infer<typeof EnquiryState>;
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;
export type DocumentKind = z.infer<typeof DocumentKind>;
export type FeeFrequency = z.infer<typeof FeeFrequency>;
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;
export type PaymentMode = z.infer<typeof PaymentMode>;
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;
export type NoticeTag = z.infer<typeof NoticeTag>;
export type NoticeAudience = z.infer<typeof NoticeAudience>;
export type MediaUsage = z.infer<typeof MediaUsage>;
export type ConsentScope = z.infer<typeof ConsentScope>;

/** Role groups used in route access declarations. */
export const STAFF_ADMIN_ROLES = ['SUPER_ADMIN', 'OFFICE'] as const satisfies readonly Role[];
export const MONEY_ROLES = ['SUPER_ADMIN', 'OFFICE', 'ACCOUNTS'] as const satisfies readonly Role[];
