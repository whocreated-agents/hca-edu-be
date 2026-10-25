import { z } from 'zod';
import { DateOnly, IdParam, IsoDateTime, LongText, Page, PageQuery, ShortText, Uuid } from './common';
import { ConsentScope, MediaUsage, NoticeAudience, NoticeTag, STAFF_ADMIN_ROLES } from './enums';
import { AuditEntryDto } from './dto';
import { PublicProfile, FacilityDto, StatDto } from './public';
import { roles, route } from './route';

/**
 * Admin control plane, part 5: CMS (notices, content blocks, profile, facilities, stats), media and
 * photograph consent, audit log. BLUEPRINT-001 §2.7, §4, PHOTO-CONSENT-REQUIREMENTS.md.
 *
 * Writes that change what the public site shows trigger ISR revalidation server-side; the client
 * need do nothing.
 */

const WRITE = STAFF_ADMIN_ROLES;

// ---- Notices -------------------------------------------------------------------------------

export const NoticeAdminDto = z.object({
  id: Uuid,
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  tag: NoticeTag,
  audience: NoticeAudience,
  isPublished: z.boolean(),
  publishFrom: IsoDateTime,
  publishUntil: IsoDateTime.nullable(),
  isPinned: z.boolean(),
  targetSectionIds: z.array(Uuid),
  /** Derived server-side with the same predicate the public API uses. */
  isLive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type NoticeAdminDto = z.infer<typeof NoticeAdminDto>;

export const NoticeInput = z
  .strictObject({
    title: ShortText(200),
    body: LongText(20_000),
    tag: NoticeTag,
    audience: NoticeAudience.default('PUBLIC'),
    isPublished: z.boolean().default(false),
    publishFrom: IsoDateTime,
    /** Strongly encouraged for time-bound notices; null means "until unpublished". */
    publishUntil: IsoDateTime.nullable().default(null),
    isPinned: z.boolean().default(false),
    /** Only meaningful for audience PARENTS / STUDENTS. Empty = everyone in that audience. */
    targetSectionIds: z.array(Uuid).max(100).default([]),
  })
  .refine((v) => !v.publishUntil || new Date(v.publishUntil) > new Date(v.publishFrom), {
    path: ['publishUntil'],
    message: 'Must be after publishFrom',
  })
  .refine((v) => v.audience !== 'PUBLIC' || v.targetSectionIds.length === 0, {
    path: ['targetSectionIds'],
    message: 'Public notices cannot be targeted at sections',
  });

export const NoticeListQuery = PageQuery.extend({
  tag: NoticeTag.optional(),
  audience: NoticeAudience.optional(),
  state: z.enum(['live', 'scheduled', 'expired', 'draft']).optional(),
});

// ---- Content blocks, profile, facilities, stats --------------------------------------------

export const ContentBlockDto = z.object({
  key: z.string(),
  data: z.unknown(),
  updatedAt: IsoDateTime,
  updatedById: Uuid.nullable(),
});
export const ContentBlockKeyParam = z.object({ key: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/i, 'Like home.hero').max(100) });
export const ContentBlockInput = z.strictObject({ data: z.record(z.string(), z.unknown()) });

export const ProfileInput = z.strictObject({
  name: ShortText(150),
  addressLines: z.array(ShortText(200)).min(1).max(6),
  phones: z.array(ShortText(30)).min(1).max(6),
  email: z.email(),
  hours: ShortText(200),
  socials: z.record(z.string(), z.url()).default({}),
  foundedOn: DateOnly,
  board: ShortText(100),
  registrationNo: ShortText(60),
});

export const FacilityInput = z.strictObject({ title: ShortText(100), description: LongText(1000), order: z.number().int().min(0).max(999) });
export const StatInput = z.strictObject({ label: ShortText(100), value: ShortText(60), order: z.number().int().min(0).max(999) });

// ---- Media + consent -----------------------------------------------------------------------

export const MediaConsentDto = z.object({
  id: Uuid,
  assetId: Uuid,
  studentId: Uuid,
  studentName: z.string(),
  guardianId: Uuid,
  guardianName: z.string(),
  scope: ConsentScope,
  grantedOn: DateOnly,
  evidenceUrl: z.string().nullable(),
  withdrawnOn: DateOnly.nullable(),
  withdrawnReason: z.string().nullable(),
});

export const MediaAssetDto = z.object({
  id: Uuid,
  url: z.string(),
  caption: z.string().nullable(),
  containsIdentifiableChild: z.boolean(),
  usage: MediaUsage,
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  publishedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  consents: z.array(MediaConsentDto),
});
export type MediaAssetDto = z.infer<typeof MediaAssetDto>;

/** Multipart fields alongside the file. The boolean has no default: the uploader must answer. */
export const MediaUploadFields = z.strictObject({
  caption: z.string().trim().max(300).optional(),
  containsIdentifiableChild: z.stringbool(),
});

export const MediaUpdate = z.strictObject({
  caption: z.string().trim().max(300).nullable().optional(),
  containsIdentifiableChild: z.boolean().optional(),
  /** 422 MEDIA_CONSENT_REQUIRED if PUBLIC_SITE is requested while a tagged child lacks a live consent. */
  usage: MediaUsage.optional(),
});

export const MediaConsentInput = z.strictObject({
  studentId: Uuid,
  guardianId: Uuid,
  scope: ConsentScope,
  grantedOn: DateOnly,
});
export const MediaConsentWithdraw = z.strictObject({ reason: ShortText(300) });

export const MediaListQuery = PageQuery.extend({ usage: MediaUsage.optional() });

// ---- Audit ---------------------------------------------------------------------------------

export const AuditQuery = PageQuery.extend({
  entity: z.string().max(60).optional(),
  entityId: z.string().max(100).optional(),
  actorId: Uuid.optional(),
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
});

const SoftId = z.object({ id: Uuid });

export const adminContentRoutes = {
  notices: route({
    method: 'GET', path: '/admin/notices', access: roles(WRITE), summary: 'All notices including drafts, scheduled and expired.',
    query: NoticeListQuery, response: Page(NoticeAdminDto),
  }),
  notice: route({ method: 'GET', path: '/admin/notices/:id', access: roles(WRITE), summary: 'One notice.', params: IdParam, response: NoticeAdminDto }),
  createNotice: route({
    method: 'POST', path: '/admin/notices', access: roles(WRITE), summary: 'Create. Slug is derived from the title and made unique server-side.',
    body: NoticeInput, response: NoticeAdminDto,
  }),
  updateNotice: route({
    method: 'PUT', path: '/admin/notices/:id', access: roles(WRITE), summary: 'Replace. Revalidates public pages if the notice is or was live.',
    params: IdParam, body: NoticeInput, response: NoticeAdminDto,
  }),
  deleteNotice: route({ method: 'DELETE', path: '/admin/notices/:id', access: roles(WRITE), summary: 'Delete.', params: IdParam }),

  contentBlocks: route({ method: 'GET', path: '/admin/content', access: roles(WRITE), summary: 'All CMS blocks.', response: z.array(ContentBlockDto) }),
  putContentBlock: route({
    method: 'PUT', path: '/admin/content/:key', access: roles(WRITE), summary: 'Upsert a block. Audited with before/after.',
    params: ContentBlockKeyParam, body: ContentBlockInput, response: ContentBlockDto, status: 200,
  }),

  profile: route({ method: 'GET', path: '/admin/profile', access: roles(WRITE), summary: 'School facts register.', response: PublicProfile }),
  putProfile: route({ method: 'PUT', path: '/admin/profile', access: roles(WRITE), summary: 'Edit the facts register (singleton). There is no yearsOfService field.', body: ProfileInput, response: PublicProfile }),

  facilities: route({ method: 'GET', path: '/admin/facilities', access: roles(WRITE), summary: 'Facilities.', response: z.array(FacilityDto) }),
  createFacility: route({ method: 'POST', path: '/admin/facilities', access: roles(WRITE), summary: 'Add.', body: FacilityInput, response: FacilityDto }),
  updateFacility: route({ method: 'PUT', path: '/admin/facilities/:id', access: roles(WRITE), summary: 'Replace.', params: IdParam, body: FacilityInput, response: FacilityDto }),
  deleteFacility: route({ method: 'DELETE', path: '/admin/facilities/:id', access: roles(WRITE), summary: 'Delete.', params: IdParam }),

  stats: route({ method: 'GET', path: '/admin/stats', access: roles(WRITE), summary: 'Statistics.', response: z.array(StatDto) }),
  createStat: route({ method: 'POST', path: '/admin/stats', access: roles(WRITE), summary: 'Add.', body: StatInput, response: StatDto }),
  updateStat: route({ method: 'PUT', path: '/admin/stats/:id', access: roles(WRITE), summary: 'Replace.', params: IdParam, body: StatInput, response: StatDto }),
  deleteStat: route({ method: 'DELETE', path: '/admin/stats/:id', access: roles(WRITE), summary: 'Delete.', params: IdParam }),

  media: route({ method: 'GET', path: '/admin/media', access: roles(WRITE), summary: 'Media library with consent state.', query: MediaListQuery, response: Page(MediaAssetDto) }),
  uploadMedia: route({
    method: 'POST', path: '/admin/media', access: roles(WRITE),
    summary: 'Multipart: file + containsIdentifiableChild (required). Lands UNPUBLISHED; type sniffed from content.',
    body: MediaUploadFields, bodyKind: 'multipart', response: MediaAssetDto,
  }),
  updateMedia: route({
    method: 'PATCH', path: '/admin/media/:id', access: roles(WRITE),
    summary: 'Caption / flag / usage. Rejects PUBLIC_SITE for an identifiable child without live consent for every tagged child (422 MEDIA_CONSENT_REQUIRED).',
    params: IdParam, body: MediaUpdate, response: MediaAssetDto,
  }),
  deleteMedia: route({ method: 'DELETE', path: '/admin/media/:id', access: roles(WRITE), summary: 'Delete the asset and file.', params: IdParam }),
  addConsent: route({
    method: 'POST', path: '/admin/media/:id/consents', access: roles(WRITE),
    summary: 'Record a child tagged in the asset and the guardian consent that covers it.', params: IdParam, body: MediaConsentInput, response: MediaConsentDto,
  }),
  uploadConsentEvidence: route({
    method: 'PUT', path: '/admin/media-consents/:id/evidence', access: roles(WRITE),
    summary: 'Multipart: scan of the signed slip.', params: IdParam, bodyKind: 'multipart', body: z.strictObject({}), response: MediaConsentDto, status: 200,
  }),
  withdrawConsent: route({
    method: 'POST', path: '/admin/media-consents/:id/withdraw', access: roles(WRITE),
    summary: 'Withdraw. Immediately flips the asset to UNPUBLISHED and revalidates public pages.', params: SoftId, body: MediaConsentWithdraw, response: MediaConsentDto, status: 200,
  }),
};

export const adminAuditRoutes = {
  audit: route({
    method: 'GET', path: '/admin/audit', access: roles(WRITE), summary: 'Audit log, newest first. Office reads; the log is append-only for everyone.',
    query: AuditQuery, response: Page(AuditEntryDto),
  }),
};
