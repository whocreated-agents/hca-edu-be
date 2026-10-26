import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ContentBlockDto,
  ContentBlockInput,
  FacilityDto,
  FacilityInput,
  NoticeAdminDto,
  NoticeInput,
  NoticeListQuery,
  Page,
  ProfileInput,
  PublicProfile,
  StatDto,
  StatInput,
} from '@hca/contracts';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.service';
import { dateOnly, decodeCursor, encodeCursor } from '../common/format';
import { Problem } from '../common/problem';
import { PrismaService, type Db } from '../prisma.service';

const noticeInclude = { targets: true } satisfies Prisma.NoticeInclude;
type NoticeRow = Prisma.NoticeGetPayload<{ include: typeof noticeInclude }>;

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'notice';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ---- notices --------------------------------------------------------------------------------

  private isLive(n: { isPublished: boolean; publishFrom: Date; publishUntil: Date | null }, now: Date): boolean {
    return n.isPublished && n.publishFrom <= now && (n.publishUntil === null || n.publishUntil > now);
  }

  private toAdminDto(n: NoticeRow): NoticeAdminDto {
    const now = new Date();
    return {
      id: n.id,
      slug: n.slug,
      title: n.title,
      body: n.body,
      tag: n.tag,
      audience: n.audience,
      isPublished: n.isPublished,
      publishFrom: n.publishFrom.toISOString(),
      publishUntil: n.publishUntil?.toISOString() ?? null,
      isPinned: n.isPinned,
      targetSectionIds: n.targets.map((t) => t.sectionId),
      isLive: this.isLive(n, now),
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    };
  }

  async notices(q: NoticeListQuery & { limit: number; cursor?: string }): Promise<Page<NoticeAdminDto>> {
    const offset = decodeCursor(q.cursor);
    const now = new Date();
    const stateFilter: Prisma.NoticeWhereInput =
      q.state === 'live'
        ? { isPublished: true, publishFrom: { lte: now }, OR: [{ publishUntil: null }, { publishUntil: { gt: now } }] }
        : q.state === 'expired'
          ? { publishUntil: { lte: now } }
          : q.state === 'scheduled'
            ? { isPublished: true, publishFrom: { gt: now } }
            : q.state === 'draft'
              ? { isPublished: false }
              : {};
    const where: Prisma.NoticeWhereInput = { ...(q.tag ? { tag: q.tag } : {}), ...(q.audience ? { audience: q.audience } : {}), ...stateFilter };
    const rows = await this.prisma.notice.findMany({ where, include: noticeInclude, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], skip: offset, take: q.limit + 1 });
    const items = rows.slice(0, q.limit).map((n) => this.toAdminDto(n));
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }

  async notice(id: string): Promise<NoticeAdminDto> {
    const row = await this.prisma.notice.findUnique({ where: { id }, include: noticeInclude });
    if (!row) throw Problem.notFound();
    return this.toAdminDto(row);
  }

  private async uniqueSlug(title: string, db: Db, excludeId?: string): Promise<string> {
    const base = slugify(title);
    let candidate = base;
    let n = 1;
    for (;;) {
      const clash = await db.notice.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) } });
      if (!clash) return candidate;
      n += 1;
      candidate = `${base}-${n}`;
    }
  }

  async createNotice(actor: Actor, body: NoticeInput, ip: string | null): Promise<NoticeAdminDto> {
    return this.prisma.$transaction(async (tx) => {
      const slug = await this.uniqueSlug(body.title, tx);
      const row = await tx.notice.create({
        data: {
          title: body.title,
          slug,
          body: body.body,
          tag: body.tag,
          audience: body.audience,
          isPublished: body.isPublished,
          publishFrom: toDate2(body.publishFrom),
          publishUntil: body.publishUntil ? toDate2(body.publishUntil) : null,
          isPinned: body.isPinned,
          createdById: actor.id,
          targets: { create: (body.targetSectionIds ?? []).map((sectionId) => ({ sectionId })) },
        },
        include: noticeInclude,
      });
      await this.audit.record({ actorId: actor.id, action: 'notice.create', entity: 'Notice', entityId: row.id, after: { title: row.title, tag: row.tag }, ip }, tx);
      return this.toAdminDto(row);
    });
  }

  async updateNotice(actor: Actor, id: string, body: NoticeInput, ip: string | null): Promise<NoticeAdminDto> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.notice.findUnique({ where: { id }, include: noticeInclude });
      if (!existing) throw Problem.notFound();
      const slug = existing.title === body.title ? existing.slug : await this.uniqueSlug(body.title, tx, id);
      await tx.noticeTarget.deleteMany({ where: { noticeId: id } });
      const row = await tx.notice.update({
        where: { id },
        data: {
          title: body.title,
          slug,
          body: body.body,
          tag: body.tag,
          audience: body.audience,
          isPublished: body.isPublished,
          publishFrom: toDate2(body.publishFrom),
          publishUntil: body.publishUntil ? toDate2(body.publishUntil) : null,
          isPinned: body.isPinned,
          targets: { create: (body.targetSectionIds ?? []).map((sectionId) => ({ sectionId })) },
        },
        include: noticeInclude,
      });
      await this.audit.record({ actorId: actor.id, action: 'notice.update', entity: 'Notice', entityId: id, before: this.toAdminDto(existing), after: this.toAdminDto(row), ip }, tx);
      return this.toAdminDto(row);
    });
  }

  async deleteNotice(actor: Actor, id: string, ip: string | null): Promise<void> {
    const existing = await this.prisma.notice.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    await this.prisma.notice.delete({ where: { id } });
    await this.audit.record({ actorId: actor.id, action: 'notice.delete', entity: 'Notice', entityId: id, before: { title: existing.title }, ip });
  }

  // ---- content blocks ---------------------------------------------------------------------------

  async contentBlocks(): Promise<ContentBlockDto[]> {
    const rows = await this.prisma.contentBlock.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => ({ key: r.key, data: r.data, updatedAt: r.updatedAt.toISOString(), updatedById: r.updatedById }));
  }

  async putContentBlock(actor: Actor, key: string, body: ContentBlockInput, ip: string | null): Promise<ContentBlockDto> {
    const existing = await this.prisma.contentBlock.findUnique({ where: { key } });
    const row = await this.prisma.contentBlock.upsert({
      where: { key },
      create: { key, data: body.data as Prisma.InputJsonValue, updatedById: actor.id },
      update: { data: body.data as Prisma.InputJsonValue, updatedById: actor.id },
    });
    await this.audit.record({ actorId: actor.id, action: 'content.put', entity: 'ContentBlock', entityId: key, before: existing?.data, after: row.data, ip });
    return { key: row.key, data: row.data, updatedAt: row.updatedAt.toISOString(), updatedById: row.updatedById };
  }

  // ---- school profile ----------------------------------------------------------------------------

  async profile(): Promise<PublicProfile> {
    const row = await this.prisma.schoolProfile.findUnique({ where: { id: 1 } });
    if (!row) throw Problem.notFound('School profile has not been set up yet');
    return this.toProfile(row);
  }

  private toProfile(row: { name: string; addressLines: string[]; phones: string[]; email: string; hours: string; socials: Prisma.JsonValue; foundedOn: Date; board: string; registrationNo: string }): PublicProfile {
    return {
      name: row.name,
      addressLines: row.addressLines,
      phones: row.phones,
      email: row.email,
      hours: row.hours,
      socials: row.socials as Record<string, string>,
      foundedOn: dateOnly(row.foundedOn),
      board: row.board,
      registrationNo: row.registrationNo,
    };
  }

  async putProfile(actor: Actor, body: ProfileInput, ip: string | null): Promise<PublicProfile> {
    const existing = await this.prisma.schoolProfile.findUnique({ where: { id: 1 } });
    const data = {
      name: body.name,
      addressLines: body.addressLines,
      phones: body.phones,
      email: body.email,
      hours: body.hours,
      socials: body.socials as Prisma.InputJsonValue,
      foundedOn: toDate2(body.foundedOn),
      board: body.board,
      registrationNo: body.registrationNo,
    };
    const row = await this.prisma.schoolProfile.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await this.audit.record({ actorId: actor.id, action: 'profile.put', entity: 'SchoolProfile', entityId: '1', before: existing ? this.toProfile(existing) : null, after: this.toProfile(row), ip });
    return this.toProfile(row);
  }

  // ---- facilities ---------------------------------------------------------------------------------

  async facilities(): Promise<FacilityDto[]> {
    const rows = await this.prisma.facility.findMany({ orderBy: { order: 'asc' } });
    return rows.map((f) => ({ id: f.id, title: f.title, description: f.description, order: f.order }));
  }

  async createFacility(actor: Actor, body: FacilityInput, ip: string | null): Promise<FacilityDto> {
    const row = await this.prisma.facility.create({ data: body });
    await this.audit.record({ actorId: actor.id, action: 'facility.create', entity: 'Facility', entityId: row.id, after: body, ip });
    return { id: row.id, title: row.title, description: row.description, order: row.order };
  }

  async updateFacility(actor: Actor, id: string, body: FacilityInput, ip: string | null): Promise<FacilityDto> {
    const existing = await this.prisma.facility.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    const row = await this.prisma.facility.update({ where: { id }, data: body });
    await this.audit.record({ actorId: actor.id, action: 'facility.update', entity: 'Facility', entityId: id, before: existing, after: body, ip });
    return { id: row.id, title: row.title, description: row.description, order: row.order };
  }

  async deleteFacility(actor: Actor, id: string, ip: string | null): Promise<void> {
    const existing = await this.prisma.facility.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    await this.prisma.facility.delete({ where: { id } });
    await this.audit.record({ actorId: actor.id, action: 'facility.delete', entity: 'Facility', entityId: id, before: existing, ip });
  }

  // ---- stats ----------------------------------------------------------------------------------------

  async stats(): Promise<StatDto[]> {
    const rows = await this.prisma.stat.findMany({ orderBy: { order: 'asc' } });
    return rows.map((s) => ({ id: s.id, label: s.label, value: s.value, order: s.order }));
  }

  async createStat(actor: Actor, body: StatInput, ip: string | null): Promise<StatDto> {
    const row = await this.prisma.stat.create({ data: body });
    await this.audit.record({ actorId: actor.id, action: 'stat.create', entity: 'Stat', entityId: row.id, after: body, ip });
    return { id: row.id, label: row.label, value: row.value, order: row.order };
  }

  async updateStat(actor: Actor, id: string, body: StatInput, ip: string | null): Promise<StatDto> {
    const existing = await this.prisma.stat.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    const row = await this.prisma.stat.update({ where: { id }, data: body });
    await this.audit.record({ actorId: actor.id, action: 'stat.update', entity: 'Stat', entityId: id, before: existing, after: body, ip });
    return { id: row.id, label: row.label, value: row.value, order: row.order };
  }

  async deleteStat(actor: Actor, id: string, ip: string | null): Promise<void> {
    const existing = await this.prisma.stat.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    await this.prisma.stat.delete({ where: { id } });
    await this.audit.record({ actorId: actor.id, action: 'stat.delete', entity: 'Stat', entityId: id, before: existing, ip });
  }
}

/** Accepts either a DateOnly string or an IsoDateTime string (NoticeInput.publishFrom/Until are IsoDateTime). */
function toDate2(s: string): Date {
  return new Date(s);
}
