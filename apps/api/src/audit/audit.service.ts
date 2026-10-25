import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
}
