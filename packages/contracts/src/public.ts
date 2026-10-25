import { z } from 'zod';
import { DateOnly, Email, IsoDateTime, Money, Page, PageQuery, Phone, ShortText, Uuid } from './common';
import { DocumentKind, FeeFrequency, Gender, NoticeTag, ApplicationStatus } from './enums';
import { ClassLevelDto, SessionDto } from './dto';
import { publicAccess, route } from './route';

/**
 * Public (anonymous) surface — BLUEPRINT-001 §4 "Public". Everything here is cacheable read-only
 * content except the two write paths (enquiry, stage-2 application), which are rate-limited.
 * The static site fetches these at build/ISR time; none needs a browser session.
 */

/** The §12 facts register. `yearsOfService` is deliberately absent: compute with yearsSince(foundedOn). */
export const PublicProfile = z.object({
  name: z.string(),
  addressLines: z.array(z.string()),
  phones: z.array(z.string()),
  email: z.string(),
  hours: z.string(),
  socials: z.record(z.string(), z.string()),
  foundedOn: DateOnly,
  board: z.string(),
  registrationNo: z.string(),
});
export type PublicProfile = z.infer<typeof PublicProfile>;

export const FacilityDto = z.object({ id: Uuid, title: z.string(), description: z.string(), order: z.number().int() });
export const StatDto = z.object({ id: Uuid, label: z.string(), value: z.string(), order: z.number().int() });

export const PublicContent = z.object({
  /** `key` -> arbitrary JSON authored in the CMS (e.g. `home.hero`, `about.mission`). */
  blocks: z.record(z.string(), z.unknown()),
  facilities: z.array(FacilityDto),
  stats: z.array(StatDto),
});
export type PublicContent = z.infer<typeof PublicContent>;

export const PublicNotice = z.object({
  id: Uuid,
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  tag: NoticeTag,
  publishFrom: IsoDateTime,
  publishUntil: IsoDateTime.nullable(),
  isPinned: z.boolean(),
});
export type PublicNotice = z.infer<typeof PublicNotice>;

export const PublicFees = z.object({
  /** Null when no session is RUNNING; the page then shows no amounts rather than last year's. */
  session: SessionDto.nullable(),
  classes: z.array(
    z.object({
      classLevel: ClassLevelDto,
      heads: z.array(z.object({ name: z.string(), amount: Money, frequency: FeeFrequency })),
    }),
  ),
  /** Always false in V1: no gateway. The page renders "Online fee payment — coming soon". */
  onlinePaymentAvailable: z.literal(false),
});
export type PublicFees = z.infer<typeof PublicFees>;

export const PublicSession = z.object({
  running: SessionDto.nullable(),
  /** The session new enquiries attach to; null means the admissions form must show "closed". */
  admissionOpen: SessionDto.nullable(),
});

/** Stage 1: the six public fields. Nothing sensitive, ever. */
export const EnquiryRequest = z.strictObject({
  childName: ShortText(100),
  classLevelId: Uuid,
  parentName: ShortText(100),
  phone: Phone,
  email: Email.optional(),
  locality: ShortText(100),
  /** Honeypot. Real browsers leave it empty; a non-empty value is accepted silently and discarded. */
  website: z.string().max(200).optional(),
});
export type EnquiryRequest = z.input<typeof EnquiryRequest>;

export const EnquiryReceipt = z.object({
  /** Short human reference the parent can quote on the phone. */
  reference: z.string(),
});

// ---- Stage 2: tokenised application ---------------------------------------------------------

const Address = z.strictObject({
  line1: ShortText(200),
  line2: z.string().trim().max(200).optional(),
  city: ShortText(80),
  state: ShortText(80),
  pin: z.string().regex(/^\d{6}$/, 'Six-digit PIN'),
});

const ParentBlock = z.strictObject({
  fullName: ShortText(100),
  occupation: z.string().trim().max(100).optional(),
  phone: Phone,
  email: Email.optional(),
});

/**
 * The stage-2 form. Aadhaar, caste category, medical notes and income are NOT here (D2): they are
 * collected only after a seat is offered, via the staff-side StudentSensitive routes.
 */
export const ApplicationForm = z.strictObject({
  childDob: DateOnly,
  gender: Gender,
  address: Address,
  father: ParentBlock,
  mother: ParentBlock.optional(),
  guardian: ParentBlock.optional(),
  previousSchool: z
    .strictObject({ name: ShortText(150), lastClass: ShortText(40), reasonForLeaving: z.string().trim().max(300).optional() })
    .optional(),
  siblings: z
    .array(z.strictObject({ name: ShortText(100), className: ShortText(40) }))
    .max(8)
    .default([]),
  emergencyContact: z.strictObject({ name: ShortText(100), relation: ShortText(40), phone: Phone }),
});
export type ApplicationForm = z.input<typeof ApplicationForm>;

export const ApplicationDocumentDto = z.object({
  id: Uuid,
  kind: DocumentKind,
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  uploadedAt: IsoDateTime,
});
export type ApplicationDocumentDto = z.infer<typeof ApplicationDocumentDto>;

export const ApplicationView = z.object({
  applicationNo: z.string().nullable(),
  status: ApplicationStatus.nullable(),
  enquiry: z.object({ childName: z.string(), className: z.string(), parentName: z.string(), sessionLabel: z.string() }),
  form: ApplicationForm.nullable(),
  documents: z.array(ApplicationDocumentDto),
  /** False once the office has moved the application past SUBMITTED (APPLICATION_LOCKED on write). */
  editable: z.boolean(),
  linkExpiresAt: IsoDateTime,
});
export type ApplicationView = z.infer<typeof ApplicationView>;

export const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const APPLICATION_LINK_TTL_DAYS = 30;

const TokenParam = z.object({ token: z.string().min(20).max(200) });

export const publicRoutes = {
  profile: route({ method: 'GET', path: '/public/profile', access: publicAccess, summary: 'School facts register.', response: PublicProfile }),
  content: route({ method: 'GET', path: '/public/content', access: publicAccess, summary: 'CMS blocks, facilities and statistics.', response: PublicContent }),
  notices: route({
    method: 'GET', path: '/public/notices', access: publicAccess,
    summary: 'Live public notices: published, publishFrom <= now, publishUntil null or > now. Pinned first, then newest.',
    query: PageQuery.extend({ tag: NoticeTag.optional() }), response: Page(PublicNotice),
  }),
  notice: route({
    method: 'GET', path: '/public/notices/:slug', access: publicAccess,
    summary: 'One live public notice (404 once expired/unpublished).',
    params: z.object({ slug: z.string().min(1).max(200) }), response: PublicNotice,
  }),
  fees: route({ method: 'GET', path: '/public/fees', access: publicAccess, summary: 'Fee structure of the RUNNING session.', response: PublicFees }),
  session: route({ method: 'GET', path: '/public/session', access: publicAccess, summary: 'Running session and admission-open session.', response: PublicSession }),
  classLevels: route({
    method: 'GET', path: '/public/class-levels', access: publicAccess,
    summary: 'The 13 class levels, for the enquiry form dropdown.', response: z.array(ClassLevelDto),
  }),
  createEnquiry: route({
    method: 'POST', path: '/public/enquiries', access: publicAccess, sensitive: true,
    summary: 'Stage 1. Attaches to the admission-open session server-side; 409 NO_ADMISSION_SESSION_OPEN if none.',
    body: EnquiryRequest, response: EnquiryReceipt,
  }),
  getApplication: route({
    method: 'GET', path: '/public/applications/:token', access: publicAccess, sensitive: true,
    summary: 'Stage 2 by tokenised link (30-day TTL, scoped to one application). Bad/expired/revoked: 404 APPLICATION_LINK_INVALID.',
    params: TokenParam, response: ApplicationView,
  }),
  submitApplication: route({
    method: 'PUT', path: '/public/applications/:token', access: publicAccess, sensitive: true,
    summary: 'Submit (or re-submit while status is SUBMITTED) the stage-2 form. Idempotent. 409 APPLICATION_LOCKED after the office has reviewed it.',
    params: TokenParam, body: ApplicationForm, response: ApplicationView, status: 200,
  }),
  uploadApplicationDocument: route({
    method: 'POST', path: '/public/applications/:token/documents', access: publicAccess, sensitive: true,
    summary: `Multipart: field \`kind\` + file. Max ${DOCUMENT_MAX_BYTES} bytes; type sniffed from content (jpeg/png/pdf).`,
    params: TokenParam, body: z.strictObject({ kind: DocumentKind }), bodyKind: 'multipart', response: ApplicationDocumentDto,
  }),
  deleteApplicationDocument: route({
    method: 'DELETE', path: '/public/applications/:token/documents/:docId', access: publicAccess, sensitive: true,
    summary: 'Remove an uploaded document while the application is still editable.',
    params: TokenParam.extend({ docId: Uuid }),
  }),
};
