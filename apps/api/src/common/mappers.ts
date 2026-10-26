import type { Prisma } from '@prisma/client';
import type { ClassLevelDto, EnrollmentDto, GuardianDto, SectionDto, SessionDto, StaffDto, StudentDto } from '@hca/contracts';
import { dateOnly } from './format';

export const studentWithCurrent = {
  include: {
    enrollments: {
      where: { session: { state: 'RUNNING' } },
      include: { session: true, section: { include: { classLevel: true, classTeacher: true } } },
      take: 1,
    },
  },
} satisfies Prisma.StudentDefaultArgs;

export type StudentRow = Prisma.StudentGetPayload<typeof studentWithCurrent>;

/** `signPhoto` is omitted by callers that have not wired signed-URL storage yet (parent module). */
export function toStudentDto(s: StudentRow, signPhoto?: (photoKey: string) => string): StudentDto {
  const e = s.enrollments[0];
  return {
    id: s.id,
    admissionNo: s.admissionNo,
    fullName: s.fullName,
    dob: dateOnly(s.dob),
    gender: s.gender,
    bloodGroup: s.bloodGroup,
    status: s.status,
    photoUrl: s.photoKey && signPhoto ? signPhoto(s.photoKey) : null,
    currentEnrollment: e
      ? {
          id: e.id,
          sessionId: e.sessionId,
          sessionLabel: e.session.label,
          sectionId: e.sectionId,
          className: e.section.classLevel.name,
          sectionName: e.section.name,
          rollNo: e.rollNo,
          state: e.state,
        }
      : null,
  };
}

export function toSessionDto(s: Prisma.AcademicSessionGetPayload<object>): SessionDto {
  return { id: s.id, label: s.label, startsOn: dateOnly(s.startsOn), endsOn: dateOnly(s.endsOn), state: s.state, isAdmissionOpen: s.isAdmissionOpen };
}

export function toClassLevelDto(c: Prisma.ClassLevelGetPayload<object>): ClassLevelDto {
  return { id: c.id, name: c.name, order: c.order, stage: c.stage, minAge: c.minAge, maxAge: c.maxAge };
}

export function toStaffDto(row: Prisma.StaffGetPayload<{ include: { user: true } }>): StaffDto {
  return {
    id: row.id,
    userId: row.userId,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    designation: row.designation,
    phone: row.phone,
    email: row.user.email,
    role: row.user.role,
    joinedOn: dateOnly(row.joinedOn),
    isActive: row.isActive,
  };
}

export const sectionInclude = {
  classLevel: true,
  classTeacher: true,
  _count: { select: { enrollments: { where: { state: 'ACTIVE' as const } } } },
} satisfies Prisma.SectionInclude;

export function toSectionDto(s: Prisma.SectionGetPayload<{ include: typeof sectionInclude }>): SectionDto {
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

export const enrollmentInclude = {
  session: true,
  section: { include: { classLevel: true } },
} satisfies Prisma.EnrollmentInclude;

export function toEnrollmentDto(e: Prisma.EnrollmentGetPayload<{ include: typeof enrollmentInclude }>): EnrollmentDto {
  return {
    id: e.id,
    sessionId: e.sessionId,
    sessionLabel: e.session.label,
    sectionId: e.sectionId,
    className: e.section.classLevel.name,
    sectionName: e.section.name,
    rollNo: e.rollNo,
    state: e.state,
  };
}

/** `user` is the linked parent account, if any (Guardian.userId is nullable). */
export function toGuardianDto(g: Prisma.GuardianGetPayload<object>, user: { status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' } | null, isPrimary: boolean): GuardianDto {
  return {
    id: g.id,
    fullName: g.fullName,
    relation: g.relation,
    phone: g.phone,
    email: g.email,
    occupation: g.occupation,
    isPrimary,
    loginStatus: user ? user.status : 'NONE',
  };
}
