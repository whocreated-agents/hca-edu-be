import { z } from 'zod';

/**
 * Stable machine-readable error codes. The UI switches on `code`, never on `title` or `detail`
 * (those are human text and may change). Wire format is RFC 9457 Problem Details.
 */
export const ErrorCode = z.enum([
  // generic
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
  // auth
  'INVALID_CREDENTIALS', // wrong identifier/password, deliberately indistinguishable
  'ACCOUNT_LOCKED', // 10 failures -> 15 min; carries retryAfterSeconds
  'ACCOUNT_SUSPENDED',
  'ACTIVATION_REQUIRED', // user exists but has no password yet: use the slip
  'ACTIVATION_CODE_INVALID', // wrong / expired / already used / revoked: one code, so nothing leaks
  'RESET_TOKEN_INVALID',
  'REFRESH_TOKEN_INVALID',
  'EMAIL_ALREADY_VERIFIED',
  // domain
  'NO_ADMISSION_SESSION_OPEN',
  'SESSION_STATE_INVALID',
  'ATTENDANCE_ROSTER_MISMATCH', // payload does not cover exactly the live roster
  'ATTENDANCE_STALE', // a newer submission already exists (capturedAt older)
  'ATTENDANCE_FINALISED',
  'ATTENDANCE_DATE_NOT_ALLOWED', // future, holiday, outside session, or outside teacher edit window
  'ATTENDANCE_SESSION_NOT_RUNNING',
  'PAYMENT_EXCEEDS_BALANCE',
  'INVOICE_NOT_PAYABLE',
  'MEDIA_CONSENT_REQUIRED', // PUBLIC_SITE publish blocked: a tagged child lacks live consent
  'APPLICATION_LOCKED', // already past SUBMITTED
  'APPLICATION_LINK_INVALID', // tokenised link wrong/expired/revoked
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_TOO_LARGE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const FieldIssue = z.object({
  /** Dot path into the offending payload, e.g. `entries.3.status`. */
  path: z.string(),
  message: z.string(),
});

export const ProblemDetails = z.object({
  type: z.string(), // `about:blank` unless a doc URL exists
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: ErrorCode,
  requestId: z.string(),
  /** Present for VALIDATION_FAILED. */
  errors: z.array(FieldIssue).optional(),
  /** Present for ACCOUNT_LOCKED / RATE_LIMITED. */
  retryAfterSeconds: z.number().int().optional(),
  /** Machine-readable extras, e.g. the roster for ATTENDANCE_ROSTER_MISMATCH. */
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
