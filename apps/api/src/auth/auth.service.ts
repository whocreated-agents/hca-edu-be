import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Role as DbRole, User } from '@prisma/client';
import {
  ACTIVATION_CODE_TTL_DAYS,
  LOGIN_LOCKOUT_MINUTES,
  LOGIN_MAX_FAILURES,
  PASSWORD_RESET_TTL_MINUTES,
  REFRESH_TTL_REMEMBERED_DAYS,
  REFRESH_TTL_SESSION_HOURS,
  ACCESS_TOKEN_TTL_SECONDS,
  type AuthSession,
  type IssuedActivationCode,
  type SessionUser,
} from '@hca/contracts';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Problem } from '../common/problem';
import { CONFIG, type Config } from '../config';
import { MailerService } from '../mail/mailer.service';
import { PrismaService, type Db } from '../prisma.service';
import { CryptoService } from './crypto.service';

const VERIFY_EMAIL_TTL_HOURS = 24;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface Ctx {
  ip: string | null;
  userAgent: string | null;
}

export interface Issued {
  session: AuthSession;
  refresh: { token: string; maxAgeMs: number };
}

export interface Actor {
  id: string;
  role: DbRole;
}

const invalidCreds = () => new Problem({ status: 401, code: 'INVALID_CREDENTIALS', detail: 'Incorrect mobile/email or password' });
const invalidCode = () => new Problem({ status: 401, code: 'ACTIVATION_CODE_INVALID', detail: 'That code is not valid. Ask the school office for a new slip.' });
const invalidRefresh = () => new Problem({ status: 401, code: 'REFRESH_TOKEN_INVALID', detail: 'Please sign in again' });
const invalidReset = () => new Problem({ status: 400, code: 'RESET_TOKEN_INVALID', detail: 'This link is invalid or has expired' });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly mail: MailerService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  // ---- helpers ------------------------------------------------------------------------------

  private findByIdentifier(identifier: string): Promise<User | null> {
    return identifier.includes('@')
      ? this.prisma.user.findFirst({ where: { email: identifier, role: { not: 'PARENT' } } })
      : this.prisma.user.findUnique({ where: { phone: identifier } });
  }

  private async displayName(db: Db, u: User): Promise<string> {
    if (u.role === 'PARENT') {
      const g = await db.guardian.findUnique({ where: { userId: u.id }, select: { fullName: true } });
      if (g) return g.fullName;
    } else {
      const s = await db.staff.findUnique({ where: { userId: u.id }, select: { fullName: true } });
      if (s) return s.fullName;
    }
    return u.email ?? u.phone ?? 'User';
  }

  private async sessionUser(db: Db, u: User): Promise<SessionUser> {
    const verified = u.emailVerifiedAt !== null;
    return {
      id: u.id,
      role: u.role,
      displayName: await this.displayName(db, u),
      email: u.email,
      emailVerified: verified,
      needsEmail: u.role === 'PARENT' && !verified,
    };
  }

  private async issueSession(db: Db, u: User, opts: { remember: boolean; userAgent: string | null; familyId?: string }): Promise<Issued> {
    const { token, hash } = this.crypto.newToken();
    const maxAgeMs = opts.remember ? REFRESH_TTL_REMEMBERED_DAYS * DAY : REFRESH_TTL_SESSION_HOURS * HOUR;
    await db.refreshToken.create({
      data: {
        userId: u.id,
        tokenHash: hash,
        familyId: opts.familyId ?? randomUUID(),
        userAgent: opts.userAgent?.slice(0, 300) ?? null,
        remember: opts.remember,
        expiresAt: new Date(Date.now() + maxAgeMs),
      },
    });
    const session: AuthSession = {
      accessToken: this.crypto.signAccess({ sub: u.id, role: u.role, ep: u.authEpoch }),
      tokenType: 'Bearer',
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      user: await this.sessionUser(db, u),
    };
    return { session, refresh: { token, maxAgeMs } };
  }

  private async recordFailure(u: User): Promise<void> {
    const failed = u.failedAttempts + 1;
    if (failed >= LOGIN_MAX_FAILURES) {
      await this.prisma.user.update({ where: { id: u.id }, data: { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * MIN) } });
    } else {
      await this.prisma.user.update({ where: { id: u.id }, data: { failedAttempts: { increment: 1 } } });
    }
  }

  private assertNotLocked(u: User): void {
    if (u.lockedUntil && u.lockedUntil > new Date()) {
      throw new Problem({
        status: 423,
        code: 'ACCOUNT_LOCKED',
        detail: 'Too many failed attempts. Try again later.',
        retryAfterSeconds: Math.ceil((u.lockedUntil.getTime() - Date.now()) / 1000),
      });
    }
  }

  // ---- login / activation ---------------------------------------------------------------------

  async login(input: { identifier: string; password: string; rememberDevice: boolean }, ctx: Ctx): Promise<Issued> {
    const user = await this.findByIdentifier(input.identifier);
    if (!user) {
      await this.crypto.verifySecret(null, input.password);
      throw invalidCreds();
    }
    this.assertNotLocked(user);
    if (!user.passwordHash) {
      await this.crypto.verifySecret(null, input.password);
      // A parent who has a record but has not used the slip yet: tell them what to do, not "wrong password".
      if (user.status === 'INVITED') {
        throw new Problem({ status: 401, code: 'ACTIVATION_REQUIRED', detail: 'This account has not been activated. Use the activation code from the school office.' });
      }
      throw invalidCreds();
    }
    if (!(await this.crypto.verifySecret(user.passwordHash, input.password))) {
      await this.recordFailure(user);
      throw invalidCreds();
    }
    if (user.status !== 'ACTIVE') throw new Problem({ status: 403, code: 'ACCOUNT_SUSPENDED', detail: 'This account is suspended. Contact the school office.' });

    const fresh = await this.prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return this.issueSession(this.prisma, fresh, { remember: input.rememberDevice, userAgent: ctx.userAgent });
  }

  async activate(input: { identifier: string; code: string; newPassword: string; rememberDevice: boolean }, ctx: Ctx): Promise<Issued> {
    const user = await this.findByIdentifier(input.identifier);
    if (!user) {
      await this.crypto.verifySecret(null, input.code);
      throw invalidCode();
    }
    this.assertNotLocked(user);
    const candidate =
      user.status === 'INVITED'
        ? await this.prisma.activationCode.findFirst({
            where: { userId: user.id, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
          })
        : null;
    if (!candidate || !(await this.crypto.verifySecret(candidate.codeHash, input.code))) {
      await this.recordFailure(user);
      throw invalidCode();
    }

    const passwordHash = await this.crypto.hashSecret(input.newPassword);
    return this.prisma.$transaction(async (tx) => {
      const burned = await tx.activationCode.updateMany({ where: { id: candidate.id, consumedAt: null, revokedAt: null }, data: { consumedAt: new Date() } });
      if (burned.count !== 1) throw invalidCode(); // lost a race with a concurrent use of the same code
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, status: 'ACTIVE', authEpoch: { increment: 1 }, failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      await this.audit.record({ actorId: user.id, action: 'auth.activate', entity: 'User', entityId: user.id, ip: ctx.ip }, tx);
      return this.issueSession(tx, updated, { remember: input.rememberDevice, userAgent: ctx.userAgent });
    });
  }

  // ---- refresh / logout -----------------------------------------------------------------------

  async refresh(rawToken: string | undefined, ctx: Ctx): Promise<Issued> {
    if (!rawToken) throw invalidRefresh();
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.crypto.tokenHash(rawToken) } });
    if (!row) throw invalidRefresh();
    if (row.revokedAt) {
      // A rotated-out token was presented again: assume theft and kill the whole family.
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw invalidRefresh();
    }
    if (row.expiresAt <= new Date()) throw invalidRefresh();
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || user.status !== 'ACTIVE') throw invalidRefresh();

    return this.prisma.$transaction(async (tx) => {
      const rotated = await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (rotated.count !== 1) throw invalidRefresh();
      return this.issueSession(tx, user, { remember: row.remember, userAgent: ctx.userAgent, familyId: row.familyId });
    });
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.crypto.tokenHash(rawToken) } });
    if (row) await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(userId: string): Promise<SessionUser> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.sessionUser(this.prisma, u);
  }

  // ---- password reset / change ------------------------------------------------------------------

  /** Always resolves; whether anything was sent is observable only in the recipient's inbox. */
  async forgot(identifier: string): Promise<void> {
    const user = await this.findByIdentifier(identifier);
    if (!user || user.status !== 'ACTIVE' || !user.email || !user.emailVerifiedAt) {
      // Same work, so timing does not distinguish the cases.
      this.crypto.newToken();
      return;
    }
    const { token, hash } = this.crypto.newToken();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, purpose: 'PASSWORD_RESET', sentTo: user.email, tokenHash: hash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * MIN) },
      }),
    ]);
    void this.mail.send({
      to: user.email,
      subject: 'Reset your HCA password',
      text: `Open this link to choose a new password. It works once and expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.\n\n${this.cfg.WEB_ORIGIN}/reset-password#token=${token}\n\nIf you did not ask for this, ignore this email; your password has not changed.`,
    });
  }

  async reset(input: { token: string; newPassword: string }, ctx: Ctx): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.crypto.tokenHash(input.token) }, include: { user: true } });
    if (!row || row.purpose !== 'PASSWORD_RESET' || row.consumedAt || row.expiresAt <= new Date() || row.user.status !== 'ACTIVE') throw invalidReset();
    const passwordHash = await this.crypto.hashSecret(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      const burned = await tx.passwordResetToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (burned.count !== 1) throw invalidReset();
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, authEpoch: { increment: 1 }, failedAttempts: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId: row.userId, action: 'auth.password.reset', entity: 'User', entityId: row.userId, ip: ctx.ip }, tx);
    });
  }

  async change(userId: string, input: { currentPassword: string; newPassword: string }, currentRefresh: string | undefined, ctx: Ctx): Promise<Issued> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    this.assertNotLocked(user);
    if (!(await this.crypto.verifySecret(user.passwordHash, input.currentPassword))) {
      await this.recordFailure(user);
      throw invalidCreds();
    }
    const current = currentRefresh ? await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.crypto.tokenHash(currentRefresh) } }) : null;
    const remember = current?.userId === userId && current.remember;
    const passwordHash = await this.crypto.hashSecret(input.newPassword);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { passwordHash, authEpoch: { increment: 1 }, failedAttempts: 0 } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId: userId, action: 'auth.password.change', entity: 'User', entityId: userId, ip: ctx.ip }, tx);
      return this.issueSession(tx, updated, { remember, userAgent: ctx.userAgent });
    });
  }

  // ---- recovery email -----------------------------------------------------------------------

  async setEmail(userId: string, email: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Staff/admin emails are their login identifier and are managed by an administrator.
    if (user.role !== 'PARENT') throw Problem.forbidden('Your email is managed by the school office');
    if (user.email === email && user.emailVerifiedAt) {
      throw new Problem({ status: 409, code: 'EMAIL_ALREADY_VERIFIED', detail: 'This address is already verified' });
    }
    const { token, hash } = this.crypto.newToken();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { email, emailVerifiedAt: null } }),
      this.prisma.passwordResetToken.updateMany({ where: { userId, purpose: 'VERIFY_EMAIL', consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId, purpose: 'VERIFY_EMAIL', sentTo: email, tokenHash: hash, expiresAt: new Date(Date.now() + VERIFY_EMAIL_TTL_HOURS * HOUR) },
      }),
    ]);
    void this.mail.send({
      to: email,
      subject: 'Confirm your email for the HCA portal',
      text: `Confirm this address so you can reset your password yourself if you ever forget it.\n\n${this.cfg.WEB_ORIGIN}/verify-email#token=${token}\n\nThe link works once and expires in ${VERIFY_EMAIL_TTL_HOURS} hours.`,
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.crypto.tokenHash(rawToken) }, include: { user: true } });
    if (!row || row.purpose !== 'VERIFY_EMAIL' || row.consumedAt || row.expiresAt <= new Date() || row.user.email !== row.sentTo) throw invalidReset();
    await this.prisma.$transaction(async (tx) => {
      const burned = await tx.passwordResetToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (burned.count !== 1) throw invalidReset();
      await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    });
  }

  // ---- office-mediated recovery -----------------------------------------------------------------

  /**
   * Creates a fresh single-use code for `userId` and revokes any older ones. Does NOT touch the
   * password; use {@link reissueCode} for recovery. Call inside the transaction that creates the
   * parent user so the slip and the account exist together.
   */
  async createActivationCode(db: Db, userId: string, issuerId: string): Promise<{ display: string; expiresAt: Date }> {
    await db.activationCode.updateMany({ where: { userId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const { raw, display } = this.crypto.newActivationCode();
    const expiresAt = new Date(Date.now() + ACTIVATION_CODE_TTL_DAYS * DAY);
    await db.activationCode.create({ data: { userId, issuedById: issuerId, codeHash: await this.crypto.hashSecret(raw), expiresAt } });
    return { display, expiresAt };
  }

  private async assertCanManage(actor: Actor, targetId: string): Promise<User> {
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw Problem.notFound();
    if (target.id === actor.id) throw Problem.forbidden('You cannot do this to your own account');
    // OFFICE looks after families; only a super-admin manages staff and other admins.
    if (actor.role !== 'SUPER_ADMIN' && target.role !== 'PARENT') throw Problem.forbidden('Only a super-admin can manage this account');
    return target;
  }

  async reissueCode(actor: Actor, targetId: string, ctx: Ctx): Promise<IssuedActivationCode> {
    const target = await this.assertCanManage(actor, targetId);
    return this.prisma.$transaction(async (tx) => {
      const { display, expiresAt } = await this.createActivationCode(tx, target.id, actor.id);
      await tx.user.update({
        where: { id: target.id },
        data: {
          passwordHash: null,
          authEpoch: { increment: 1 },
          failedAttempts: 0,
          lockedUntil: null,
          // A suspended account stays suspended; reissue must not be a way to un-suspend.
          ...(target.status === 'SUSPENDED' ? {} : { status: 'INVITED' as const }),
        },
      });
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.passwordResetToken.updateMany({ where: { userId: target.id, consumedAt: null }, data: { consumedAt: new Date() } });
      await this.audit.record({ actorId: actor.id, action: 'auth.code.reissue', entity: 'User', entityId: target.id, ip: ctx.ip }, tx);
      return {
        code: display,
        expiresAt: expiresAt.toISOString(),
        userId: target.id,
        identifier: target.phone ?? target.email ?? '',
        displayName: await this.displayName(tx, target),
      };
    });
  }

  async setStatus(actor: Actor, targetId: string, status: 'ACTIVE' | 'SUSPENDED', ctx: Ctx): Promise<void> {
    const target = await this.assertCanManage(actor, targetId);
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.UserUpdateInput =
        status === 'SUSPENDED'
          ? { status: 'SUSPENDED', authEpoch: { increment: 1 } }
          : { status: target.passwordHash ? 'ACTIVE' : 'INVITED' };
      await tx.user.update({ where: { id: target.id }, data });
      if (status === 'SUSPENDED') await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId: actor.id, action: `user.${status.toLowerCase()}`, entity: 'User', entityId: target.id, before: { status: target.status }, after: { status }, ip: ctx.ip }, tx);
    });
  }

  /** Hourly housekeeping: expired or long-dead rows serve no purpose. */
  async purgeExpired(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * DAY);
    await this.prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] } });
    await this.prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] } });
    await this.prisma.activationCode.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
  }
}
