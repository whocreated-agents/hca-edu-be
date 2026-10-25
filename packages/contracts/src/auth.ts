import { z } from 'zod';
import { Ack, ActivationCodeInput, Email, IsoDateTime, Password, Phone, Uuid } from './common';
import { Role, UserStatus } from './enums';
import { authenticated, publicAccess, roles, route } from './route';

/**
 * Parent / staff authentication — BLUEPRINT-001 §4 "Auth", ADR-001 "Parent authentication".
 *
 * There is no SMS and no OTP anywhere. The flow, in full:
 *   1. Office issues a single-use ACTIVATION CODE (printed on a slip). It is not a credential.
 *   2. Parent POSTs /auth/activate with mobile + code + a password THEY choose. The code burns.
 *      The response is already a signed-in session.
 *   3. Thereafter /auth/login with mobile + password.
 *   4. On first login `user.needsEmail` is true: the UI prompts for an email (PUT /auth/me/email),
 *      the address is verified by link, and only then does self-service reset become available.
 *   5. Forgot password: /auth/password/forgot -> emailed single-use 1-hour link -> /auth/password/reset.
 *      A family with no verified email calls the office, which reissues a code; reissue also
 *      revokes the old password and every session (POST /admin/users/:id/activation-code).
 *
 * Tokens: the access token (15 min) is returned in the body and held in memory by the client.
 * The refresh token is an httpOnly, Secure, SameSite=Strict cookie scoped to `/api/v1/auth`, so
 * script cannot read it and it is only ever sent to the auth endpoints. `rememberDevice` makes it
 * a sliding 90-day token; otherwise 24 hours. /auth/refresh takes no body.
 */

export const REFRESH_COOKIE_NAME = 'hca_rt';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_REMEMBERED_DAYS = 90;
export const REFRESH_TTL_SESSION_HOURS = 24;
export const ACTIVATION_CODE_TTL_DAYS = 30;
export const PASSWORD_RESET_TTL_MINUTES = 60;
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCKOUT_MINUTES = 15;

/**
 * Login identifier: a 10-digit mobile (parents) or an email (everyone else). Normalised so the
 * server only ever compares canonical forms.
 */
export const LoginIdentifier = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .transform((v, ctx) => {
    if (v.includes('@')) {
      const e = Email.safeParse(v);
      if (e.success) return e.data;
    } else {
      const p = Phone.safeParse(v);
      if (p.success) return p.data;
    }
    ctx.addIssue({ code: 'custom', message: 'Enter a mobile number or email address' });
    return z.NEVER;
  });

export const SessionUser = z.object({
  id: Uuid,
  role: Role,
  displayName: z.string(),
  email: Email.nullable(),
  emailVerified: z.boolean(),
  /** True for a PARENT without a verified email: the UI should prompt (and let them skip). */
  needsEmail: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const AuthSession = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().int(),
  user: SessionUser,
});
export type AuthSession = z.infer<typeof AuthSession>;

export const LoginRequest = z.strictObject({
  identifier: LoginIdentifier,
  password: z.string().min(1).max(128),
  rememberDevice: z.boolean().default(false),
});
export type LoginRequest = z.input<typeof LoginRequest>;

export const ActivateRequest = z.strictObject({
  identifier: LoginIdentifier,
  code: ActivationCodeInput,
  newPassword: Password,
  rememberDevice: z.boolean().default(false),
});
export type ActivateRequest = z.input<typeof ActivateRequest>;

export const ForgotPasswordRequest = z.strictObject({ identifier: LoginIdentifier });
export type ForgotPasswordRequest = z.input<typeof ForgotPasswordRequest>;

export const ResetPasswordRequest = z.strictObject({
  token: z.string().min(20).max(200),
  newPassword: Password,
});
export type ResetPasswordRequest = z.input<typeof ResetPasswordRequest>;

export const ChangePasswordRequest = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: Password,
});
export type ChangePasswordRequest = z.input<typeof ChangePasswordRequest>;

export const SetEmailRequest = z.strictObject({ email: Email });
export const VerifyEmailRequest = z.strictObject({ token: z.string().min(20).max(200) });

export const IssuedActivationCode = z.object({
  /** Shown ONCE, formatted for the slip (`ABCDE-FGHJK`). Only a hash is stored; it cannot be re-read. */
  code: z.string(),
  expiresAt: IsoDateTime,
  userId: Uuid,
  /** What to print above the code on the slip. */
  identifier: z.string(),
  displayName: z.string(),
});
export type IssuedActivationCode = z.infer<typeof IssuedActivationCode>;

export const authRoutes = {
  login: route({
    method: 'POST', path: '/auth/login', access: publicAccess, sensitive: true,
    summary: 'Sign in (all roles). 401 INVALID_CREDENTIALS is identical for unknown user and wrong password; 423 ACCOUNT_LOCKED after 10 failures.',
    body: LoginRequest, response: AuthSession, status: 200,
  }),
  activate: route({
    method: 'POST', path: '/auth/activate', access: publicAccess, sensitive: true,
    summary: 'Exchange mobile/email + single-use activation code for a password of the caller\'s choosing; the code burns and the caller is signed in. Wrong/expired/used/revoked all return ACTIVATION_CODE_INVALID.',
    body: ActivateRequest, response: AuthSession, status: 200,
  }),
  forgot: route({
    method: 'POST', path: '/auth/password/forgot', access: publicAccess, sensitive: true,
    summary: 'Request a reset link. ALWAYS 202 with the same body whether or not the account exists or has a verified email (no enumeration). Mobile identifiers go to the account\'s verified email if any.',
    body: ForgotPasswordRequest, response: Ack, status: 202,
  }),
  reset: route({
    method: 'POST', path: '/auth/password/reset', access: publicAccess, sensitive: true,
    summary: 'Set a new password using an emailed single-use token (1 hour). Revokes every refresh token. Does not sign in; the client then calls /auth/login.',
    body: ResetPasswordRequest, response: Ack, status: 200,
  }),
  change: route({
    method: 'POST', path: '/auth/password/change', access: authenticated, sensitive: true,
    summary: 'Change own password. Revokes all other sessions and returns a fresh session for this one.',
    body: ChangePasswordRequest, response: AuthSession, status: 200,
  }),
  refresh: route({
    method: 'POST', path: '/auth/refresh', access: publicAccess, sensitive: true,
    summary: 'Rotate the refresh cookie and return a new access token. Reuse of an already-rotated token revokes the whole family and returns REFRESH_TOKEN_INVALID.',
    response: AuthSession, status: 200,
  }),
  logout: route({
    method: 'POST', path: '/auth/logout', access: publicAccess,
    summary: 'Revoke the refresh token family in the cookie and clear it. Idempotent; always 204.',
    status: 204,
  }),
  me: route({
    method: 'GET', path: '/auth/me', access: authenticated,
    summary: 'The current principal.', response: SessionUser,
  }),
  setEmail: route({
    method: 'PUT', path: '/auth/me/email', access: authenticated, sensitive: true,
    summary: 'Set/replace own recovery email. Sends a verification link to it; the address is NOT usable for reset until verified.',
    body: SetEmailRequest, response: Ack, status: 202,
  }),
  verifyEmail: route({
    method: 'POST', path: '/auth/email/verify', access: publicAccess, sensitive: true,
    summary: 'Consume an emailed verification token (opened from a mail client, so deliberately not login-gated).',
    body: VerifyEmailRequest, response: Ack, status: 200,
  }),
  reissueCode: route({
    method: 'POST', path: '/admin/users/:id/activation-code', access: roles(['SUPER_ADMIN', 'OFFICE']), sensitive: true,
    summary: 'Issue a fresh activation code. Atomically: revokes older codes, clears the password hash, bumps authEpoch (kills live access tokens), revokes all refresh tokens, sets status INVITED, audits. OFFICE may do this for PARENT users only; non-parent users need SUPER_ADMIN.',
    params: z.object({ id: Uuid }), response: IssuedActivationCode, status: 201,
  }),
  setUserStatus: route({
    method: 'PATCH', path: '/admin/users/:id/status', access: roles(['SUPER_ADMIN', 'OFFICE']),
    summary: 'Suspend or reinstate an account. Suspending bumps authEpoch and revokes all sessions. OFFICE: PARENT only.',
    params: z.object({ id: Uuid }),
    body: z.strictObject({ status: z.enum([UserStatus.enum.ACTIVE, UserStatus.enum.SUSPENDED]) }),
    response: Ack,
  }),
};
