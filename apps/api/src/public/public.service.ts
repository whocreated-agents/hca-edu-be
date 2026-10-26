import { Injectable } from '@nestjs/common';
import type { ClassLevelDto, Page, PublicContent, PublicFees, PublicNotice, PublicProfile, PublicSession } from '@hca/contracts';
import { toClassLevelDto, toSessionDto } from '../common/mappers';
import { dateOnly, decodeCursor, encodeCursor, money } from '../common/format';
import { Problem } from '../common/problem';
import { PrismaService } from '../prisma.service';

/**
 * Public (anonymous) reads: profile, CMS content, notices, fee structure, session, class levels.
 * Visibility of notices is derived at query time (isPublished AND publishFrom <= now AND
 * (publishUntil IS NULL OR publishUntil > now)) so a missed sweep job can never leave an expired
 * notice live -- BLUEPRINT-001 §2.7.
 */
@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  async classLevels(): Promise<ClassLevelDto[]> {
    const rows = await this.prisma.classLevel.findMany({ orderBy: { order: 'asc' } });
    return rows.map(toClassLevelDto);
  }

  async session(): Promise<PublicSession> {
    const [running, admissionOpen] = await Promise.all([
      this.prisma.academicSession.findFirst({ where: { state: 'RUNNING' } }),
      this.prisma.academicSession.findFirst({ where: { isAdmissionOpen: true } }),
    ]);
    return { running: running ? toSessionDto(running) : null, admissionOpen: admissionOpen ? toSessionDto(admissionOpen) : null };
  }

  async profile(): Promise<PublicProfile> {
    const row = await this.prisma.schoolProfile.findUnique({ where: { id: 1 } });
    if (!row) throw Problem.notFound('School profile has not been set up yet');
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

  async content(): Promise<PublicContent> {
    const [blocks, facilities, stats] = await Promise.all([
      this.prisma.contentBlock.findMany(),
      this.prisma.facility.findMany({ orderBy: { order: 'asc' } }),
      this.prisma.stat.findMany({ orderBy: { order: 'asc' } }),
    ]);
    return {
      blocks: Object.fromEntries(blocks.map((b) => [b.key, b.data])),
      facilities: facilities.map((f) => ({ id: f.id, title: f.title, description: f.description, order: f.order })),
      stats: stats.map((s) => ({ id: s.id, label: s.label, value: s.value, order: s.order })),
    };
  }

  /** The predicate behind every "live" notice view, public or admin. */
  private static liveWhere(now: Date) {
    return { isPublished: true, publishFrom: { lte: now }, OR: [{ publishUntil: null }, { publishUntil: { gt: now } }] };
  }

  async notices(q: { limit: number; cursor?: string; tag?: string }): Promise<Page<PublicNotice>> {
    const now = new Date();
    const offset = decodeCursor(q.cursor);
    const where = {
      audience: 'PUBLIC' as const,
      ...PublicService.liveWhere(now),
      ...(q.tag ? { tag: q.tag as never } : {}),
    };
    const rows = await this.prisma.notice.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { publishFrom: 'desc' }],
      skip: offset,
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map((n) => this.toPublicNotice(n));
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }

  async notice(slug: string): Promise<PublicNotice> {
    const now = new Date();
    const row = await this.prisma.notice.findFirst({ where: { slug, audience: 'PUBLIC', ...PublicService.liveWhere(now) } });
    if (!row) throw Problem.notFound();
    return this.toPublicNotice(row);
  }

  private toPublicNotice(n: { id: string; slug: string; title: string; body: string; tag: string; publishFrom: Date; publishUntil: Date | null; isPinned: boolean }): PublicNotice {
    return {
      id: n.id,
      slug: n.slug,
      title: n.title,
      body: n.body,
      tag: n.tag as PublicNotice['tag'],
      publishFrom: n.publishFrom.toISOString(),
      publishUntil: n.publishUntil?.toISOString() ?? null,
      isPinned: n.isPinned,
    };
  }

  async fees(): Promise<PublicFees> {
    const session = await this.prisma.academicSession.findFirst({ where: { state: 'RUNNING' } });
    if (!session) return { session: null, classes: [], onlinePaymentAvailable: false };
    const rows = await this.prisma.feeStructure.findMany({
      where: { sessionId: session.id },
      include: { classLevel: true, feeHead: true },
      orderBy: [{ classLevel: { order: 'asc' } }],
    });
    const byClass = new Map<string, { classLevel: ClassLevelDto; heads: { name: string; amount: string; frequency: PublicFees['classes'][number]['heads'][number]['frequency'] }[] }>();
    for (const r of rows) {
      const existing = byClass.get(r.classLevelId) ?? { classLevel: toClassLevelDto(r.classLevel), heads: [] };
      existing.heads.push({ name: r.feeHead.name, amount: money(r.amount), frequency: r.frequency });
      byClass.set(r.classLevelId, existing);
    }
    return { session: toSessionDto(session), classes: [...byClass.values()], onlinePaymentAvailable: false };
  }
}
