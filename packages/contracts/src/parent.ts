import { z } from 'zod';
import { IsoDateTime, Money, Page, PageQuery, Uuid, YearMonth } from './common';
import { InvoiceDto, StaffRefDto, StudentDto } from './dto';
import { NoticeTag } from './enums';
import { AttendanceMonth } from './attendance';
import { roles, route } from './route';

/**
 * Parent portal — BLUEPRINT-001 §3/§4. Every `:id` here is a Student id and every route carries a
 * `student` relation: a parent holding a valid token for family A gets 404 (not 403) for family B's
 * child, by default, from the route declaration — not from handler discipline.
 *
 * Parents are read-only in V1. Admin roles reach the same data through their own `/admin/...` routes;
 * the parent routes are PARENT-only so there is exactly one meaning of "my child".
 */

export const ChildCard = z.object({
  student: StudentDto,
  className: z.string().nullable(),
  sectionName: z.string().nullable(),
  rollNo: z.number().int().nullable(),
  classTeacher: StaffRefDto.nullable(),
  fees: z.object({ outstanding: Money, overdueInvoices: z.number().int() }),
  attendanceThisMonth: z.object({
    month: YearMonth,
    present: z.number().int(), absent: z.number().int(), late: z.number().int(), leave: z.number().int(), workingDays: z.number().int(),
  }),
});
export type ChildCard = z.infer<typeof ChildCard>;

export const ChildFees = z.object({
  studentId: Uuid,
  sessionId: Uuid.nullable(),
  sessionLabel: z.string().nullable(),
  invoices: z.array(InvoiceDto),
  totals: z.object({ due: Money, paid: Money, balance: Money }),
});
export type ChildFees = z.infer<typeof ChildFees>;

export const ParentNotice = z.object({
  id: Uuid,
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  tag: NoticeTag,
  publishFrom: IsoDateTime,
  isPinned: z.boolean(),
});
export type ParentNotice = z.infer<typeof ParentNotice>;

const ChildId = z.object({ id: Uuid });
const PARENT = ['PARENT'] as const;
const child = { resource: 'student', param: 'id' } as const;

export const parentRoutes = {
  children: route({
    method: 'GET', path: '/me/children', access: roles(PARENT),
    summary: 'The signed-in parent\'s children (via StudentGuardian), as dashboard cards. Multi-child families get several cards.',
    response: z.array(ChildCard),
  }),
  child: route({
    method: 'GET', path: '/children/:id', access: roles(PARENT, child),
    summary: 'One child\'s profile. Never includes StudentSensitive.', params: ChildId, response: ChildCard,
  }),
  childFees: route({
    method: 'GET', path: '/children/:id/fees', access: roles(PARENT, child),
    summary: 'Invoices, lines and receipts for the RUNNING session (or `sessionId`). Voided receipts shown but not counted.',
    params: ChildId, query: z.object({ sessionId: Uuid.optional() }), response: ChildFees,
  }),
  childAttendance: route({
    method: 'GET', path: '/children/:id/attendance', access: roles(PARENT, child),
    summary: 'Month view with holidays marked so absent never reads as "school was shut". Defaults to the current month.',
    params: ChildId, query: z.object({ month: YearMonth.optional() }), response: AttendanceMonth,
  }),
  notices: route({
    method: 'GET', path: '/me/notices', access: roles(PARENT),
    summary: 'Notices for audience PUBLIC or PARENTS that are live and either untargeted or targeted at a section one of the parent\'s children is in.',
    query: PageQuery, response: Page(ParentNotice),
  }),
};

