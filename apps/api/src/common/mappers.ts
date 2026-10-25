import type { Prisma } from '@prisma/client';
import type { StudentDto } from '@hca/contracts';
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

export function toStudentDto(s: StudentRow): StudentDto {
  const e = s.enrollments[0];
  return {
    id: s.id,
    admissionNo: s.admissionNo,
    fullName: s.fullName,
    dob: dateOnly(s.dob),
    gender: s.gender,
    bloodGroup: s.bloodGroup,
    status: s.status,
    // Signed-URL storage is a separate deliverable; until then no permanent path is ever emitted.
    photoUrl: null,
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
