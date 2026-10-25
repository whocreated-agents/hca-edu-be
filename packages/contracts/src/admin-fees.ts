import { z } from 'zod';
import { DateOnly, IdParam, Money, Page, PageQuery, PositiveMoney, ShortText, Uuid } from './common';
import { InvoiceDto, PaymentDto } from './dto';
import { FeeFrequency, InvoiceStatus, MONEY_ROLES, PaymentMode, STAFF_ADMIN_ROLES } from './enums';
import { roles, route } from './route';

/**
 * Admin control plane, part 4: the fee ledger. No payment gateway exists; money enters only as an
 * office-recorded FeePayment. Amounts are decimal STRINGS end to end.
 *
 * Invariants the services enforce (and tests prove): invoice.amountDue == sum(lines); a payment can
 * never push non-voided paid above amountDue; receipt numbers are gapless per session and allocated
 * under a row lock; a payment is never deleted — it is voided, keeping its number.
 */

export const FeeHeadDto = z.object({ id: Uuid, name: z.string(), isRecurring: z.boolean() });
export const FeeHeadInput = z.strictObject({ name: ShortText(60), isRecurring: z.boolean().default(true) });

export const FeeStructureRow = z.object({
  id: Uuid,
  sessionId: Uuid,
  classLevelId: Uuid,
  feeHeadId: Uuid,
  feeHeadName: z.string(),
  amount: Money,
  frequency: FeeFrequency,
  dueDayOfMonth: z.number().int().nullable(),
});

export const FeeStructureUpsert = z.strictObject({
  sessionId: Uuid,
  classLevelId: Uuid,
  /** Replaces the rows for (session, class): heads omitted are removed IF no invoice line references them, else 409. */
  rows: z.array(
    z.strictObject({
      feeHeadId: Uuid,
      amount: PositiveMoney,
      frequency: FeeFrequency,
      dueDayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
    }),
  ).max(20),
});

export const InvoiceGenerate = z.strictObject({
  sessionId: Uuid,
  /** Free text the office controls, e.g. "April 2027" or "Q1". Unique per (student, session, period). */
  periodLabel: ShortText(40),
  dueOn: DateOnly,
  /** Which structure rows to bill. Empty/omitted = every head in the class's structure matching `frequencies`. */
  feeHeadIds: z.array(Uuid).max(20).optional(),
  /** Scope. Exactly one of: classLevelIds, sectionIds, studentIds (office-triggered, never automatic). */
  classLevelIds: z.array(Uuid).max(13).optional(),
  sectionIds: z.array(Uuid).max(60).optional(),
  studentIds: z.array(Uuid).max(500).optional(),
}).refine((v) => [v.classLevelIds, v.sectionIds, v.studentIds].filter((x) => x && x.length).length === 1, {
  message: 'Give exactly one of classLevelIds, sectionIds, studentIds',
});
export const InvoiceGenerateResult = z.object({
  created: z.number().int(),
  /** Already billed for this period — generation is idempotent, so re-running is safe. */
  skippedExisting: z.number().int(),
  /** Students whose class has no fee structure row for the chosen heads. */
  skippedNoStructure: z.number().int(),
});

export const PaymentInput = z.strictObject({
  /** Client-generated once per submit. A retry/double-click with the same id returns the original receipt. */
  requestId: Uuid,
  amount: PositiveMoney,
  paidOn: DateOnly,
  mode: PaymentMode,
  reference: z.string().trim().max(100).optional(),
}).refine((v) => v.mode === 'CASH' || !!v.reference, { path: ['reference'], message: 'Cheque / transfer / UPI needs a reference' });
export type PaymentInput = z.input<typeof PaymentInput>;

export const PaymentDetail = PaymentDto.extend({
  invoiceId: Uuid,
  studentId: Uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  className: z.string(),
  periodLabel: z.string(),
  sessionLabel: z.string(),
  recordedBy: z.string(),
  /** Echo so the client can tell a replay (200) from a first write (201) by status, and detect it by id. */
  requestId: Uuid,
  balanceAfter: Money,
});
export type PaymentDetail = z.infer<typeof PaymentDetail>;

const FEES_WRITE = MONEY_ROLES;

export const adminFeeRoutes = {
  feeHeads: route({ method: 'GET', path: '/admin/fee-heads', access: roles(MONEY_ROLES), summary: 'Fee heads.', response: z.array(FeeHeadDto) }),
  createFeeHead: route({ method: 'POST', path: '/admin/fee-heads', access: roles(STAFF_ADMIN_ROLES), summary: 'Add a head. 409 on duplicate name.', body: FeeHeadInput, response: FeeHeadDto }),
  updateFeeHead: route({ method: 'PATCH', path: '/admin/fee-heads/:id', access: roles(STAFF_ADMIN_ROLES), summary: 'Rename / toggle recurring.', params: IdParam, body: FeeHeadInput.partial(), response: FeeHeadDto }),
  deleteFeeHead: route({ method: 'DELETE', path: '/admin/fee-heads/:id', access: roles(STAFF_ADMIN_ROLES), summary: '409 if referenced by structure or invoice lines.', params: IdParam }),

  structure: route({
    method: 'GET', path: '/admin/fee-structure', access: roles(MONEY_ROLES), summary: 'Structure rows for a session (default RUNNING), optionally one class.',
    query: z.object({ sessionId: Uuid.optional(), classLevelId: Uuid.optional() }), response: z.array(FeeStructureRow),
  }),
  putStructure: route({
    method: 'PUT', path: '/admin/fee-structure', access: roles(STAFF_ADMIN_ROLES),
    summary: 'Replace the fee rows for one (session, class). Admin-entered; no amount ever ships in code or seed. Changing it never rewrites existing invoices (lines are copied at generation).',
    body: FeeStructureUpsert, response: z.array(FeeStructureRow), status: 200,
  }),

  invoices: route({
    method: 'GET', path: '/admin/fee-invoices', access: roles(MONEY_ROLES), summary: 'Invoice list; `overdue=true` for the defaulters view.',
    query: PageQuery.extend({
      sessionId: Uuid.optional(), studentId: Uuid.optional(), sectionId: Uuid.optional(), classLevelId: Uuid.optional(),
      status: InvoiceStatus.optional(), overdue: z.coerce.boolean().optional(), periodLabel: z.string().max(40).optional(),
    }),
    response: Page(InvoiceDto.extend({ studentName: z.string(), admissionNo: z.string(), className: z.string().nullable(), sectionName: z.string().nullable() })),
  }),
  invoice: route({ method: 'GET', path: '/admin/fee-invoices/:id', access: roles(MONEY_ROLES), summary: 'One invoice with lines and receipts.', params: IdParam, response: InvoiceDto }),
  generateInvoices: route({
    method: 'POST', path: '/admin/fee-invoices/generate', access: roles(FEES_WRITE),
    summary: 'Office-triggered billing run (never automatic). Idempotent per (student, session, period).',
    body: InvoiceGenerate, response: InvoiceGenerateResult, status: 200,
  }),
  waiveInvoice: route({
    method: 'POST', path: '/admin/fee-invoices/:id/waive', access: roles(STAFF_ADMIN_ROLES),
    summary: 'Waive the unpaid balance (status WAIVED). Reason required. Audited.',
    params: IdParam, body: z.strictObject({ reason: ShortText(300) }), response: InvoiceDto, status: 200,
  }),

  payments: route({
    method: 'GET', path: '/admin/fee-payments', access: roles(MONEY_ROLES), summary: 'Receipts, newest first.',
    query: PageQuery.extend({ sessionId: Uuid.optional(), studentId: Uuid.optional(), from: DateOnly.optional(), to: DateOnly.optional(), mode: PaymentMode.optional(), includeVoided: z.coerce.boolean().optional() }),
    response: Page(PaymentDetail),
  }),
  payment: route({ method: 'GET', path: '/admin/fee-payments/:id', access: roles(MONEY_ROLES), summary: 'One receipt (printable data).', params: IdParam, response: PaymentDetail }),
  recordPayment: route({
    method: 'POST', path: '/admin/fee-invoices/:id/payments', access: roles(FEES_WRITE),
    summary: 'Record money received. One transaction: lock invoice + session ReceiptCounter, allocate gapless receipt number, insert, recompute status. 422 PAYMENT_EXCEEDS_BALANCE; 409 INVOICE_NOT_PAYABLE (waived). Same requestId => original receipt, no second write.',
    params: IdParam, body: PaymentInput, response: PaymentDetail,
  }),
  voidPayment: route({
    method: 'POST', path: '/admin/fee-payments/:id/void', access: roles(FEES_WRITE),
    summary: 'Void a mistaken receipt: number retained, amount stops counting, invoice status recomputed, reason required, audited. Idempotent.',
    params: IdParam, body: z.strictObject({ reason: ShortText(300) }), response: PaymentDetail, status: 200,
  }),
};
