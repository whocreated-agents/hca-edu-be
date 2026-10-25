import { z } from 'zod';
import { DateOnly, Email, IdParam, IsoDateTime, Page, PageQuery, Phone, Uuid } from './common';
import { ApplicationStatus, EnquiryState, STAFF_ADMIN_ROLES } from './enums';
import { ApplicationDocumentDto, ApplicationForm } from './public';
import { StudentCreated, EnrollInput, GuardianInput } from './admin-students';
import { roles, route } from './route';

/** Admin control plane, part 3: the admission pipeline (BLUEPRINT-001 §2.4, PRD-001 §5). */

const ADMISSIONS = STAFF_ADMIN_ROLES;

export const EnquiryDto = z.object({
  id: Uuid,
  reference: z.string(),
  childName: z.string(),
  classLevelId: Uuid,
  className: z.string(),
  parentName: z.string(),
  phone: Phone.or(z.string()),
  email: Email.nullable(),
  locality: z.string(),
  sessionId: Uuid,
  sessionLabel: z.string(),
  state: EnquiryState,
  applicationId: Uuid.nullable(),
  createdAt: IsoDateTime,
});
export type EnquiryDto = z.infer<typeof EnquiryDto>;

export const ApplicationListItem = z.object({
  id: Uuid,
  applicationNo: z.string(),
  status: ApplicationStatus,
  childName: z.string(),
  className: z.string(),
  parentName: z.string(),
  phone: z.string(),
  sessionLabel: z.string(),
  createdAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
});

export const ApplicationDetail = ApplicationListItem.extend({
  enquiryId: Uuid,
  form: ApplicationForm,
  documents: z.array(ApplicationDocumentDto.extend({ url: z.string() })),
  decisionNote: z.string().nullable(),
  decidedBy: z.object({ id: Uuid, displayName: z.string() }).nullable(),
  /** Set once the office has created the Student for an APPROVED application. */
  studentId: Uuid.nullable(),
});
export type ApplicationDetail = z.infer<typeof ApplicationDetail>;

export const InviteResult = z.object({
  /** Full stage-2 URL including the token. Shown ONCE; only a hash is stored. Reissue = new link, old one revoked. */
  link: z.string(),
  expiresAt: IsoDateTime,
  /** True if an email was on the enquiry and the link was mailed to it. */
  emailed: z.boolean(),
});

export const adminAdmissionRoutes = {
  enquiries: route({
    method: 'GET', path: '/admin/enquiries', access: roles(ADMISSIONS), summary: 'Stage-1 enquiries.',
    query: PageQuery.extend({ state: EnquiryState.optional(), sessionId: Uuid.optional(), q: z.string().trim().max(100).optional() }),
    response: Page(EnquiryDto),
  }),
  updateEnquiry: route({
    method: 'PATCH', path: '/admin/enquiries/:id', access: roles(ADMISSIONS), summary: 'Move an enquiry along (NEW -> CONTACTED -> ... -> CLOSED).',
    params: IdParam, body: z.strictObject({ state: EnquiryState }), response: EnquiryDto,
  }),
  invite: route({
    method: 'POST', path: '/admin/enquiries/:id/invite', access: roles(ADMISSIONS),
    summary: 'Issue (or reissue, revoking the old) the stage-2 tokenised link; emails it when an address exists; state -> INVITED_TO_APPLY.',
    params: IdParam, response: InviteResult,
  }),
  applications: route({
    method: 'GET', path: '/admin/applications', access: roles(ADMISSIONS), summary: 'Pipeline board data with filters.',
    query: PageQuery.extend({
      status: ApplicationStatus.optional(),
      sessionId: Uuid.optional(),
      classLevelId: Uuid.optional(),
      q: z.string().trim().max(100).optional(),
      from: DateOnly.optional(),
      to: DateOnly.optional(),
    }),
    response: Page(ApplicationListItem),
  }),
  exportApplications: route({
    method: 'GET', path: '/admin/applications/export', access: roles(ADMISSIONS),
    summary: 'Same filters as the list, as CSV (text/csv; UTF-8 with BOM for Excel). Cells beginning = + - @ are prefixed with a quote to defuse formula injection.',
    query: z.object({ status: ApplicationStatus.optional(), sessionId: Uuid.optional(), classLevelId: Uuid.optional(), q: z.string().trim().max(100).optional(), from: DateOnly.optional(), to: DateOnly.optional() }),
    responseKind: 'csv', response: z.unknown(),
  }),
  application: route({
    method: 'GET', path: '/admin/applications/:id', access: roles(ADMISSIONS), summary: 'Full application with documents (signed URLs).',
    params: IdParam, response: ApplicationDetail,
  }),
  setApplicationStatus: route({
    method: 'PATCH', path: '/admin/applications/:id/status', access: roles(ADMISSIONS),
    summary: 'SUBMITTED -> REVIEWED -> APPROVED | REJECTED (REVIEWED may also go back to SUBMITTED). `note` required for REJECTED. Audited.',
    params: IdParam,
    body: z.strictObject({ status: ApplicationStatus, note: z.string().trim().max(500).optional() })
      .refine((v) => v.status !== 'REJECTED' || !!v.note, { path: ['note'], message: 'A reason is required to reject' }),
    response: ApplicationDetail, status: 200,
  }),
  createStudentFromApplication: route({
    method: 'POST', path: '/admin/applications/:id/student', access: roles(ADMISSIONS),
    summary: 'Stage 3 handoff: only for APPROVED applications. Creates the Student (+ guardians/login, optional enrolment) prefilled from the form; 409 if one already exists. Sensitive data is NOT created here.',
    params: IdParam,
    body: z.strictObject({ admissionNo: z.string().trim().min(1).max(30), enrollment: EnrollInput.optional(), guardians: z.array(GuardianInput).max(4).optional() }),
    response: StudentCreated,
  }),
};

