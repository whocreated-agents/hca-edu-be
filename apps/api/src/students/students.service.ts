import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DOCUMENT_MAX_BYTES, type EnrollInput, type EnrollmentUpdate, type GuardianInput, type GuardianLinked, type GuardianUpdate, type PromoteInput, type PromoteResult, type SensitiveDto, type SensitiveUpsert, type StudentCreate, type StudentCreated, type StudentDetail, type StudentDto, type StudentUpdate } from '@hca/contracts';
import type { Page } from '@hca/contracts';
import { AuditService } from '../audit/audit.service';
import { AuthService, type Actor } from '../auth/auth.service';
import { FieldCipherService } from '../common/field-cipher.service';
import { decodeCursor, encodeCursor, toDate } from '../common/format';
import { enrollmentInclude, studentWithCurrent, toEnrollmentDto, toGuardianDto, toStudentDto } from '../common/mappers';
import { Problem } from '../common/problem';
import { PrismaService, type Db } from '../prisma.service';
import { StorageService } from '../storage/storage.service';

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const extForMime = (mime: string): string => (mime === 'image/png' ? 'png' : 'jpg');
const mimeForPhotoKey = (key: string): string => (key.endsWith('.png') ? 'image/png' : 'image/jpeg');

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly cipher: FieldCipherService,
    private readonly storage: StorageService,
  ) {}

  private signPhoto = (photoKey: string): string => this.storage.signUrl(photoKey, mimeForPhotoKey(photoKey)).url;

  // ---- list / detail / update -----------------------------------------------------------------

  async list(q: { limit: number; cursor?: string; q?: string; sessionId?: string; classLevelId?: string; sectionId?: string; status?: string }): Promise<Page<StudentDto>> {
    const offset = decodeCursor(q.cursor);
    const where: Prisma.StudentWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { admissionNo: { contains: q.q, mode: 'insensitive' } }] } : {}),
      ...(q.sessionId || q.classLevelId || q.sectionId
        ? {
            enrollments: {
              some: {
                ...(q.sessionId ? { sessionId: q.sessionId } : {}),
                ...(q.sectionId ? { sectionId: q.sectionId } : {}),
                ...(q.classLevelId ? { section: { classLevelId: q.classLevelId } } : {}),
              },
            },
          }
        : {}),
    };
    const rows = await this.prisma.student.findMany({ where, ...studentWithCurrent, orderBy: { fullName: 'asc' }, skip: offset, take: q.limit + 1 });
    const items = rows.slice(0, q.limit).map((s) => toStudentDto(s, this.signPhoto));
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }

  async detail(id: string): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({ where: { id }, ...studentWithCurrent });
    if (!student) throw Problem.notFound();
    const [links, enrollments, sensitive] = await Promise.all([
      this.prisma.studentGuardian.findMany({ where: { studentId: id }, include: { guardian: { include: { user: true } } } }),
      this.prisma.enrollment.findMany({ where: { studentId: id }, include: enrollmentInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.studentSensitive.findUnique({ where: { studentId: id }, select: { id: true } }),
    ]);
    return {
      student: toStudentDto(student, this.signPhoto),
      guardians: links.map((l) => toGuardianDto(l.guardian, l.guardian.user, l.isPrimary)),
      enrollments: enrollments.map(toEnrollmentDto),
      hasSensitiveRecord: sensitive !== null,
    };
  }

  async update(actor: Actor, id: string, body: StudentUpdate, ip: string | null): Promise<StudentDto> {
    const existing = await this.prisma.student.findUnique({ where: { id }, ...studentWithCurrent });
    if (!existing) throw Problem.notFound();
    try {
      const row = await this.prisma.student.update({
        where: { id },
        data: {
          ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
          ...(body.dob !== undefined ? { dob: toDate(body.dob) } : {}),
          ...(body.gender !== undefined ? { gender: body.gender } : {}),
          ...(body.bloodGroup !== undefined ? { bloodGroup: body.bloodGroup } : {}),
          ...(body.admissionNo !== undefined ? { admissionNo: body.admissionNo } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
        ...studentWithCurrent,
      });
      await this.audit.record({ actorId: actor.id, action: 'student.update', entity: 'Student', entityId: id, before: toStudentDto(existing), after: toStudentDto(row), ip });
      return toStudentDto(row, this.signPhoto);
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('That admission number is already in use');
      throw e;
    }
  }

  async uploadPhoto(actor: Actor, id: string, file: { buffer: Buffer }, ip: string | null): Promise<StudentDto> {
    const existing = await this.prisma.student.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    if (file.buffer.length > DOCUMENT_MAX_BYTES) throw new Problem({ status: 413, code: 'FILE_TOO_LARGE', detail: 'Photo must be at most 2 MB' });
    const sniffed = await this.storage.sniff(file.buffer);
    if (!sniffed || !(PHOTO_MIME_TYPES as readonly string[]).includes(sniffed.mime)) {
      throw new Problem({ status: 415, code: 'FILE_TYPE_NOT_ALLOWED', detail: 'Only JPEG or PNG images are accepted' });
    }
    const { fileKey } = await this.storage.put(file.buffer, { prefix: `students/${id}`, mimeType: sniffed.mime, ext: extForMime(sniffed.mime) });
    const oldKey = existing.photoKey;
    const row = await this.prisma.student.update({ where: { id }, data: { photoKey: fileKey }, ...studentWithCurrent });
    if (oldKey) await this.storage.delete(oldKey);
    await this.audit.record({ actorId: actor.id, action: 'student.photo', entity: 'Student', entityId: id, ip });
    return toStudentDto(row, this.signPhoto);
  }

  // ---- create (also used by the admission handoff) --------------------------------------------

  async createStudentCore(
    actor: Actor,
    input: { admissionNo: string; fullName: string; dob: string; gender: 'MALE' | 'FEMALE' | 'OTHER'; bloodGroup?: string | null; applicationId?: string; enrollment?: EnrollInput; guardians?: GuardianInput[] },
    ip: string | null,
    db: Db = this.prisma,
  ): Promise<StudentCreated> {
    return this.runCreate(actor, input, ip, db);
  }

  async create(actor: Actor, body: StudentCreate, ip: string | null): Promise<StudentCreated> {
    return this.prisma.$transaction((tx) => this.runCreate(actor, body, ip, tx));
  }

  private async runCreate(
    actor: Actor,
    input: { admissionNo: string; fullName: string; dob: string; gender: 'MALE' | 'FEMALE' | 'OTHER'; bloodGroup?: string | null; applicationId?: string; enrollment?: EnrollInput; guardians?: GuardianInput[] },
    ip: string | null,
    db: Db,
  ): Promise<StudentCreated> {
    let student;
    try {
      student = await db.student.create({
        data: {
          admissionNo: input.admissionNo,
          fullName: input.fullName,
          dob: toDate(input.dob),
          gender: input.gender,
          bloodGroup: input.bloodGroup ?? null,
          applicationId: input.applicationId ?? null,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('That admission number (or application) is already in use');
      throw e;
    }

    if (input.enrollment) await this.createEnrollment(db, student.id, input.enrollment, undefined);

    const guardians: GuardianLinked[] = [];
    for (const g of input.guardians ?? []) guardians.push(await this.provisionGuardian(db, student.id, g, actor.id));

    const full = await db.student.findUniqueOrThrow({ where: { id: student.id }, ...studentWithCurrent });
    await this.audit.record({ actorId: actor.id, action: 'student.create', entity: 'Student', entityId: student.id, after: { admissionNo: input.admissionNo, fullName: input.fullName }, ip }, db);
    return { student: toStudentDto(full, this.signPhoto), guardians };
  }

  // ---- enrolment ----------------------------------------------------------------------------

  private async createEnrollment(db: Db, studentId: string, body: EnrollInput, explicitSessionId: string | undefined) {
    const section = await db.section.findUnique({ where: { id: body.sectionId } });
    if (!section) throw Problem.notFound('No such section');
    if (explicitSessionId && explicitSessionId !== section.sessionId) {
      throw new Problem({ status: 400, code: 'VALIDATION_FAILED', detail: 'sessionId does not match the section' });
    }
    const session = await db.academicSession.findUnique({ where: { id: section.sessionId } });
    if (!session || session.state === 'CLOSED') throw Problem.conflict('Cannot enrol into a closed session', 'SESSION_STATE_INVALID');
    try {
      return await db.enrollment.create({ data: { studentId, sectionId: body.sectionId, sessionId: section.sessionId, rollNo: body.rollNo }, include: enrollmentInclude });
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('Already enrolled this session, or that roll number is taken');
      throw e;
    }
  }

  async enroll(actor: Actor, studentId: string, body: EnrollInput & { sessionId?: string }, ip: string | null) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw Problem.notFound();
    const row = await this.createEnrollment(this.prisma, studentId, body, body.sessionId);
    await this.audit.record({ actorId: actor.id, action: 'enrollment.create', entity: 'Enrollment', entityId: row.id, ip });
    return toEnrollmentDto(row);
  }

  async updateEnrollment(actor: Actor, id: string, body: EnrollmentUpdate, ip: string | null) {
    const existing = await this.prisma.enrollment.findUnique({ where: { id }, include: enrollmentInclude });
    if (!existing) throw Problem.notFound();
    try {
      const row = await this.prisma.enrollment.update({
        where: { id },
        data: { ...(body.sectionId !== undefined ? { sectionId: body.sectionId } : {}), ...(body.rollNo !== undefined ? { rollNo: body.rollNo } : {}), ...(body.state !== undefined ? { state: body.state } : {}) },
        include: enrollmentInclude,
      });
      await this.audit.record({ actorId: actor.id, action: 'enrollment.update', entity: 'Enrollment', entityId: id, before: toEnrollmentDto(existing), after: toEnrollmentDto(row), ip });
      return toEnrollmentDto(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('That roll number is already taken in the destination section');
      throw e;
    }
  }

  /** Year rollover. Idempotent: a student already enrolled in `toSessionId` is skipped, not duplicated. */
  async promote(actor: Actor, body: PromoteInput, ip: string | null): Promise<PromoteResult> {
    return this.prisma.$transaction(async (tx) => {
      let enrolled = 0;
      let skippedAlreadyEnrolled = 0;
      for (const mapping of body.mappings) {
        const toSection = await tx.section.findUnique({ where: { id: mapping.toSectionId } });
        if (!toSection || toSection.sessionId !== body.toSessionId) throw Problem.notFound('No such destination section in that session');
        const source = await tx.enrollment.findMany({ where: { sectionId: mapping.fromSectionId, state: 'ACTIVE' }, orderBy: { rollNo: 'asc' } });
        let nextRoll = (await tx.enrollment.aggregate({ where: { sectionId: mapping.toSectionId }, _max: { rollNo: true } }))._max.rollNo ?? 0;
        for (const e of source) {
          const already = await tx.enrollment.findUnique({ where: { studentId_sessionId: { studentId: e.studentId, sessionId: body.toSessionId } } });
          if (already) {
            skippedAlreadyEnrolled += 1;
            continue;
          }
          nextRoll += 1;
          await tx.enrollment.create({ data: { studentId: e.studentId, sectionId: mapping.toSectionId, sessionId: body.toSessionId, rollNo: nextRoll } });
          enrolled += 1;
        }
      }
      await this.audit.record({ actorId: actor.id, action: 'enrollment.promote', entity: 'AcademicSession', entityId: body.toSessionId, after: { enrolled, skippedAlreadyEnrolled }, ip }, tx);
      return { enrolled, skippedAlreadyEnrolled };
    });
  }

  // ---- guardians ----------------------------------------------------------------------------

  /** Create-or-link a guardian for `studentId`, per the GuardianInput union (see admin-students.ts). */
  async provisionGuardian(db: Db, studentId: string, input: GuardianInput, issuerId: string): Promise<GuardianLinked> {
    if ('guardianId' in input) {
      const guardian = await db.guardian.findUnique({ where: { id: input.guardianId }, include: { user: true } });
      if (!guardian) throw Problem.notFound('No such guardian');
      try {
        await db.studentGuardian.create({ data: { studentId, guardianId: guardian.id, isPrimary: input.isPrimary ?? false } });
      } catch (e) {
        if (isUniqueViolation(e)) throw Problem.conflict('That guardian is already linked to this student');
        throw e;
      }
      return { guardian: toGuardianDto(guardian, guardian.user, input.isPrimary ?? false), activation: null };
    }

    // Create branch: a Guardian row with (optionally) a provisioned/reused PARENT login.
    let userId: string | null = null;
    let activation: GuardianLinked['activation'] = null;
    if (input.createLogin ?? true) {
      const existingUser = await db.user.findUnique({ where: { phone: input.phone } });
      if (existingUser) {
        const existingGuardian = await db.guardian.findUnique({ where: { userId: existingUser.id }, include: { user: true } });
        if (existingGuardian) {
          // Same person already has a Guardian row and a login: reuse it rather than duplicate (Guardian.userId is unique).
          try {
            await db.studentGuardian.create({ data: { studentId, guardianId: existingGuardian.id, isPrimary: input.isPrimary ?? false } });
          } catch (e) {
            if (isUniqueViolation(e)) throw Problem.conflict('That guardian is already linked to this student');
            throw e;
          }
          return { guardian: toGuardianDto(existingGuardian, existingGuardian.user, input.isPrimary ?? false), activation: null };
        }
        userId = existingUser.id;
      } else {
        let user;
        try {
          user = await db.user.create({ data: { role: 'PARENT', status: 'INVITED', phone: input.phone } });
        } catch (e) {
          if (isUniqueViolation(e)) throw Problem.conflict('A user with that phone number already exists');
          throw e;
        }
        const { display, expiresAt } = await this.auth.createActivationCode(db, user.id, issuerId);
        activation = { code: display, expiresAt: expiresAt.toISOString(), userId: user.id, identifier: input.phone, displayName: input.fullName };
        userId = user.id;
      }
    }

    const guardian = await db.guardian.create({
      data: { fullName: input.fullName, relation: input.relation, phone: input.phone, email: input.email ?? null, occupation: input.occupation ?? null, userId },
      include: { user: true },
    });
    await db.studentGuardian.create({ data: { studentId, guardianId: guardian.id, isPrimary: input.isPrimary ?? false } });
    return { guardian: toGuardianDto(guardian, guardian.user, input.isPrimary ?? false), activation };
  }

  async linkGuardian(actor: Actor, studentId: string, input: GuardianInput, ip: string | null): Promise<GuardianLinked> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw Problem.notFound();
    const result = await this.prisma.$transaction((tx) => this.provisionGuardian(tx, studentId, input, actor.id));
    await this.audit.record({ actorId: actor.id, action: 'guardian.link', entity: 'Student', entityId: studentId, after: { guardianId: result.guardian.id }, ip });
    return result;
  }

  async unlinkGuardian(actor: Actor, studentId: string, guardianId: string, ip: string | null): Promise<void> {
    const link = await this.prisma.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId } } });
    if (!link) throw Problem.notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.studentGuardian.delete({ where: { id: link.id } });
      const guardian = await tx.guardian.findUnique({ where: { id: guardianId } });
      const remaining = await tx.studentGuardian.count({ where: { guardianId } });
      if (guardian?.userId && remaining === 0) {
        await this.auth.setStatus(actor, guardian.userId, 'SUSPENDED', { ip, userAgent: null });
      }
      await this.audit.record({ actorId: actor.id, action: 'guardian.unlink', entity: 'Student', entityId: studentId, before: { guardianId }, ip }, tx);
    });
  }

  async updateGuardian(actor: Actor, id: string, body: GuardianUpdate, ip: string | null) {
    const existing = await this.prisma.guardian.findUnique({ where: { id }, include: { user: true } });
    if (!existing) throw Problem.notFound();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.guardian.update({
        where: { id },
        data: {
          ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
          ...(body.relation !== undefined ? { relation: body.relation } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.occupation !== undefined ? { occupation: body.occupation } : {}),
        },
        include: { user: true },
      });
      // Office-entered email is stamped verified immediately on the linked login (User model comment).
      if (body.email !== undefined && existing.userId) {
        await tx.user.update({ where: { id: existing.userId }, data: { email: body.email, emailVerifiedAt: body.email ? new Date() : null } });
      }
      return updated;
    });
    await this.audit.record({ actorId: actor.id, action: 'guardian.update', entity: 'Guardian', entityId: id, before: toGuardianDto(existing, existing.user, false), after: toGuardianDto(row, row.user, false), ip });
    return toGuardianDto(row, row.user, false);
  }

  // ---- sensitive tier -------------------------------------------------------------------------

  private async consentByDisplayName(db: Db, userId: string): Promise<string> {
    const staff = await db.staff.findUnique({ where: { userId }, select: { fullName: true } });
    if (staff) return staff.fullName;
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    return user?.email ?? 'Administrator';
  }

  async getSensitive(actor: Actor, studentId: string, ip: string | null): Promise<SensitiveDto> {
    const row = await this.prisma.studentSensitive.findUnique({ where: { studentId } });
    if (!row) throw Problem.notFound();
    await this.audit.record({ actorId: actor.id, action: 'sensitive.read', entity: 'StudentSensitive', entityId: row.id, ip });
    return {
      studentId,
      aadhaar: row.aadhaarEnc ? this.cipher.decrypt(Buffer.from(row.aadhaarEnc)) : null,
      category: row.category,
      medicalNotes: row.medicalNotesEnc ? this.cipher.decrypt(Buffer.from(row.medicalNotesEnc)) : null,
      consentRecordedAt: row.consentRecordedAt.toISOString(),
      consentBy: { id: row.consentById, displayName: await this.consentByDisplayName(this.prisma, row.consentById) },
    };
  }

  async putSensitive(actor: Actor, studentId: string, body: SensitiveUpsert, ip: string | null): Promise<SensitiveDto> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw Problem.notFound();
    const changedFields = Object.keys(body).filter((k) => k !== 'consentConfirmed');
    const row = await this.prisma.studentSensitive.upsert({
      where: { studentId },
      create: {
        studentId,
        aadhaarEnc: body.aadhaar !== undefined && body.aadhaar !== null ? Uint8Array.from(this.cipher.encrypt(body.aadhaar)) : null,
        category: body.category ?? null,
        medicalNotesEnc: body.medicalNotes !== undefined && body.medicalNotes !== null ? Uint8Array.from(this.cipher.encrypt(body.medicalNotes)) : null,
        consentRecordedAt: new Date(),
        consentById: actor.id,
      },
      update: {
        ...(body.aadhaar !== undefined ? { aadhaarEnc: body.aadhaar === null ? null : Uint8Array.from(this.cipher.encrypt(body.aadhaar)) } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.medicalNotes !== undefined ? { medicalNotesEnc: body.medicalNotes === null ? null : Uint8Array.from(this.cipher.encrypt(body.medicalNotes)) } : {}),
        consentRecordedAt: new Date(),
        consentById: actor.id,
      },
    });
    // Field names only, never values -- the contract's explicit requirement for this audit entry.
    await this.audit.record({ actorId: actor.id, action: 'sensitive.write', entity: 'StudentSensitive', entityId: row.id, after: { fieldsChanged: changedFields }, ip });
    return {
      studentId,
      aadhaar: row.aadhaarEnc ? this.cipher.decrypt(Buffer.from(row.aadhaarEnc)) : null,
      category: row.category,
      medicalNotes: row.medicalNotesEnc ? this.cipher.decrypt(Buffer.from(row.medicalNotesEnc)) : null,
      consentRecordedAt: row.consentRecordedAt.toISOString(),
      consentBy: { id: actor.id, displayName: await this.consentByDisplayName(this.prisma, actor.id) },
    };
  }
}
