import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MAX_ROSTER_SIZE,
  TEACHER_ATTENDANCE_EDIT_WINDOW_DAYS,
  type AttendanceDayDto,
  type AttendanceSubmission,
  type AttendanceSubmitResult,
  type MySections,
  type RosterStudent,
  type SectionAttendanceSheet,
  type SectionDto,
} from '@hca/contracts';
import { dateOnly, schoolToday, toDate } from '../common/format';
import { Problem } from '../common/problem';
import type { Principal } from '../common/endpoint';
import { AuditService } from '../audit/audit.service';
import { PrismaService, type Db } from '../prisma.service';

const dayInclude = { entries: true, markedBy: { include: { staff: true } } } satisfies Prisma.AttendanceDayInclude;
type DayRow = Prisma.AttendanceDayGetPayload<{ include: typeof dayInclude }>;

const daysBetween = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86_400_000);

function toDayDto(d: DayRow): AttendanceDayDto {
  return {
    sectionId: d.sectionId,
    date: dateOnly(d.date),
    markedBy: { id: d.markedById, displayName: d.markedBy.staff?.fullName ?? (d.markedBy.role === 'SUPER_ADMIN' ? 'Administrator' : 'Office') },
    markedAt: d.markedAt.toISOString(),
    capturedAt: d.capturedAt.toISOString(),
    lastMutationId: d.lastMutationId,
    isFinalised: d.isFinalised,
    entries: d.entries.map((e) => ({ studentId: e.studentId, status: e.status, note: e.note })).sort((a, b) => a.studentId.localeCompare(b.studentId)),
  };
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async sectionDto(sectionId: string, db: Db = this.prisma): Promise<SectionDto> {
    const s = await db.section.findUnique({
      where: { id: sectionId },
      include: { classLevel: true, classTeacher: true, _count: { select: { enrollments: { where: { state: 'ACTIVE' } } } } },
    });
    if (!s) throw Problem.notFound();
    return {
      id: s.id,
      sessionId: s.sessionId,
      classLevelId: s.classLevelId,
      className: s.classLevel.name,
      name: s.name,
      classTeacher: s.classTeacher ? { id: s.classTeacher.id, fullName: s.classTeacher.fullName } : null,
      studentCount: s._count.enrollments,
    };
  }

  private async rosterOf(sectionId: string, db: Db = this.prisma): Promise<RosterStudent[]> {
    const rows = await db.enrollment.findMany({ where: { sectionId, state: 'ACTIVE' }, include: { student: true }, orderBy: { rollNo: 'asc' } });
    return rows.map((e) => ({ studentId: e.studentId, admissionNo: e.student.admissionNo, fullName: e.student.fullName, rollNo: e.rollNo, photoUrl: null }));
  }

  async mySections(userId: string): Promise<MySections> {
    const today = schoolToday();
    const staff = await this.prisma.staff.findUnique({ where: { userId } });
    if (!staff) return { today, sections: [] };
    const sections = await this.prisma.section.findMany({
      where: { session: { state: 'RUNNING' }, OR: [{ classTeacherId: staff.id }, { subjectTeachers: { some: { staffId: staff.id } } }] },
      include: { subjectTeachers: { where: { staffId: staff.id } }, classLevel: true },
      orderBy: [{ classLevel: { order: 'asc' } }, { name: 'asc' }],
    });
    const marked = new Set(
      (await this.prisma.attendanceDay.findMany({ where: { date: toDate(today), sectionId: { in: sections.map((s) => s.id) } }, select: { sectionId: true } })).map((d) => d.sectionId),
    );
    return {
      today,
      sections: await Promise.all(
        sections.map(async (s) => {
          const isClass = s.classTeacherId === staff.id;
          return {
            section: await this.sectionDto(s.id),
            relationship: isClass ? ('CLASS_TEACHER' as const) : ('SUBJECT_TEACHER' as const),
            subjects: s.subjectTeachers.map((t) => t.subject),
            canMarkAttendance: isClass,
            todayMarked: marked.has(s.id),
          };
        }),
      ),
    };
  }

  async roster(sectionId: string) {
    return { section: await this.sectionDto(sectionId), students: await this.rosterOf(sectionId) };
  }

  /** Why a date cannot be written by this principal, or null if it can. */
  private async dateBlock(sectionId: string, date: string, me: Principal): Promise<{ code: 'ATTENDANCE_DATE_NOT_ALLOWED' | 'ATTENDANCE_SESSION_NOT_RUNNING'; detail: string } | null> {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId }, include: { session: true } });
    if (!section) throw Problem.notFound();
    return this.dateBlockFor(this.prisma, section, date, me);
  }

  private async dateBlockFor(db: Db, section: { sessionId: string; session: { state: string; startsOn: Date; endsOn: Date } }, date: string, me: Principal) {
    if (section.session.state !== 'RUNNING') return { code: 'ATTENDANCE_SESSION_NOT_RUNNING' as const, detail: 'This session is not running' };
    const today = schoolToday();
    if (date > today) return { code: 'ATTENDANCE_DATE_NOT_ALLOWED' as const, detail: 'Attendance cannot be marked for a future date' };
    if (date < dateOnly(section.session.startsOn) || date > dateOnly(section.session.endsOn)) {
      return { code: 'ATTENDANCE_DATE_NOT_ALLOWED' as const, detail: 'Date is outside the session' };
    }
    if (me.role === 'TEACHER' && daysBetween(today, date) > TEACHER_ATTENDANCE_EDIT_WINDOW_DAYS) {
      return { code: 'ATTENDANCE_DATE_NOT_ALLOWED' as const, detail: `Teachers can edit only the last ${TEACHER_ATTENDANCE_EDIT_WINDOW_DAYS} days; ask the office` };
    }
    const holiday = await db.holiday.findUnique({ where: { sessionId_date: { sessionId: section.sessionId, date: toDate(date) } } });
    if (holiday) return { code: 'ATTENDANCE_DATE_NOT_ALLOWED' as const, detail: `${holiday.label} is a holiday` };
    return null;
  }

  async getDay(me: Principal, sectionId: string, date: string): Promise<SectionAttendanceSheet> {
    const [section, day, roster, holidayRow, sectionRow] = await Promise.all([
      this.sectionDto(sectionId),
      this.prisma.attendanceDay.findUnique({ where: { sectionId_date: { sectionId, date: toDate(date) } }, include: dayInclude }),
      this.rosterOf(sectionId),
      this.prisma.holiday.findFirst({ where: { date: toDate(date), session: { sections: { some: { id: sectionId } } } } }),
      this.prisma.section.findUnique({ where: { id: sectionId }, select: { classTeacher: { select: { userId: true } } } }),
    ]);
    const block = await this.dateBlock(sectionId, date, me);
    const mayWriteSection = me.role !== 'TEACHER' || sectionRow?.classTeacher?.userId === me.id;
    const canSubmit = mayWriteSection && block === null && !(day?.isFinalised && me.role === 'TEACHER');
    return { section, date, marked: day !== null, day: day ? toDayDto(day) : null, roster, holiday: holidayRow ? { label: holidayRow.label } : null, canSubmit };
  }

  async putDay(me: Principal, sectionId: string, date: string, body: AttendanceSubmission, ip: string | null): Promise<AttendanceSubmitResult> {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId }, include: { session: true } });
    if (!section) throw Problem.notFound();
    const block = await this.dateBlockFor(this.prisma, section, date, me);
    if (block) throw new Problem({ status: 422, code: block.code, detail: block.detail });

    const dateVal = toDate(date);
    const now = new Date();
    // A phone with a wrong clock must not be able to pin a day in the future.
    const capturedAt = new Date(Math.min(new Date(body.capturedAt).getTime(), now.getTime()));

    return this.prisma.$transaction(async (tx) => {
      // Serialises every writer for this (section, date); the unique key alone would only catch the first-insert race.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${sectionId}:${date}`}, 0))`;

      const existing = await tx.attendanceDay.findUnique({ where: { sectionId_date: { sectionId, date: dateVal } }, include: dayInclude });
      if (existing && existing.lastMutationId === body.mutationId) return { ...toDayDto(existing), outcome: 'REPLAYED' as const };

      if (existing?.isFinalised && me.role === 'TEACHER') {
        throw Problem.conflict('This register has been finalised by the office', 'ATTENDANCE_FINALISED', { current: toDayDto(existing) });
      }
      if (existing && capturedAt < existing.capturedAt) {
        throw Problem.conflict('A newer register already exists for this day', 'ATTENDANCE_STALE', { current: toDayDto(existing) });
      }

      const roster = await this.rosterOf(sectionId, tx);
      const live = new Set(roster.map((r) => r.studentId));
      const sent = new Set(body.entries.map((e) => e.studentId));
      if (roster.length > MAX_ROSTER_SIZE || live.size !== sent.size || [...live].some((id) => !sent.has(id))) {
        throw new Problem({
          status: 422,
          code: 'ATTENDANCE_ROSTER_MISMATCH',
          detail: 'The register must cover exactly the current roster',
          extra: { roster },
        });
      }

      const day = await tx.attendanceDay.upsert({
        where: { sectionId_date: { sectionId, date: dateVal } },
        create: { sectionId, date: dateVal, markedById: me.id, markedAt: now, lastMutationId: body.mutationId, capturedAt },
        update: { markedById: me.id, markedAt: now, lastMutationId: body.mutationId, capturedAt },
      });
      await tx.attendanceEntry.deleteMany({ where: { dayId: day.id } });
      await tx.attendanceEntry.createMany({ data: body.entries.map((e) => ({ dayId: day.id, studentId: e.studentId, status: e.status, note: e.note ?? null })) });

      const saved = await tx.attendanceDay.findUniqueOrThrow({ where: { id: day.id }, include: dayInclude });
      if (existing && me.role !== 'TEACHER') {
        await this.audit.record({ actorId: me.id, action: 'attendance.correct', entity: 'AttendanceDay', entityId: day.id, before: toDayDto(existing), after: toDayDto(saved), ip }, tx);
      }
      return { ...toDayDto(saved), outcome: existing ? ('UPDATED' as const) : ('CREATED' as const) };
    });
  }

  async setFinalised(me: Principal, sectionId: string, date: string, value: boolean, ip: string | null): Promise<AttendanceDayDto> {
    const day = await this.prisma.attendanceDay.findUnique({ where: { sectionId_date: { sectionId, date: toDate(date) } } });
    if (!day) throw Problem.notFound('No register for that day');
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.attendanceDay.update({ where: { id: day.id }, data: { isFinalised: value }, include: dayInclude });
      await this.audit.record({ actorId: me.id, action: value ? 'attendance.finalise' : 'attendance.unfinalise', entity: 'AttendanceDay', entityId: day.id, ip }, tx);
      return toDayDto(saved);
    });
  }

  async report(q: { sessionId?: string; sectionId?: string; from: string; to: string; unmarkedOn?: string }) {
    const session = q.sessionId ? { id: q.sessionId } : await this.prisma.academicSession.findFirst({ where: { state: 'RUNNING' }, select: { id: true } });
    if (!session) return { rows: [], unmarkedSections: [] };
    const enrollments = await this.prisma.enrollment.findMany({
      where: { sessionId: session.id, state: 'ACTIVE', ...(q.sectionId ? { sectionId: q.sectionId } : {}) },
      include: { student: true, section: { include: { classLevel: true } } },
      orderBy: [{ section: { classLevel: { order: 'asc' } } }, { section: { name: 'asc' } }, { rollNo: 'asc' }],
    });
    const entries = await this.prisma.attendanceEntry.findMany({
      where: { studentId: { in: enrollments.map((e) => e.studentId) }, day: { date: { gte: toDate(q.from), lte: toDate(q.to) } } },
      select: { studentId: true, status: true },
    });
    const tally = new Map<string, { present: number; absent: number; late: number; leave: number }>();
    for (const e of entries) {
      const t = tally.get(e.studentId) ?? { present: 0, absent: 0, late: 0, leave: 0 };
      t[e.status.toLowerCase() as 'present' | 'absent' | 'late' | 'leave'] += 1;
      tally.set(e.studentId, t);
    }
    const rows = enrollments.map((e) => {
      const t = tally.get(e.studentId) ?? { present: 0, absent: 0, late: 0, leave: 0 };
      return {
        studentId: e.studentId, admissionNo: e.student.admissionNo, fullName: e.student.fullName,
        sectionId: e.sectionId, sectionName: e.section.name, className: e.section.classLevel.name,
        ...t, workingDays: t.present + t.absent + t.late + t.leave,
      };
    });
    let unmarkedSections: SectionDto[] = [];
    if (q.unmarkedOn) {
      const unmarked = await this.prisma.section.findMany({
        where: { sessionId: session.id, attendanceDays: { none: { date: toDate(q.unmarkedOn) } }, enrollments: { some: { state: 'ACTIVE' } } },
        select: { id: true },
      });
      unmarkedSections = await Promise.all(unmarked.map((s) => this.sectionDto(s.id)));
    }
    return { rows, unmarkedSections };
  }
}
