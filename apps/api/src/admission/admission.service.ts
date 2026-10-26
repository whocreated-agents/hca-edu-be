import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPLICATION_LINK_TTL_DAYS,
  type ApplicationDetail,
  type ApplicationForm,
  type ApplicationListItem,
  type ApplicationView,
  type DocumentKind,
  type EnquiryDto,
  type EnquiryReceipt,
  type EnquiryRequest,
  type EnquiryState,
  type GuardianInput,
  type InviteResult,
  type Page,
} from '@hca/contracts';
import { ApplicationStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthService, type Actor } from '../auth/auth.service';
import { CryptoService } from '../auth/crypto.service';
import { dateOnly, decodeCursor, encodeCursor, toDate } from '../common/format';
import { Problem } from '../common/problem';
import { MailerService } from '../mail/mailer.service';
import { PrismaService, type Db } from '../prisma.service';
import { StorageService } from '../storage/storage.service';
import { StudentsService } from '../students/students.service';

const DOC_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
const DOC_MAX_BYTES = 2 * 1024 * 1024;
const MS_DAY = 86_400_000;

const applicationLinkInvalid = () => new Problem({ status: 404, code: 'APPLICATION_LINK_INVALID', detail: 'This link is invalid, expired or revoked' });

type AddressJson = { line1: string; line2?: string; city: string; state: string; pin: string };
type ParentBlockJson = { fullName: string; occupation?: string; phone: string; email?: string };
type ParentDetailsJson = { father: ParentBlockJson; mother?: ParentBlockJson; guardian?: ParentBlockJson };

const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class AdmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly crypto: CryptoService,
    private readonly mail: MailerService,
    private readonly storage: StorageService,
    private readonly students: StudentsService,
  ) {}

  // =========================================================================================
  // Public (anonymous) surface
  // =========================================================================================

  async createEnquiry(body: EnquiryRequest): Promise<EnquiryReceipt> {
    // Honeypot: a real browser leaves `website` empty. A filled value is accepted silently and
    // discarded -- the caller must not be able to tell a honeypot hit from a real submission.
    if (body.website) return { reference: `ENQ-${Buffer.from(String(Date.now())).toString('base64url').slice(0, 8).toUpperCase()}` };

    const session = await this.prisma.academicSession.findFirst({ where: { isAdmissionOpen: true } });
    if (!session) throw Problem.conflict('Admissions are not open right now', 'NO_ADMISSION_SESSION_OPEN');

    const row = await this.prisma.enquiry.create({
      data: { childName: body.childName, classLevelId: body.classLevelId, parentName: body.parentName, phone: body.phone, email: body.email ?? null, locality: body.locality, sessionId: session.id },
    });
    return { reference: `ENQ-${row.id.slice(0, 8).toUpperCase()}` };
  }

  private async resolveToken(rawToken: string, db: Db = this.prisma) {
    const hash = this.crypto.tokenHash(rawToken);
    const token = await db.applicationAccessToken.findUnique({ where: { tokenHash: hash }, include: { enquiry: { include: { classLevel: true, session: true, application: { include: { documents: true } } } } } });
    if (!token || token.revokedAt || token.expiresAt <= new Date()) throw applicationLinkInvalid();
    return token;
  }

  private formFromApplication(app: { childDob: Date; gender: 'MALE' | 'FEMALE' | 'OTHER'; address: Prisma.JsonValue; parentDetails: Prisma.JsonValue; previousSchool: Prisma.JsonValue; siblings: Prisma.JsonValue; emergencyContact: Prisma.JsonValue }): NonNullable<ApplicationView['form']> {
    const address = app.address as unknown as AddressJson;
    const parents = app.parentDetails as unknown as ParentDetailsJson;
    return {
      childDob: dateOnly(app.childDob),
      gender: app.gender,
      address,
      father: parents.father,
      mother: parents.mother,
      guardian: parents.guardian,
      previousSchool: (app.previousSchool as ApplicationForm['previousSchool']) ?? undefined,
      siblings: (app.siblings as ApplicationForm['siblings']) ?? [],
      emergencyContact: app.emergencyContact as ApplicationForm['emergencyContact'],
    };
  }

  async getApplication(rawToken: string): Promise<ApplicationView> {
    const token = await this.resolveToken(rawToken);
    const enquiry = token.enquiry;
    const app = enquiry.application;
    return {
      applicationNo: app?.applicationNo ?? null,
      status: app?.status ?? null,
      enquiry: { childName: enquiry.childName, className: enquiry.classLevel.name, parentName: enquiry.parentName, sessionLabel: enquiry.session.label },
      form: app ? this.formFromApplication(app) : null,
      documents: app ? app.documents.map((d) => ({ id: d.id, kind: d.kind, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt.toISOString() })) : [],
      editable: !app || app.status === 'SUBMITTED',
      linkExpiresAt: token.expiresAt.toISOString(),
    };
  }

  async submitApplication(rawToken: string, body: NonNullable<ApplicationView['form']>): Promise<ApplicationView> {
    const token = await this.resolveToken(rawToken);
    const enquiry = token.enquiry;
    const existing = enquiry.application;
    if (existing && existing.status !== 'SUBMITTED') throw Problem.conflict('This application has already been reviewed', 'APPLICATION_LOCKED');

    const data = {
      childDob: toDate(body.childDob),
      gender: body.gender,
      address: body.address as unknown as Prisma.InputJsonValue,
      parentDetails: { father: body.father, mother: body.mother, guardian: body.guardian } as unknown as Prisma.InputJsonValue,
      previousSchool: (body.previousSchool ?? null) as unknown as Prisma.InputJsonValue,
      siblings: (body.siblings ?? []) as unknown as Prisma.InputJsonValue,
      emergencyContact: body.emergencyContact as unknown as Prisma.InputJsonValue,
    };
    const app = existing
      ? await this.prisma.application.update({ where: { id: existing.id }, data, include: { documents: true } })
      : await this.prisma.application.create({ data: { ...data, enquiryId: enquiry.id, applicationNo: `APP-${enquiry.id.slice(0, 8).toUpperCase()}` }, include: { documents: true } });

    return {
      applicationNo: app.applicationNo,
      status: app.status,
      enquiry: { childName: enquiry.childName, className: enquiry.classLevel.name, parentName: enquiry.parentName, sessionLabel: enquiry.session.label },
      form: this.formFromApplication(app),
      documents: app.documents.map((d) => ({ id: d.id, kind: d.kind, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt.toISOString() })),
      editable: app.status === 'SUBMITTED',
      linkExpiresAt: token.expiresAt.toISOString(),
    };
  }

  private async applicationForToken(rawToken: string) {
    const token = await this.resolveToken(rawToken);
    const app = token.enquiry.application;
    if (!app) throw new Problem({ status: 400, code: 'VALIDATION_FAILED', detail: 'Submit the application form before uploading documents' });
    if (app.status !== 'SUBMITTED') throw Problem.conflict('This application can no longer be edited', 'APPLICATION_LOCKED');
    return app;
  }

  async uploadApplicationDocument(rawToken: string, kind: DocumentKind, file: { buffer: Buffer }) {
    const app = await this.applicationForToken(rawToken);
    if (file.buffer.length > DOC_MAX_BYTES) throw new Problem({ status: 413, code: 'FILE_TOO_LARGE', detail: 'File must be at most 2 MB' });
    const sniffed = await this.storage.sniff(file.buffer);
    if (!sniffed || !(DOC_MIME_TYPES as readonly string[]).includes(sniffed.mime)) {
      throw new Problem({ status: 415, code: 'FILE_TYPE_NOT_ALLOWED', detail: 'Only JPEG, PNG or PDF files are accepted' });
    }
    const { fileKey, mimeType, sizeBytes } = await this.storage.put(file.buffer, { prefix: `applications/${app.id}`, mimeType: sniffed.mime, ext: sniffed.ext });
    const row = await this.prisma.applicationDocument.create({ data: { applicationId: app.id, kind, fileKey, mimeType, sizeBytes } });
    return { id: row.id, kind: row.kind, mimeType: row.mimeType, sizeBytes: row.sizeBytes, uploadedAt: row.uploadedAt.toISOString() };
  }

  async deleteApplicationDocument(rawToken: string, docId: string): Promise<void> {
    const app = await this.applicationForToken(rawToken);
    const doc = await this.prisma.applicationDocument.findUnique({ where: { id: docId } });
    if (!doc || doc.applicationId !== app.id) throw Problem.notFound();
    await this.storage.delete(doc.fileKey);
    await this.prisma.applicationDocument.delete({ where: { id: docId } });
  }

  // =========================================================================================
  // Admin pipeline
  // =========================================================================================

  async enquiries(q: { limit: number; cursor?: string; state?: EnquiryState; sessionId?: string; q?: string }): Promise<Page<EnquiryDto>> {
    const offset = decodeCursor(q.cursor);
    const where: Prisma.EnquiryWhereInput = {
      ...(q.state ? { state: q.state } : {}),
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(q.q ? { OR: [{ childName: { contains: q.q, mode: 'insensitive' } }, { parentName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } : {}),
    };
    const rows = await this.prisma.enquiry.findMany({ where, include: { classLevel: true, session: true, application: true }, orderBy: { createdAt: 'desc' }, skip: offset, take: q.limit + 1 });
    const items: EnquiryDto[] = rows.slice(0, q.limit).map((e) => ({
      id: e.id,
      reference: `ENQ-${e.id.slice(0, 8).toUpperCase()}`,
      childName: e.childName,
      classLevelId: e.classLevelId,
      className: e.classLevel.name,
      parentName: e.parentName,
      phone: e.phone,
      email: e.email,
      locality: e.locality,
      sessionId: e.sessionId,
      sessionLabel: e.session.label,
      state: e.state,
      applicationId: e.application?.id ?? null,
      createdAt: e.createdAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }

  async updateEnquiry(actor: Actor, id: string, state: EnquiryState, ip: string | null): Promise<EnquiryDto> {
    const existing = await this.prisma.enquiry.findUnique({ where: { id }, include: { classLevel: true, session: true, application: true } });
    if (!existing) throw Problem.notFound();
    const row = await this.prisma.enquiry.update({ where: { id }, data: { state }, include: { classLevel: true, session: true, application: true } });
    await this.audit.record({ actorId: actor.id, action: 'enquiry.update', entity: 'Enquiry', entityId: id, before: { state: existing.state }, after: { state }, ip });
    return {
      id: row.id,
      reference: `ENQ-${row.id.slice(0, 8).toUpperCase()}`,
      childName: row.childName,
      classLevelId: row.classLevelId,
      className: row.classLevel.name,
      parentName: row.parentName,
      phone: row.phone,
      email: row.email,
      locality: row.locality,
      sessionId: row.sessionId,
      sessionLabel: row.session.label,
      state: row.state,
      applicationId: row.application?.id ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async invite(actor: Actor, id: string, ip: string | null): Promise<InviteResult> {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id } });
    if (!enquiry) throw Problem.notFound();
    const { token, hash } = this.crypto.newToken();
    const expiresAt = new Date(Date.now() + APPLICATION_LINK_TTL_DAYS * MS_DAY);
    await this.prisma.$transaction([
      this.prisma.applicationAccessToken.updateMany({ where: { enquiryId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.applicationAccessToken.create({ data: { enquiryId: id, tokenHash: hash, expiresAt } }),
      this.prisma.enquiry.update({ where: { id }, data: { state: 'INVITED_TO_APPLY' } }),
    ]);
    await this.audit.record({ actorId: actor.id, action: 'enquiry.invite', entity: 'Enquiry', entityId: id, ip });
    const link = `/apply#token=${token}`;
    let emailed = false;
    if (enquiry.email) {
      void this.mail.send({ to: enquiry.email, subject: 'Your HCA admission application link', text: `Complete the application for ${enquiry.childName} here (valid ${APPLICATION_LINK_TTL_DAYS} days):\n\n${link}` });
      emailed = true;
    }
    return { link, expiresAt: expiresAt.toISOString(), emailed };
  }

  private applicationWhere(q: { status?: string; sessionId?: string; classLevelId?: string; q?: string; from?: string; to?: string }): Prisma.ApplicationWhereInput {
    return {
      ...(q.status ? { status: q.status as ApplicationStatus } : {}),
      ...(q.from ? { createdAt: { gte: toDate(q.from) } } : {}),
      ...(q.to ? { createdAt: { ...(q.from ? { gte: toDate(q.from) } : {}), lte: new Date(toDate(q.to).getTime() + MS_DAY) } } : {}),
      enquiry: {
        ...(q.sessionId ? { sessionId: q.sessionId } : {}),
        ...(q.classLevelId ? { classLevelId: q.classLevelId } : {}),
        ...(q.q ? { OR: [{ childName: { contains: q.q, mode: 'insensitive' as const } }, { parentName: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
      },
    };
  }

  private readonly applicationListInclude = { enquiry: { include: { classLevel: true, session: true } } } satisfies Prisma.ApplicationInclude;

  async applications(q: { limit: number; cursor?: string; status?: string; sessionId?: string; classLevelId?: string; q?: string; from?: string; to?: string }): Promise<Page<ApplicationListItem>> {
    const offset = decodeCursor(q.cursor);
    const rows = await this.prisma.application.findMany({ where: this.applicationWhere(q), include: this.applicationListInclude, orderBy: { createdAt: 'desc' }, skip: offset, take: q.limit + 1 });
    const items = rows.slice(0, q.limit).map((a) => this.toListItem(a));
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }

  private toListItem(a: Prisma.ApplicationGetPayload<{ include: { enquiry: { include: { classLevel: true; session: true } } } }>): ApplicationListItem {
    return {
      id: a.id,
      applicationNo: a.applicationNo,
      status: a.status,
      childName: a.enquiry.childName,
      className: a.enquiry.classLevel.name,
      parentName: a.enquiry.parentName,
      phone: a.enquiry.phone,
      sessionLabel: a.enquiry.session.label,
      createdAt: a.createdAt.toISOString(),
      decidedAt: a.decidedAt?.toISOString() ?? null,
    };
  }

  async exportApplications(q: { status?: string; sessionId?: string; classLevelId?: string; q?: string; from?: string; to?: string }): Promise<string> {
    const rows = await this.prisma.application.findMany({ where: this.applicationWhere(q), include: this.applicationListInclude, orderBy: { createdAt: 'desc' } });
    const header = ['Application No', 'Status', 'Child', 'Class', 'Parent', 'Phone', 'Session', 'Created', 'Decided'];
    const defuse = (v: string): string => (/^[=+\-@]/.test(v) ? `'${v}` : v);
    const csvCell = (v: string): string => {
      const safe = defuse(v);
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [header.map(csvCell).join(',')];
    for (const a of rows) {
      const item = this.toListItem(a);
      lines.push([item.applicationNo, item.status, item.childName, item.className, item.parentName, item.phone, item.sessionLabel, item.createdAt, item.decidedAt ?? ''].map((v) => csvCell(String(v))).join(','));
    }
    // eslint-disable-next-line no-irregular-whitespace -- UTF-8 BOM, required for Excel to detect the encoding
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  async application(id: string): Promise<ApplicationDetail> {
    const a = await this.prisma.application.findUnique({
      where: { id },
      include: { enquiry: { include: { classLevel: true, session: true } }, documents: true, decidedBy: { include: { staff: true } }, student: true },
    });
    if (!a) throw Problem.notFound();
    return {
      ...this.toListItem(a),
      enquiryId: a.enquiryId,
      form: this.formFromApplication(a),
      documents: a.documents.map((d) => ({ id: d.id, kind: d.kind, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt.toISOString(), url: this.storage.signUrl(d.fileKey, d.mimeType).url })),
      decisionNote: a.decisionNote,
      decidedBy: a.decidedBy ? { id: a.decidedBy.id, displayName: a.decidedBy.staff?.fullName ?? a.decidedBy.email ?? 'Administrator' } : null,
      studentId: a.student?.id ?? null,
    };
  }

  private static readonly TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
    SUBMITTED: ['REVIEWED'],
    REVIEWED: ['SUBMITTED', 'APPROVED', 'REJECTED'],
    APPROVED: [],
    REJECTED: [],
  };

  async setApplicationStatus(actor: Actor, id: string, status: ApplicationStatus, note: string | undefined, ip: string | null): Promise<ApplicationDetail> {
    const existing = await this.prisma.application.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    if (!AdmissionService.TRANSITIONS[existing.status].includes(status)) {
      throw Problem.conflict(`Cannot move an application from ${existing.status} to ${status}`);
    }
    const isDecision = status === 'APPROVED' || status === 'REJECTED';
    await this.prisma.application.update({
      where: { id },
      data: isDecision
        ? { status, decidedAt: new Date(), decidedById: actor.id, decisionNote: note ?? null }
        : { status, decidedAt: null, decidedById: null, decisionNote: null },
    });
    await this.audit.record({ actorId: actor.id, action: 'application.status', entity: 'Application', entityId: id, before: { status: existing.status }, after: { status, note }, ip });
    return this.application(id);
  }

  async createStudentFromApplication(actor: Actor, id: string, body: { admissionNo: string; enrollment?: { sectionId: string; rollNo: number }; guardians?: GuardianInput[] }, ip: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.application.findUnique({ where: { id }, include: { enquiry: true, student: true } });
      if (!app) throw Problem.notFound();
      if (app.status !== 'APPROVED') throw Problem.conflict('Only an approved application can be turned into a student');
      if (app.student) throw Problem.conflict('A student already exists for this application');

      const parents = app.parentDetails as unknown as ParentDetailsJson;
      const defaultGuardians: GuardianInput[] = [
        { fullName: parents.father.fullName, relation: 'Father', phone: parents.father.phone, email: parents.father.email, occupation: parents.father.occupation, isPrimary: true, createLogin: true },
        ...(parents.mother ? [{ fullName: parents.mother.fullName, relation: 'Mother', phone: parents.mother.phone, email: parents.mother.email, occupation: parents.mother.occupation, isPrimary: false, createLogin: true }] : []),
        ...(parents.guardian ? [{ fullName: parents.guardian.fullName, relation: 'Guardian', phone: parents.guardian.phone, email: parents.guardian.email, occupation: parents.guardian.occupation, isPrimary: false, createLogin: true }] : []),
      ];

      try {
        const result = await this.students.createStudentCore(
          actor,
          {
            admissionNo: body.admissionNo,
            fullName: app.enquiry.childName,
            dob: dateOnly(app.childDob),
            gender: app.gender,
            applicationId: id,
            enrollment: body.enrollment,
            guardians: body.guardians ?? defaultGuardians,
          },
          ip,
          tx,
        );
        await this.audit.record({ actorId: actor.id, action: 'application.create_student', entity: 'Application', entityId: id, after: { studentId: result.student.id }, ip }, tx);
        return result;
      } catch (e) {
        if (isUniqueViolation(e)) throw Problem.conflict('That admission number is already in use, or a student already exists for this application');
        throw e;
      }
    });
  }
}
