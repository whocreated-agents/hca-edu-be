import { activateParent, bearer, Harness, resetDb, seedWorld, startApp, World } from './harness';

describe('parent portal data', () => {
  let h: Harness;
  let w: World;
  let tok: string;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.app.close(); });
  beforeEach(async () => { await resetDb(h); w = await seedWorld(h); tok = await activateParent(h, w, w.familyA); });

  it('fees: voided receipts show but do not count; money is exact decimal strings', async () => {
    const child = w.familyA.studentIds[0]!;
    const head = await h.prisma.feeHead.create({ data: { name: 'Tuition' } });
    const inv = await h.prisma.feeInvoice.create({
      data: { studentId: child, sessionId: w.session.id, periodLabel: 'Term 1', amountDue: '1000.10', dueOn: new Date('2000-02-01'), lines: { create: [{ feeHeadId: head.id, amount: '1000.10' }] } },
    });
    const pay = (seq: number, amount: string, voided: boolean) =>
      h.prisma.feePayment.create({
        data: { invoiceId: inv.id, amount, paidOn: new Date('2000-01-15'), mode: 'CASH', recordedById: w.office.id, sessionId: w.session.id, receiptSeq: seq, receiptNo: `R-${seq}`, requestId: crypto.randomUUID(), ...(voided ? { voidedAt: new Date(), voidReason: 'typo' } : {}) },
      });
    await pay(1, '400.05', false);
    await pay(2, '999.00', true);
    const res = await h.http().get(`/api/v1/children/${child}/fees`).set(bearer(tok)).expect(200);
    expect(res.body.totals).toEqual({ due: '1000.10', paid: '400.05', balance: '600.05' });
    expect(res.body.invoices[0].isOverdue).toBe(true);
    expect(res.body.invoices[0].payments).toHaveLength(2);
    const card = await h.http().get(`/api/v1/children/${child}`).set(bearer(tok)).expect(200);
    expect(card.body.fees).toEqual({ outstanding: '600.05', overdueInvoices: 1 });
  });

  it('notices: only live, parent-visible notices, respecting section targeting', async () => {
    const base = { body: 'b', tag: 'EVENT', publishFrom: new Date(Date.now() - 1000), isPublished: true, createdById: w.office.id } as const;
    await h.prisma.notice.create({ data: { ...base, title: 'All parents', slug: 'all', audience: 'PARENTS' } });
    await h.prisma.notice.create({ data: { ...base, title: 'Staff only', slug: 'staff', audience: 'STAFF' } });
    await h.prisma.notice.create({ data: { ...base, title: 'Draft', slug: 'draft', audience: 'PARENTS', isPublished: false } });
    await h.prisma.notice.create({ data: { ...base, title: 'Expired', slug: 'old', audience: 'PARENTS', publishUntil: new Date(Date.now() - 500) } });
    await h.prisma.notice.create({ data: { ...base, title: 'Section A', slug: 'sa', audience: 'PARENTS', targets: { create: { sectionId: w.sectionA.id } } } });
    await h.prisma.notice.create({ data: { ...base, title: 'Section B', slug: 'sb', audience: 'PARENTS', targets: { create: { sectionId: w.sectionB.id } } } });
    const res = await h.http().get('/api/v1/me/notices').set(bearer(tok)).expect(200);
    expect((res.body.items as { title: string }[]).map((n) => n.title).sort()).toEqual(['All parents', 'Section A']);
  });
});
