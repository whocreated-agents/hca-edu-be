import { z } from 'zod';
import { DateOnly, IsoDateTime, Uuid, YearMonth } from './common';
import { AttendanceStatus } from './enums';
import { SectionDto } from './dto';
import { roles, route } from './route';

/**
 * Attendance — the highest-frequency action in the system (PRD-001 §4) and the one that must be
 * safe to retry on a dropped connection (BLUEPRINT-001 §2.6).
 *
 * THE SYNC CONTRACT
 * -----------------
 * One payload per section per day: `PUT /sections/:id/attendance/:date`.
 *
 * - It carries the WHOLE register. The server requires `entries` to cover exactly the section's
 *   live roster (ACTIVE enrolments): same set of studentIds, no duplicates. A partial or
 *   over-complete payload is rejected 422 ATTENDANCE_ROSTER_MISMATCH with the current roster in
 *   `extra.roster`, and NOTHING is written. So a register is never half-marked.
 * - The write is one transaction keyed on the unique (sectionId, date). Concurrent first-ever PUTs
 *   for the same key serialise on that constraint; the loser retries as an update.
 * - `mutationId` is generated once per submission on the device and reused on EVERY retry of it.
 *   If it equals the stored `lastMutationId` the PUT is a no-op that returns the stored day with
 *   outcome REPLAYED — a retry after a lost response is therefore harmless.
 * - `capturedAt` is when the teacher tapped the marks, not when the request is sent. If a newer
 *   capture is already stored (e.g. the office corrected the register while the phone was
 *   offline) the stale submission is rejected 409 ATTENDANCE_STALE with the winning state in
 *   `extra.current`; it never silently overwrites. The server clamps capturedAt to its own "now"
 *   so a phone with a wrong clock cannot pin a day in the future.
 * - The offline outbox may therefore replay at any time, any number of times, in any order.
 */

/** Offsets and "today" are school-local; the server tells clients today's date, devices don't guess. */
export const SCHOOL_TIMEZONE = 'Asia/Kolkata';
/** Teachers may (re)submit for today and this many previous days; OFFICE has no window. */
export const TEACHER_ATTENDANCE_EDIT_WINDOW_DAYS = 7;
export const MAX_ROSTER_SIZE = 120;

export const AttendanceMark = z.strictObject({
  studentId: Uuid,
  status: AttendanceStatus,
  note: z.string().trim().max(200).optional(),
});

export const AttendanceSubmission = z
  .strictObject({
    mutationId: Uuid,
    capturedAt: IsoDateTime,
    entries: z.array(AttendanceMark).min(1).max(MAX_ROSTER_SIZE),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.entries.forEach((e, i) => {
      if (seen.has(e.studentId)) ctx.addIssue({ code: 'custom', path: ['entries', i, 'studentId'], message: 'Duplicate student' });
      seen.add(e.studentId);
    });
  });
export type AttendanceSubmission = z.input<typeof AttendanceSubmission>;

export const RosterStudent = z.object({
  studentId: Uuid,
  admissionNo: z.string(),
  fullName: z.string(),
  rollNo: z.number().int(),
  photoUrl: z.string().nullable(),
});
export type RosterStudent = z.infer<typeof RosterStudent>;

export const AttendanceDayDto = z.object({
  sectionId: Uuid,
  date: DateOnly,
  markedBy: z.object({ id: Uuid, displayName: z.string() }),
  markedAt: IsoDateTime,
  capturedAt: IsoDateTime,
  lastMutationId: Uuid,
  isFinalised: z.boolean(),
  entries: z.array(z.object({ studentId: Uuid, status: AttendanceStatus, note: z.string().nullable() })),
});
export type AttendanceDayDto = z.infer<typeof AttendanceDayDto>;

export const AttendanceOutcome = z.enum(['CREATED', 'UPDATED', 'REPLAYED']);
export const AttendanceSubmitResult = AttendanceDayDto.extend({ outcome: AttendanceOutcome });
export type AttendanceSubmitResult = z.infer<typeof AttendanceSubmitResult>;

export const SectionAttendanceSheet = z.object({
  section: SectionDto,
  date: DateOnly,
  /** True if a register exists for this date. When false, `day` is null and the sheet is blank. */
  marked: z.boolean(),
  day: AttendanceDayDto.nullable(),
  roster: z.array(RosterStudent),
  holiday: z.object({ label: z.string() }).nullable(),
  /** Whether the CALLER may submit (class teacher / office, in window, not finalised, session running). */
  canSubmit: z.boolean(),
});
export type SectionAttendanceSheet = z.infer<typeof SectionAttendanceSheet>;

export const SectionAssignment = z.object({
  section: SectionDto,
  relationship: z.enum(['CLASS_TEACHER', 'SUBJECT_TEACHER']),
  subjects: z.array(z.string()),
  canMarkAttendance: z.boolean(),
  /** Whether today's register exists yet — drives the portal landing card. */
  todayMarked: z.boolean(),
});
export const MySections = z.object({
  /** Server's school-local date. Clients use this, not the device clock. */
  today: DateOnly,
  sections: z.array(SectionAssignment),
});
export type MySections = z.infer<typeof MySections>;

export const SectionRoster = z.object({ section: SectionDto, students: z.array(RosterStudent) });

// ---- Parent-facing month view ---------------------------------------------------------------

export const AttendanceMonthDay = z.object({
  date: DateOnly,
  /** null = no register taken that day (and not a holiday). */
  status: AttendanceStatus.nullable(),
  note: z.string().nullable(),
  holiday: z.string().nullable(),
});
export const AttendanceMonth = z.object({
  studentId: Uuid,
  month: YearMonth,
  days: z.array(AttendanceMonthDay),
  summary: z.object({
    present: z.number().int(),
    absent: z.number().int(),
    late: z.number().int(),
    leave: z.number().int(),
    /** Days a register was actually taken and the day was not a holiday. */
    workingDays: z.number().int(),
  }),
});
export type AttendanceMonth = z.infer<typeof AttendanceMonth>;

const SectionDate = z.object({ id: Uuid, date: DateOnly });
const TEACHING = ['TEACHER', 'SUPER_ADMIN', 'OFFICE'] as const;

export const attendanceRoutes = {
  mySections: route({
    method: 'GET', path: '/staff/me/sections', access: roles(['TEACHER']),
    summary: 'Sections the signed-in teacher teaches in the RUNNING session, plus server date.', response: MySections,
  }),
  roster: route({
    method: 'GET', path: '/sections/:id/roster', access: roles(TEACHING, { resource: 'section', param: 'id', teacher: 'any' }),
    summary: 'Live roster (ACTIVE enrolments). Teacher: own sections only; others 404.',
    params: z.object({ id: Uuid }), response: SectionRoster,
  }),
  getDay: route({
    method: 'GET', path: '/sections/:id/attendance/:date', access: roles(TEACHING, { resource: 'section', param: 'id', teacher: 'any' }),
    summary: 'Register for a date, with the roster to render a blank sheet when none exists yet.',
    params: SectionDate, response: SectionAttendanceSheet,
  }),
  putDay: route({
    method: 'PUT', path: '/sections/:id/attendance/:date', access: roles(TEACHING, { resource: 'section', param: 'id', teacher: 'class' }),
    summary: 'Idempotent whole-register submit. See the SYNC CONTRACT at the top of attendance.ts. 200 with outcome CREATED|UPDATED|REPLAYED; 409 ATTENDANCE_STALE / ATTENDANCE_FINALISED; 422 ATTENDANCE_ROSTER_MISMATCH / ATTENDANCE_DATE_NOT_ALLOWED / ATTENDANCE_SESSION_NOT_RUNNING.',
    params: SectionDate, body: AttendanceSubmission, response: AttendanceSubmitResult, status: 200,
  }),
  finalise: route({
    method: 'POST', path: '/admin/sections/:id/attendance/:date/finalise', access: roles(['SUPER_ADMIN', 'OFFICE']),
    summary: 'Lock a register against teacher overwrites. Audited.', params: SectionDate, response: AttendanceDayDto, status: 200,
  }),
  unfinalise: route({
    method: 'DELETE', path: '/admin/sections/:id/attendance/:date/finalise', access: roles(['SUPER_ADMIN', 'OFFICE']),
    summary: 'Unlock a finalised register. Audited.', params: SectionDate, response: AttendanceDayDto, status: 200,
  }),
  report: route({
    method: 'GET', path: '/admin/attendance/reports', access: roles(['SUPER_ADMIN', 'OFFICE']),
    summary: 'Per-student attendance summary over a date range for a session/section; also lists sections with no register on `date` when `unmarkedOn` is given.',
    query: z.object({
      sessionId: Uuid.optional(),
      sectionId: Uuid.optional(),
      from: DateOnly,
      to: DateOnly,
      unmarkedOn: DateOnly.optional(),
    }),
    response: z.object({
      rows: z.array(
        z.object({
          studentId: Uuid, admissionNo: z.string(), fullName: z.string(), sectionId: Uuid, sectionName: z.string(), className: z.string(),
          present: z.number().int(), absent: z.number().int(), late: z.number().int(), leave: z.number().int(), workingDays: z.number().int(),
        }),
      ),
      unmarkedSections: z.array(SectionDto),
    }),
  }),
};
