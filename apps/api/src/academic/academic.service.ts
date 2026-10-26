import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  HolidayCreate,
  HolidayDto,
  SectionCreate,
  SectionUpdate,
  SessionCreate,
  SessionUpdate,
  StaffCreate,
  StaffCreated,
  StaffUpdate,
  SubjectTeacherAssign,
  SubjectTeacherDto,
} from '@hca/contracts';
import type { ClassLevelDto, Page, SectionDto, SessionDto, StaffDto } from '@hca/contracts';
import { AuditService } from '../audit/audit.service';
import { AuthService, type Actor } from '../auth/auth.service';
import { dateOnly, decodeCursor, encodeCursor, toDate } from '../common/format';
import { sectionInclude, toClassLevelDto, toSectionDto, toSessionDto, toStaffDto } from '../common/mappers';
import { Problem } from '../common/problem';
import { PrismaService, type Db } from '../prisma.service';

const staffInclude = { user: true } satisfies Prisma.StaffInclude;

const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly auth: AuthService) {}

  // ---- sessions -----------------------------------------------------------------------------

  async sessions(): Promise<SessionDto[]> {
    const rows = await this.prisma.academicSession.findMany({ orderBy: { startsOn: 'desc' } });
    return rows.map(toSessionDto);
  }

  async createSession(body: SessionCreate): Promise<SessionDto> {
    if (body.isAdmissionOpen) await this.assertNoOtherOpenIntake(this.prisma, null);
    try {
      const row = await this.prisma.academicSession.create({
        data: { label: body.label, startsOn: toDate(body.startsOn), endsOn: toDate(body.endsOn), isAdmissionOpen: body.isAdmissionOpen ?? false, state: 'UPCOMING' },
      });
      return toSessionDto(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('An open session already exists, or the label is taken', 'SESSION_STATE_INVALID');
      throw e;
    }
  }

  private async assertNoOtherOpenIntake(db: Db, excludeId: string | null): Promise<void> {
    const other = await db.academicSession.findFirst({ where: { isAdmissionOpen: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
    if (other) throw Problem.conflict('Another session already has admissions open; close it first', 'SESSION_STATE_INVALID');
  }

  async updateSession(id: string, body: SessionUpdate): Promise<SessionDto> {
    const existing = await this.prisma.academicSession.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    if (body.isAdmissionOpen) await this.assertNoOtherOpenIntake(this.prisma, id);
    try {
      const row = await this.prisma.academicSession.update({
        where: { id },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.startsOn !== undefined ? { startsOn: toDate(body.startsOn) } : {}),
          ...(body.endsOn !== undefined ? { endsOn: toDate(body.endsOn) } : {}),
          ...(body.isAdmissionOpen !== undefined ? { isAdmissionOpen: body.isAdmissionOpen } : {}),
        },
      });
      return toSessionDto(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('Another session already has admissions open, or the label is taken', 'SESSION_STATE_INVALID');
      throw e;
    }
  }

  async transitionSession(id: string, to: 'RUNNING' | 'CLOSED'): Promise<SessionDto> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.academicSession.findUnique({ where: { id } });
      if (!session) throw Problem.notFound();
      if (session.state === 'CLOSED') throw Problem.conflict('This session is closed; that is terminal', 'SESSION_STATE_INVALID');
      if (to === 'RUNNING') {
        if (session.state !== 'UPCOMING') throw Problem.conflict('Only an upcoming session can start running', 'SESSION_STATE_INVALID');
        const current = await tx.academicSession.findFirst({ where: { state: 'RUNNING', id: { not: id } } });
        if (current) await tx.academicSession.update({ where: { id: current.id }, data: { state: 'CLOSED' } });
        const updated = await tx.academicSession.update({ where: { id }, data: { state: 'RUNNING' } });
        return toSessionDto(updated);
      }
      // to === 'CLOSED'
      if (session.state !== 'RUNNING') throw Problem.conflict('Only a running session can be closed', 'SESSION_STATE_INVALID');
      const updated = await tx.academicSession.update({ where: { id }, data: { state: 'CLOSED' } });
      return toSessionDto(updated);
    });
  }

  // ---- holidays -------------------------------------------------------------------------------

  async holidays(sessionId: string): Promise<HolidayDto[]> {
    const rows = await this.prisma.holiday.findMany({ where: { sessionId }, orderBy: { date: 'asc' } });
    return rows.map((h) => ({ id: h.id, sessionId: h.sessionId, date: dateOnly(h.date), label: h.label }));
  }

  async createHoliday(sessionId: string, body: HolidayCreate): Promise<HolidayDto> {
    const session = await this.prisma.academicSession.findUnique({ where: { id: sessionId } });
    if (!session) throw Problem.notFound();
    const date = toDate(body.date);
    if (date < session.startsOn || date > session.endsOn) throw new Problem({ status: 422, code: 'VALIDATION_FAILED', detail: 'The date must fall inside the session' });
    try {
      const row = await this.prisma.holiday.create({ data: { sessionId, date, label: body.label } });
      return { id: row.id, sessionId: row.sessionId, date: dateOnly(row.date), label: row.label };
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('A holiday already exists on that date');
      throw e;
    }
  }

  async deleteHoliday(id: string): Promise<void> {
    const row = await this.prisma.holiday.findUnique({ where: { id } });
    if (!row) throw Problem.notFound();
    await this.prisma.holiday.delete({ where: { id } });
  }

  // ---- class levels -----------------------------------------------------------------------------

  async classLevels(): Promise<ClassLevelDto[]> {
    const rows = await this.prisma.classLevel.findMany({ orderBy: { order: 'asc' } });
    return rows.map(toClassLevelDto);
  }

  async updateClassLevel(id: string, body: { minAge?: number | null; maxAge?: number | null }): Promise<ClassLevelDto> {
    const existing = await this.prisma.classLevel.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    const row = await this.prisma.classLevel.update({
      where: { id },
      data: { ...(body.minAge !== undefined ? { minAge: body.minAge } : {}), ...(body.maxAge !== undefined ? { maxAge: body.maxAge } : {}) },
    });
    return toClassLevelDto(row);
  }

  // ---- sections -----------------------------------------------------------------------------

  async sections(q: { sessionId?: string; classLevelId?: string }): Promise<SectionDto[]> {
    const sessionId = q.sessionId ?? (await this.prisma.academicSession.findFirst({ where: { state: 'RUNNING' }, select: { id: true } }))?.id;
    if (!sessionId) return [];
    const rows = await this.prisma.section.findMany({
      where: { sessionId, ...(q.classLevelId ? { classLevelId: q.classLevelId } : {}) },
      include: sectionInclude,
      orderBy: [{ classLevel: { order: 'asc' } }, { name: 'asc' }],
    });
    return rows.map(toSectionDto);
  }

  async createSection(body: SectionCreate): Promise<SectionDto> {
    try {
      const row = await this.prisma.section.create({
        data: { sessionId: body.sessionId, classLevelId: body.classLevelId, name: body.name, classTeacherId: body.classTeacherId ?? null },
        include: sectionInclude,
      });
      return toSectionDto(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('A section with that name already exists for this class and session');
      throw e;
    }
  }

  async updateSection(id: string, body: SectionUpdate): Promise<SectionDto> {
    const existing = await this.prisma.section.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    try {
      const row = await this.prisma.section.update({
        where: { id },
        data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.classTeacherId !== undefined ? { classTeacherId: body.classTeacherId } : {}) },
        include: sectionInclude,
      });
      return toSectionDto(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('A section with that name already exists for this class and session');
      throw e;
    }
  }

  async subjectTeachers(sectionId: string): Promise<SubjectTeacherDto[]> {
    const rows = await this.prisma.sectionSubjectTeacher.findMany({ where: { sectionId }, include: { staff: true } });
    return rows.map((r) => ({ id: r.id, staffId: r.staffId, staffName: r.staff.fullName, subject: r.subject }));
  }

  async assignSubjectTeacher(sectionId: string, body: SubjectTeacherAssign): Promise<SubjectTeacherDto> {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId } });
    if (!section) throw Problem.notFound();
    try {
      const row = await this.prisma.sectionSubjectTeacher.create({ data: { sectionId, staffId: body.staffId, subject: body.subject }, include: { staff: true } });
      return { id: row.id, staffId: row.staffId, staffName: row.staff.fullName, subject: row.subject };
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('That teacher is already assigned to that subject in this section');
      throw e;
    }
  }

  async removeSubjectTeacher(id: string): Promise<void> {
    const row = await this.prisma.sectionSubjectTeacher.findUnique({ where: { id } });
    if (!row) throw Problem.notFound();
    await this.prisma.sectionSubjectTeacher.delete({ where: { id } });
  }

  // ---- staff -------------------------------------------------------------------------------

  async staffList(q: { limit: number; cursor?: string; q?: string; isActive?: boolean }): Promise<Page<StaffDto>> {
    const offset = decodeCursor(q.cursor);
    const where: Prisma.StaffWhereInput = {
      ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
      ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { employeeCode: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.staff.findMany({ where, include: staffInclude, orderBy: { fullName: 'asc' }, skip: offset, take: q.limit + 1 });
    const items = rows.slice(0, q.limit).map(toStaffDto);
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }

  async staffOne(id: string): Promise<StaffDto> {
    const row = await this.prisma.staff.findUnique({ where: { id }, include: staffInclude });
    if (!row) throw Problem.notFound();
    return toStaffDto(row);
  }

  async createStaff(actor: Actor, body: StaffCreate, ip: string | null): Promise<StaffCreated> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { role: body.role, status: 'INVITED', email: body.email, emailVerifiedAt: new Date() } });
      let staff;
      try {
        staff = await tx.staff.create({
          data: { userId: user.id, employeeCode: body.employeeCode, fullName: body.fullName, designation: body.designation, phone: body.phone, joinedOn: toDate(body.joinedOn) },
          include: staffInclude,
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw Problem.conflict('That employee code is already in use');
        throw e;
      }
      const { display, expiresAt } = await this.auth.createActivationCode(tx, user.id, actor.id);
      await this.audit.record({ actorId: actor.id, action: 'staff.create', entity: 'Staff', entityId: staff.id, after: { fullName: staff.fullName, role: body.role }, ip }, tx);
      return {
        staff: toStaffDto(staff),
        activation: { code: display, expiresAt: expiresAt.toISOString(), userId: user.id, identifier: body.email, displayName: body.fullName },
      };
    });
  }

  async updateStaff(actor: Actor, id: string, body: StaffUpdate, ip: string | null): Promise<StaffDto> {
    const existing = await this.prisma.staff.findUnique({ where: { id }, include: staffInclude });
    if (!existing) throw Problem.notFound();
    if (body.isActive !== undefined && body.isActive !== existing.isActive) {
      await this.auth.setStatus(actor, existing.userId, body.isActive ? 'ACTIVE' : 'SUSPENDED', { ip, userAgent: null });
    }
    if (body.role !== undefined && body.role !== existing.user.role) {
      await this.prisma.user.update({ where: { id: existing.userId }, data: { role: body.role } });
    }
    const row = await this.prisma.staff.update({
      where: { id },
      data: {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.designation !== undefined ? { designation: body.designation } : {}),
        ...(body.joinedOn !== undefined ? { joinedOn: toDate(body.joinedOn) } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: staffInclude,
    });
    await this.audit.record({ actorId: actor.id, action: 'staff.update', entity: 'Staff', entityId: id, before: toStaffDto(existing), after: toStaffDto(row), ip });
    return toStaffDto(row);
  }
}
