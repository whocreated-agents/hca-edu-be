import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditEntryDto, Page } from '@hca/contracts';
import { decodeCursor, encodeCursor } from '../common/format';
import { PrismaService, type Db } from '../prisma.service';

export interface AuditEvent {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass the transaction client so the audit row commits or rolls back with the change it describes. */
  async record(e: AuditEvent, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        actorId: e.actorId,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        ...(e.before !== undefined ? { before: e.before as Prisma.InputJsonValue } : {}),
        ...(e.after !== undefined ? { after: e.after as Prisma.InputJsonValue } : {}),
        ip: e.ip ?? null,
      },
    });
  }

  /** Office reads; the log itself is append-only for everyone (enforced by a DB trigger, not here). */
  async list(q: { limit: number; cursor?: string; entity?: string; entityId?: string; actorId?: string; from?: string; to?: string }): Promise<Page<AuditEntryDto>> {
    const offset = decodeCursor(q.cursor);
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to ? { at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      include: { actor: { include: { staff: true } } },
      orderBy: { at: 'desc' },
      skip: offset,
      take: q.limit + 1,
    });
    const items: AuditEntryDto[] = rows.slice(0, q.limit).map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actor: r.actor ? { id: r.actor.id, displayName: r.actor.staff?.fullName ?? r.actor.email ?? 'Administrator', role: r.actor.role } : null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      before: r.before ?? null,
      after: r.after ?? null,
      ip: r.ip,
    }));
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }
}
