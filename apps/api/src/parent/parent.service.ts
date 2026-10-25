import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AttendanceMonth, ChildCard, ChildFees, InvoiceDto, ParentNotice } from '@hca/contracts';
import { dateOnly, decodeCursor, encodeCursor, money, schoolToday } from '../common/format';
import { studentWithCurrent, toStudentDto } from '../common/mappers';
import { Problem } from '../common/problem';
import { PrismaService } from '../prisma.service';

const monthBounds = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)), days: new Date(Date.UTC(y, m, 0)).getUTCDate() };
};

const invoiceInclude = {
  lines: { include: { feeHead: true } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FeeInvoiceInclude;
type InvoiceRow = Prisma.FeeInvoiceGetPayload<{ include: typeof invoiceInclude }>;

/** Shared with the admin fee screens so a parent and the office never see two different balances. */
export function toInvoiceDto(i: InvoiceRow, today = schoolToday()): InvoiceDto {
  const paid = i.payments.filter((p) => !p.voidedAt).reduce((a, p) => a.plus(p.amount), new Prisma.Decimal(0));
  const waived = i.status === 'WAIVED';
  const balance = waived ? new Prisma.Decimal(0) : Prisma.Decimal.max(i.amountDue.minus(paid), 0);
  return {
    id: i.id,
    studentId: i.studentId,
    sessionId: i.sessionId,
    periodLabel: i.periodLabel,
    amountDue: money(i.amountDue),
    amountPaid: money(paid),
    balance: money(balance),
    dueOn: dateOnly(i.dueOn),
    isOverdue: balance.gt(0) && dateOnly(i.dueOn) < today,
    status: i.status,
    waivedReason: i.waivedReason,
    lines: i.lines.map((l) => ({ feeHeadId: l.feeHeadId, feeHeadName: l.feeHead.name, amount: money(l.amount) })),
    payments: i.payments.map((p) => ({
      id: p.id,
      receiptNo: p.receiptNo,
      amount: money(p.amount),
      paidOn: dateOnly(p.paidOn),
      mode: p.mode,
      reference: p.reference,
      voided: p.voidedAt !== null,
      voidReason: p.voidReason,
    })),
  };
}

@Injectable()
export class ParentService {
  constructor(private readonly prisma: PrismaService) {}

  async children(userId: string): Promise<ChildCard[]> {
    const links = await this.prisma.studentGuardian.findMany({
      where: { guardian: { userId } },
      select: { studentId: true },
      orderBy: { student: { fullName: 'asc' } },
    });
    return Promise.all(links.map((l) => this.child(l.studentId)));
  }

  /** Caller must already have passed the `student` relation check in AccessGuard. */
  async child(studentId: string): Promise<ChildCard> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, ...studentWithCurrent });
    if (!student) throw Problem.notFound();
    const dto = toStudentDto(student);
    const enr = student.enrollments[0];
    const today = schoolToday();
    const month = today.slice(0, 7);

    const invoices = enr
      ? await this.prisma.feeInvoice.findMany({ where: { studentId, sessionId: enr.sessionId }, include: invoiceInclude })
      : [];
    const mapped = invoices.map((i) => toInvoiceDto(i, today));
    const outstanding = mapped.reduce((a, i) => a.plus(i.balance), new Prisma.Decimal(0));

    const att = await this.attendanceMonth(studentId, month);
    return {
      student: dto,
      className: enr?.section.classLevel.name ?? null,
      sectionName: enr?.section.name ?? null,
      rollNo: enr?.rollNo ?? null,
      classTeacher: enr?.section.classTeacher ? { id: enr.section.classTeacher.id, fullName: enr.section.classTeacher.fullName } : null,
      fees: { outstanding: money(outstanding), overdueInvoices: mapped.filter((i) => i.isOverdue).length },
      attendanceThisMonth: { month, ...att.summary },
    };
  }

  async fees(studentId: string, sessionId?: string): Promise<ChildFees> {
    const session = sessionId
      ? await this.prisma.academicSession.findUnique({ where: { id: sessionId } })
      : await this.prisma.academicSession.findFirst({ where: { state: 'RUNNING' } });
    if (!session) return { studentId, sessionId: null, sessionLabel: null, invoices: [], totals: { due: '0.00', paid: '0.00', balance: '0.00' } };
    const rows = await this.prisma.feeInvoice.findMany({ where: { studentId, sessionId: session.id }, include: invoiceInclude, orderBy: { dueOn: 'asc' } });
    const invoices = rows.map((r) => toInvoiceDto(r));
    const sum = (f: (i: InvoiceDto) => string) => invoices.reduce((a, i) => a.plus(f(i)), new Prisma.Decimal(0));
    return {
      studentId,
      sessionId: session.id,
      sessionLabel: session.label,
      invoices,
      totals: {
        due: money(sum((i) => (i.status === 'WAIVED' ? '0' : i.amountDue))),
        paid: money(sum((i) => i.amountPaid)),
        balance: money(sum((i) => i.balance)),
      },
    };
  }

  async attendanceMonth(studentId: string, month?: string): Promise<AttendanceMonth> {
    const ym = month ?? schoolToday().slice(0, 7);
    const { from, to, days } = monthBounds(ym);
    const [entries, holidays] = await Promise.all([
      this.prisma.attendanceEntry.findMany({ where: { studentId, day: { date: { gte: from, lt: to } } }, include: { day: { select: { date: true } } } }),
      this.prisma.holiday.findMany({ where: { date: { gte: from, lt: to } } }),
    ]);
    const byDate = new Map(entries.map((e) => [dateOnly(e.day.date), e]));
    const holidayBy = new Map(holidays.map((h) => [dateOnly(h.date), h.label]));
    const summary = { present: 0, absent: 0, late: 0, leave: 0, workingDays: 0 };
    const out: AttendanceMonth['days'] = [];
    for (let d = 1; d <= days; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      const e = byDate.get(date);
      const holiday = holidayBy.get(date) ?? null;
      out.push({ date, status: e?.status ?? null, note: e?.note ?? null, holiday });
      if (e && !holiday) {
        summary.workingDays += 1;
        summary[e.status.toLowerCase() as 'present' | 'absent' | 'late' | 'leave'] += 1;
      }
    }
    return { studentId, month: ym, days: out, summary };
  }

  async notices(userId: string, limit: number, cursor?: string): Promise<{ items: ParentNotice[]; nextCursor: string | null }> {
    const now = new Date();
    const sections = await this.prisma.enrollment.findMany({
      where: { state: 'ACTIVE', session: { state: 'RUNNING' }, student: { guardians: { some: { guardian: { userId } } } } },
      select: { sectionId: true },
    });
    const sectionIds = [...new Set(sections.map((s) => s.sectionId))];
    const offset = decodeCursor(cursor);
    const rows = await this.prisma.notice.findMany({
      where: {
        audience: { in: ['PUBLIC', 'PARENTS'] },
        isPublished: true,
        publishFrom: { lte: now },
        AND: [
          { OR: [{ publishUntil: null }, { publishUntil: { gt: now } }] },
          { OR: [{ targets: { none: {} } }, { targets: { some: { sectionId: { in: sectionIds } } } }] },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { publishFrom: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((n) => ({ id: n.id, slug: n.slug, title: n.title, body: n.body, tag: n.tag, publishFrom: n.publishFrom.toISOString(), isPinned: n.isPinned })),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
  }
}

