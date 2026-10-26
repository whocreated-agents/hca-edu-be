import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FeeHeadDto,
  FeeHeadInput,
  FeeStructureRow,
  FeeStructureUpsert,
  InvoiceGenerate,
  InvoiceGenerateResult,
  PaymentDetail,
  PaymentInput,
} from '@hca/contracts';
import type { InvoiceDto } from '@hca/contracts';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.service';
import { dateOnly, decodeCursor, encodeCursor, money, toDate } from '../common/format';
import { Problem } from '../common/problem';
import { PrismaService, type Db } from '../prisma.service';

const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const isFkViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';

const invoiceInclude = { lines: { include: { feeHead: true } }, payments: true, student: true } satisfies Prisma.FeeInvoiceInclude;
type InvoiceRow = Prisma.FeeInvoiceGetPayload<{ include: typeof invoiceInclude }>;

const zero = new Prisma.Decimal(0);

@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ================================================================================================
  // Fee heads
  // ================================================================================================

  async feeHeads(): Promise<FeeHeadDto[]> {
    const rows = await this.prisma.feeHead.findMany({ orderBy: { name: 'asc' } });
    return rows.map((h) => ({ id: h.id, name: h.name, isRecurring: h.isRecurring }));
  }

  async createFeeHead(body: FeeHeadInput): Promise<FeeHeadDto> {
    try {
      const row = await this.prisma.feeHead.create({ data: { name: body.name, isRecurring: body.isRecurring ?? true } });
      return { id: row.id, name: row.name, isRecurring: row.isRecurring };
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('A fee head with that name already exists');
      throw e;
    }
  }

  async updateFeeHead(id: string, body: Partial<FeeHeadInput>): Promise<FeeHeadDto> {
    const existing = await this.prisma.feeHead.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    try {
      const row = await this.prisma.feeHead.update({
        where: { id },
        data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.isRecurring !== undefined ? { isRecurring: body.isRecurring } : {}) },
      });
      return { id: row.id, name: row.name, isRecurring: row.isRecurring };
    } catch (e) {
      if (isUniqueViolation(e)) throw Problem.conflict('A fee head with that name already exists');
      throw e;
    }
  }

  async deleteFeeHead(id: string): Promise<void> {
    const existing = await this.prisma.feeHead.findUnique({ where: { id } });
    if (!existing) throw Problem.notFound();
    try {
      await this.prisma.feeHead.delete({ where: { id } });
    } catch (e) {
      if (isFkViolation(e)) throw Problem.conflict('This fee head is used by a fee structure or an invoice and cannot be removed');
      throw e;
    }
  }

  // ================================================================================================
  // Fee structure (admin-entered; no amount ever ships in code or seed)
  // ================================================================================================

  async structure(q: { sessionId?: string; classLevelId?: string }): Promise<FeeStructureRow[]> {
    const sessionId = q.sessionId ?? (await this.prisma.academicSession.findFirst({ where: { state: 'RUNNING' }, select: { id: true } }))?.id;
    if (!sessionId) return [];
    const rows = await this.prisma.feeStructure.findMany({
      where: { sessionId, ...(q.classLevelId ? { classLevelId: q.classLevelId } : {}) },
      include: { feeHead: true },
      orderBy: { feeHead: { name: 'asc' } },
    });
    return rows.map((r) => this.toStructureRow(r));
  }

  private toStructureRow(r: Prisma.FeeStructureGetPayload<{ include: { feeHead: true } }>): FeeStructureRow {
    return { id: r.id, sessionId: r.sessionId, classLevelId: r.classLevelId, feeHeadId: r.feeHeadId, feeHeadName: r.feeHead.name, amount: money(r.amount), frequency: r.frequency, dueDayOfMonth: r.dueDayOfMonth };
  }

  async putStructure(body: FeeStructureUpsert): Promise<FeeStructureRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const existingRows = await tx.feeStructure.findMany({ where: { sessionId: body.sessionId, classLevelId: body.classLevelId } });
      const keepHeadIds = new Set(body.rows.map((r) => r.feeHeadId));
      for (const existing of existingRows) {
        if (keepHeadIds.has(existing.feeHeadId)) continue;
        const refCount = await tx.feeInvoiceLine.count({ where: { feeHeadId: existing.feeHeadId, invoice: { sessionId: body.sessionId, studentId: undefined } } });
        if (refCount > 0) throw Problem.conflict('One of the removed fee heads is already referenced by an invoice for this session; it cannot be removed');
        await tx.feeStructure.delete({ where: { id: existing.id } });
      }
      for (const row of body.rows) {
        await tx.feeStructure.upsert({
          where: { sessionId_classLevelId_feeHeadId: { sessionId: body.sessionId, classLevelId: body.classLevelId, feeHeadId: row.feeHeadId } },
          create: { sessionId: body.sessionId, classLevelId: body.classLevelId, feeHeadId: row.feeHeadId, amount: row.amount, frequency: row.frequency, dueDayOfMonth: row.dueDayOfMonth ?? null },
          update: { amount: row.amount, frequency: row.frequency, dueDayOfMonth: row.dueDayOfMonth ?? null },
        });
      }
      const rows = await tx.feeStructure.findMany({ where: { sessionId: body.sessionId, classLevelId: body.classLevelId }, include: { feeHead: true } });
      return rows.map((r) => this.toStructureRow(r));
    });
  }

  // ================================================================================================
  // Invoices
  // ================================================================================================

  private paidSoFar(invoice: Pick<InvoiceRow, 'payments'>): Prisma.Decimal {
    return invoice.payments.filter((p) => !p.voidedAt).reduce((s, p) => s.plus(p.amount), zero);
  }

  private toInvoiceDto(row: InvoiceRow): InvoiceDto {
    const paid = this.paidSoFar(row);
    const amountDue = new Prisma.Decimal(row.amountDue);
    const balance = amountDue.minus(paid);
    const isOverdue = row.status !== 'WAIVED' && row.status !== 'PAID' && row.dueOn < new Date() && balance.greaterThan(0);
    return {
      id: row.id,
      studentId: row.studentId,
      sessionId: row.sessionId,
      periodLabel: row.periodLabel,
      amountDue: money(row.amountDue),
      amountPaid: money(paid),
      balance: money(balance),
      dueOn: dateOnly(row.dueOn),
      isOverdue,
      status: row.status,
      waivedReason: row.waivedReason,
      lines: row.lines.map((l) => ({ feeHeadId: l.feeHeadId, feeHeadName: l.feeHead.name, amount: money(l.amount) })),
      payments: row.payments.map((p) => ({ id: p.id, receiptNo: p.receiptNo, amount: money(p.amount), paidOn: dateOnly(p.paidOn), mode: p.mode, reference: p.reference, voided: p.voidedAt !== null, voidReason: p.voidReason })),
    };
  }

  async invoices(q: { limit: number; cursor?: string; sessionId?: string; studentId?: string; sectionId?: string; classLevelId?: string; status?: string; overdue?: boolean; periodLabel?: string }) {
    const offset = decodeCursor(q.cursor);
    const where: Prisma.FeeInvoiceWhereInput = {
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.periodLabel ? { periodLabel: q.periodLabel } : {}),
      ...(q.overdue ? { dueOn: { lt: new Date() }, status: { in: ['PENDING', 'PARTIAL'] } } : {}),
      ...(q.sectionId || q.classLevelId
        ? { student: { enrollments: { some: { ...(q.sectionId ? { sectionId: q.sectionId } : {}), ...(q.classLevelId ? { section: { classLevelId: q.classLevelId } } : {}) } } } }
        : {}),
    };
    const rows = await this.prisma.feeInvoice.findMany({ where, include: invoiceInclude, orderBy: { dueOn: 'desc' }, skip: offset, take: q.limit + 1 });
    const studentEnrollments = await this.prisma.enrollment.findMany({
      where: { studentId: { in: rows.map((r) => r.studentId) } },
      include: { section: { include: { classLevel: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const classBySession = new Map<string, { className: string; sectionName: string }>();
    for (const e of studentEnrollments) {
      const key = `${e.studentId}:${e.sessionId}`;
      if (!classBySession.has(key)) classBySession.set(key, { className: e.section.classLevel.name, sectionName: e.section.name });
    }
    const items = rows.slice(0, q.limit).map((r) => {
      const dto = this.toInvoiceDto(r);
      const cls = classBySession.get(`${r.studentId}:${r.sessionId}`);
      return { ...dto, studentName: r.student.fullName, admissionNo: r.student.admissionNo, className: cls?.className ?? null, sectionName: cls?.sectionName ?? null };
    });
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }

  async invoice(id: string): Promise<InvoiceDto> {
    const row = await this.prisma.feeInvoice.findUnique({ where: { id }, include: invoiceInclude });
    if (!row) throw Problem.notFound();
    return this.toInvoiceDto(row);
  }

  async generateInvoices(body: InvoiceGenerate): Promise<InvoiceGenerateResult> {
    const session = await this.prisma.academicSession.findUnique({ where: { id: body.sessionId } });
    if (!session) throw Problem.notFound('No such session');

    const enrollmentWhere: Prisma.EnrollmentWhereInput = {
      sessionId: body.sessionId,
      state: 'ACTIVE',
      ...(body.classLevelIds?.length ? { section: { classLevelId: { in: body.classLevelIds } } } : {}),
      ...(body.sectionIds?.length ? { sectionId: { in: body.sectionIds } } : {}),
      ...(body.studentIds?.length ? { studentId: { in: body.studentIds } } : {}),
    };
    const enrollments = await this.prisma.enrollment.findMany({ where: enrollmentWhere, include: { section: true } });

    let created = 0;
    let skippedExisting = 0;
    let skippedNoStructure = 0;

    for (const e of enrollments) {
      const structureRows = await this.prisma.feeStructure.findMany({
        where: { sessionId: body.sessionId, classLevelId: e.section.classLevelId, ...(body.feeHeadIds?.length ? { feeHeadId: { in: body.feeHeadIds } } : {}) },
      });
      if (structureRows.length === 0) {
        skippedNoStructure += 1;
        continue;
      }
      const amountDue = structureRows.reduce((s, r) => s.plus(r.amount), zero);
      try {
        await this.prisma.feeInvoice.create({
          data: {
            studentId: e.studentId,
            sessionId: body.sessionId,
            periodLabel: body.periodLabel,
            amountDue,
            dueOn: toDate(body.dueOn),
            status: 'PENDING',
            lines: { create: structureRows.map((r) => ({ feeHeadId: r.feeHeadId, amount: r.amount })) },
          },
        });
        created += 1;
      } catch (e2) {
        if (isUniqueViolation(e2)) {
          skippedExisting += 1;
          continue;
        }
        throw e2;
      }
    }
    return { created, skippedExisting, skippedNoStructure };
  }

  async waiveInvoice(actor: Actor, id: string, reason: string, ip: string | null): Promise<InvoiceDto> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.feeInvoice.findUnique({ where: { id }, include: invoiceInclude });
      if (!existing) throw Problem.notFound();
      if (existing.status === 'WAIVED') return this.toInvoiceDto(existing);
      const row = await tx.feeInvoice.update({ where: { id }, data: { status: 'WAIVED', waivedReason: reason }, include: invoiceInclude });
      await this.audit.record({ actorId: actor.id, action: 'invoice.waive', entity: 'FeeInvoice', entityId: id, before: { status: existing.status }, after: { reason }, ip }, tx);
      return this.toInvoiceDto(row);
    });
  }

  // ================================================================================================
  // Payments -- gapless receipt numbering, idempotent on requestId
  // ================================================================================================

  private async loadPaymentDetail(db: Db, paymentId: string): Promise<PaymentDetail> {
    const p = await db.feePayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { invoice: { include: invoiceInclude }, recordedBy: { include: { staff: true } } },
    });
    const invoice = p.invoice;
    const enrollment = await db.enrollment.findFirst({ where: { studentId: invoice.studentId, sessionId: invoice.sessionId }, include: { section: { include: { classLevel: true } } } });
    const session = await db.academicSession.findUniqueOrThrow({ where: { id: invoice.sessionId } });
    const paid = this.paidSoFar(invoice);
    const balance = new Prisma.Decimal(invoice.amountDue).minus(paid);
    return {
      id: p.id,
      receiptNo: p.receiptNo,
      amount: money(p.amount),
      paidOn: dateOnly(p.paidOn),
      mode: p.mode,
      reference: p.reference,
      voided: p.voidedAt !== null,
      voidReason: p.voidReason,
      invoiceId: p.invoiceId,
      studentId: invoice.studentId,
      studentName: invoice.student.fullName,
      admissionNo: invoice.student.admissionNo,
      className: enrollment?.section.classLevel.name ?? 'Unknown',
      periodLabel: invoice.periodLabel,
      sessionLabel: session.label,
      recordedBy: p.recordedBy.staff?.fullName ?? p.recordedBy.email ?? 'Administrator',
      requestId: p.requestId,
      balanceAfter: money(balance),
    };
  }

  async payments(q: { limit: number; cursor?: string; sessionId?: string; studentId?: string; from?: string; to?: string; mode?: string; includeVoided?: boolean }) {
    const offset = decodeCursor(q.cursor);
    const where: Prisma.FeePaymentWhereInput = {
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(q.studentId ? { invoice: { studentId: q.studentId } } : {}),
      ...(q.mode ? { mode: q.mode as never } : {}),
      ...(!q.includeVoided ? { voidedAt: null } : {}),
      ...(q.from || q.to ? { paidOn: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}),
    };
    const rows = await this.prisma.feePayment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: q.limit + 1, select: { id: true } });
    const items = await Promise.all(rows.slice(0, q.limit).map((r) => this.loadPaymentDetail(this.prisma, r.id)));
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
  }

  async payment(id: string): Promise<PaymentDetail> {
    const existing = await this.prisma.feePayment.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw Problem.notFound();
    return this.loadPaymentDetail(this.prisma, id);
  }

  async recordPayment(actor: Actor, invoiceId: string, body: PaymentInput, ip: string | null): Promise<PaymentDetail> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotency: a retried/double-clicked submit with the same requestId returns the original receipt.
      const already = await tx.feePayment.findUnique({ where: { requestId: body.requestId } });
      if (already) {
        if (already.invoiceId !== invoiceId) throw Problem.conflict('That request id was already used to record a different payment');
        return this.loadPaymentDetail(tx, already.id);
      }

      const invoice = await tx.feeInvoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude });
      if (!invoice) throw Problem.notFound();
      if (invoice.status === 'WAIVED') throw new Problem({ status: 409, code: 'INVOICE_NOT_PAYABLE', detail: 'This invoice has been waived' });

      const paidSoFar = this.paidSoFar(invoice);
      const amount = new Prisma.Decimal(body.amount);
      if (paidSoFar.plus(amount).greaterThan(invoice.amountDue)) {
        throw new Problem({ status: 422, code: 'PAYMENT_EXCEEDS_BALANCE', detail: 'This payment would exceed the amount due on the invoice' });
      }

      // Serialises every writer for this session's receipt sequence; see attendance.service.ts for the same pattern.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fee-receipt:${invoice.sessionId}`}, 0))`;
      const counter = await tx.receiptCounter.upsert({ where: { sessionId: invoice.sessionId }, create: { sessionId: invoice.sessionId, next: 1 }, update: {} });
      const seq = counter.next;
      await tx.receiptCounter.update({ where: { sessionId: invoice.sessionId }, data: { next: seq + 1 } });
      const session = await tx.academicSession.findUniqueOrThrow({ where: { id: invoice.sessionId } });
      const receiptNo = `${session.label}/${String(seq).padStart(5, '0')}`;

      const payment = await tx.feePayment.create({
        data: {
          invoiceId,
          amount: body.amount,
          paidOn: toDate(body.paidOn),
          mode: body.mode,
          reference: body.reference ?? null,
          recordedById: actor.id,
          sessionId: invoice.sessionId,
          receiptSeq: seq,
          receiptNo,
          requestId: body.requestId,
        },
      });

      const newPaid = paidSoFar.plus(amount);
      const status = newPaid.greaterThanOrEqualTo(invoice.amountDue) ? 'PAID' : 'PARTIAL';
      await tx.feeInvoice.update({ where: { id: invoiceId }, data: { status } });
      await this.audit.record({ actorId: actor.id, action: 'payment.record', entity: 'FeePayment', entityId: payment.id, after: { receiptNo, amount: body.amount }, ip }, tx);

      return this.loadPaymentDetail(tx, payment.id);
    });
  }

  async voidPayment(actor: Actor, id: string, reason: string, ip: string | null): Promise<PaymentDetail> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.feePayment.findUnique({ where: { id } });
      if (!payment) throw Problem.notFound();
      if (payment.voidedAt) return this.loadPaymentDetail(tx, id);

      await tx.feePayment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
      const invoice = await tx.feeInvoice.findUniqueOrThrow({ where: { id: payment.invoiceId }, include: invoiceInclude });
      const paid = this.paidSoFar(invoice);
      const status = paid.lessThanOrEqualTo(0) ? 'PENDING' : paid.greaterThanOrEqualTo(invoice.amountDue) ? 'PAID' : 'PARTIAL';
      await tx.feeInvoice.update({ where: { id: invoice.id }, data: { status: invoice.status === 'WAIVED' ? 'WAIVED' : status } });
      await this.audit.record({ actorId: actor.id, action: 'payment.void', entity: 'FeePayment', entityId: id, after: { reason }, ip }, tx);
      return this.loadPaymentDetail(tx, id);
    });
  }
}
