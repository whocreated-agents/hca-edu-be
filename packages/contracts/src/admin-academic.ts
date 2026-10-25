import { z } from 'zod';
import { DateOnly, Email, IdParam, Page, PageQuery, Phone, ShortText, Uuid } from './common';
import { ClassLevelDto, SectionDto, SessionDto, StaffDto } from './dto';
import { MONEY_ROLES, Role, STAFF_ADMIN_ROLES } from './enums';
import { IssuedActivationCode } from './auth';
import { roles, route } from './route';

/**
 * Admin control plane, part 1: sessions, class levels, sections, staff.
 * Role groups: `STAFF_ADMIN_ROLES` = SUPER_ADMIN + OFFICE (write); reads of reference data are also
 * open to ACCOUNTS because fee screens need them. Staff *accounts* are SUPER_ADMIN write / OFFICE read
 * (BLUEPRINT-001 §5).
 */

const ADMIN_WRITE = STAFF_ADMIN_ROLES;
const ADMIN_READ = [...MONEY_ROLES] as const;

// ---- Sessions ----------------------------------------------------------------------------

export const SessionCreate = z
  .strictObject({
    label: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Like 2027-28'),
    startsOn: DateOnly,
    endsOn: DateOnly,
    isAdmissionOpen: z.boolean().default(false),
  })
  .refine((v) => v.endsOn > v.startsOn, { path: ['endsOn'], message: 'Must be after the start date' });
export type SessionCreate = z.input<typeof SessionCreate>;

export const SessionUpdate = z.strictObject({
  label: z.string().trim().regex(/^\d{4}-\d{2}$/).optional(),
  startsOn: DateOnly.optional(),
  endsOn: DateOnly.optional(),
  isAdmissionOpen: z.boolean().optional(),
});

export const HolidayDto = z.object({ id: Uuid, sessionId: Uuid, date: DateOnly, label: z.string() });
export const HolidayCreate = z.strictObject({ date: DateOnly, label: ShortText(100) });

// ---- Sections ----------------------------------------------------------------------------

export const SectionCreate = z.strictObject({
  sessionId: Uuid,
  classLevelId: Uuid,
  name: ShortText(10),
  classTeacherId: Uuid.nullable().optional(),
});
export const SectionUpdate = z.strictObject({ name: ShortText(10).optional(), classTeacherId: Uuid.nullable().optional() });
export const SubjectTeacherDto = z.object({ id: Uuid, staffId: Uuid, staffName: z.string(), subject: z.string() });
export const SubjectTeacherAssign = z.strictObject({ staffId: Uuid, subject: ShortText(60) });

// ---- Staff -------------------------------------------------------------------------------

export const StaffCreate = z.strictObject({
  fullName: ShortText(100),
  email: Email,
  phone: Phone,
  designation: ShortText(80),
  employeeCode: ShortText(30),
  joinedOn: DateOnly,
  role: z.enum([Role.enum.TEACHER, Role.enum.OFFICE, Role.enum.ACCOUNTS]),
});
export type StaffCreate = z.input<typeof StaffCreate>;

export const StaffUpdate = z.strictObject({
  fullName: ShortText(100).optional(),
  phone: Phone.optional(),
  designation: ShortText(80).optional(),
  joinedOn: DateOnly.optional(),
  isActive: z.boolean().optional(),
  role: z.enum([Role.enum.TEACHER, Role.enum.OFFICE, Role.enum.ACCOUNTS]).optional(),
});

/** Creating a staff member returns the activation code ONCE; there is no other way to read it. */
export const StaffCreated = z.object({ staff: StaffDto, activation: IssuedActivationCode });

export const adminAcademicRoutes = {
  sessions: route({
    method: 'GET', path: '/admin/sessions', access: roles(ADMIN_READ),
    summary: 'All sessions, newest first.', response: z.array(SessionDto),
  }),
  createSession: route({
    method: 'POST', path: '/admin/sessions', access: roles(ADMIN_WRITE),
    summary: 'Create a session (always UPCOMING). 409 if isAdmissionOpen would give two open sessions: close the other first.',
    body: SessionCreate, response: SessionDto,
  }),
  updateSession: route({
    method: 'PATCH', path: '/admin/sessions/:id', access: roles(ADMIN_WRITE),
    summary: 'Edit label/dates/admission flag. State changes go through /transition only.', params: IdParam, body: SessionUpdate, response: SessionDto,
  }),
  transitionSession: route({
    method: 'POST', path: '/admin/sessions/:id/transition', access: roles(ADMIN_WRITE),
    summary: 'UPCOMING -> RUNNING (closes the current RUNNING session in the same transaction) or RUNNING -> CLOSED. Anything else is 409 SESSION_STATE_INVALID. CLOSED is terminal.',
    params: IdParam, body: z.strictObject({ to: z.enum(['RUNNING', 'CLOSED']) }), response: SessionDto, status: 200,
  }),
  holidays: route({
    method: 'GET', path: '/admin/sessions/:id/holidays', access: roles(ADMIN_READ), summary: 'Holidays in a session.',
    params: IdParam, response: z.array(HolidayDto),
  }),
  createHoliday: route({
    method: 'POST', path: '/admin/sessions/:id/holidays', access: roles(ADMIN_WRITE), summary: 'Add a holiday inside the session dates.',
    params: IdParam, body: HolidayCreate, response: HolidayDto,
  }),
  deleteHoliday: route({
    method: 'DELETE', path: '/admin/holidays/:id', access: roles(ADMIN_WRITE), summary: 'Remove a holiday.', params: IdParam,
  }),

  classLevels: route({
    method: 'GET', path: '/admin/class-levels', access: roles(ADMIN_READ), summary: 'The 13 seeded levels.', response: z.array(ClassLevelDto),
  }),
  updateClassLevel: route({
    method: 'PATCH', path: '/admin/class-levels/:id', access: roles(ADMIN_WRITE),
    summary: 'Edit age bounds only. Names/order/stage are structural and seeded.',
    params: IdParam, body: z.strictObject({ minAge: z.number().int().min(1).max(25).nullable().optional(), maxAge: z.number().int().min(1).max(25).nullable().optional() }),
    response: ClassLevelDto,
  }),

  sections: route({
    method: 'GET', path: '/admin/sections', access: roles(ADMIN_READ),
    summary: 'Sections of a session (default RUNNING).', query: z.object({ sessionId: Uuid.optional(), classLevelId: Uuid.optional() }), response: z.array(SectionDto),
  }),
  createSection: route({
    method: 'POST', path: '/admin/sections', access: roles(ADMIN_WRITE), summary: 'Create a section. 409 on duplicate (session, class, name).',
    body: SectionCreate, response: SectionDto,
  }),
  updateSection: route({
    method: 'PATCH', path: '/admin/sections/:id', access: roles(ADMIN_WRITE), summary: 'Rename or change the class teacher.',
    params: IdParam, body: SectionUpdate, response: SectionDto,
  }),
  subjectTeachers: route({
    method: 'GET', path: '/admin/sections/:id/subject-teachers', access: roles(ADMIN_READ), summary: 'Subject teachers of a section.',
    params: IdParam, response: z.array(SubjectTeacherDto),
  }),
  assignSubjectTeacher: route({
    method: 'POST', path: '/admin/sections/:id/subject-teachers', access: roles(ADMIN_WRITE), summary: 'Assign a subject teacher.',
    params: IdParam, body: SubjectTeacherAssign, response: SubjectTeacherDto,
  }),
  removeSubjectTeacher: route({
    method: 'DELETE', path: '/admin/subject-teachers/:id', access: roles(ADMIN_WRITE), summary: 'Remove a subject-teacher assignment.', params: IdParam,
  }),

  staff: route({
    method: 'GET', path: '/admin/staff', access: roles(STAFF_ADMIN_ROLES), summary: 'Staff list.',
    query: PageQuery.extend({ q: z.string().trim().max(100).optional(), isActive: z.coerce.boolean().optional() }), response: Page(StaffDto),
  }),
  staffOne: route({
    method: 'GET', path: '/admin/staff/:id', access: roles(STAFF_ADMIN_ROLES), summary: 'One staff member.', params: IdParam, response: StaffDto,
  }),
  createStaff: route({
    method: 'POST', path: '/admin/staff', access: roles(['SUPER_ADMIN']),
    summary: 'Create a staff account (User INVITED + Staff). Returns a single-use activation code; no password is ever set by an admin.',
    body: StaffCreate, response: StaffCreated,
  }),
  updateStaff: route({
    method: 'PATCH', path: '/admin/staff/:id', access: roles(['SUPER_ADMIN']), summary: 'Edit staff; deactivating also suspends the user.',
    params: IdParam, body: StaffUpdate, response: StaffDto,
  }),
};

