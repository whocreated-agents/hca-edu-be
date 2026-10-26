import { randomUUID } from 'node:crypto';
import { bearer, Harness, login, resetDb, seedWorld, startApp, World } from './harness';

type Body = Record<string, any>;

describe('fees ledger', () => {
  let h: Harness;
  let w: World;
  let office: string;
  let accounts: string;
  let teacher: string;
  let classLevelId: string;

  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.app.close(); });
  beforeEach(async () => {
    await resetDb(h);
    w = await seedWorld(h);
    office = await login(h, w.office.email);
    teacher = await login(h, w.teacherA.email);
    const section = await h.prisma.section.findUniqueOrThrow({ where: { id: w.sectionA.id } });
    classLevelId = section.classLevelId;
    const hash = await h.app.get(await import('../src/auth/crypto.service').then((m) => m.CryptoService)).hashSecret('correct horse battery');
    const accUser = await h.prisma.user.create({ data: { role: 'ACCOUNTS', status: 'ACTIVE', email: 'accounts@hca.test', emailVerifiedAt: new Date(), passwordHash: hash } });
    accounts = await login(h, accUser.email!);
  });

  const api = () => h.http();

  async function setupStructureAndInvoice(amount = '1000.00') {
    const head = await h.prisma.feeHead.create({ data: { name: `Tuition-${randomUUID().slice(0, 8)}` } });
    await api()
      .put('/api/v1/admin/fee-structure')
      .set(bearer(office))
      .send({ sessionId: w.session.id, classLevelId, rows: [{ feeHeadId: head.id, amount, frequency: 'MONTHLY' }] })
      .expect(200);
    const gen = await api()
      .post('/api/v1/admin/fee-invoices/generate')
      .set(bearer(office))
      .send({ sessionId: w.session.id, periodLabel: `P-${randomUUID().slice(0, 8)}`, dueOn: '2030-01-01', classLevelIds: [classLevelId] })
      .expect(200);
    expect((gen.body as Body).created).toBeGreaterThan(0);
    const invoices = (await api().get(`/api/v1/admin/fee-invoices?classLevelId=${classLevelId}`).set(bearer(office)).expect(200)).body.items as Body[];
    return invoices[0] as Body;
  }

  it('structure write is office-only; a teacher gets 403', async () => {
    await api().put('/api/v1/admin/fee-structure').set(bearer(teacher)).send({ sessionId: w.session.id, classLevelId, rows: [] }).expect(403);
  });

  it('generates one invoice per active student, idempotently', async () => {
    const invoice = await setupStructureAndInvoice();
    expect(invoice.amountDue).toBe('1000.00');
    expect(invoice.status).toBe('PENDING');
  });

  it('records a payment, allocates a receipt, and recomputes invoice status', async () => {
    const invoice = await setupStructureAndInvoice('1000.00');
    const pay = await api()
      .post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`)
      .set(bearer(office))
      .send({ requestId: randomUUID(), amount: '400.00', paidOn: '2030-01-05', mode: 'CASH' })
      .expect(201);
    expect((pay.body as Body).receiptNo).toMatch(/\/\d{5}$/);
    expect((pay.body as Body).balanceAfter).toBe('600.00');

    const afterInvoice = await api().get(`/api/v1/admin/fee-invoices/${invoice.id}`).set(bearer(office)).expect(200);
    expect((afterInvoice.body as Body).status).toBe('PARTIAL');

    const pay2 = await api()
      .post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`)
      .set(bearer(office))
      .send({ requestId: randomUUID(), amount: '600.00', paidOn: '2030-01-06', mode: 'CASH' })
      .expect(201);
    expect((pay2.body as Body).balanceAfter).toBe('0.00');
    const paidInvoice = await api().get(`/api/v1/admin/fee-invoices/${invoice.id}`).set(bearer(office)).expect(200);
    expect((paidInvoice.body as Body).status).toBe('PAID');
  });

  it('a payment exceeding the balance is rejected (422)', async () => {
    const invoice = await setupStructureAndInvoice('1000.00');
    const res = await api()
      .post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`)
      .set(bearer(office))
      .send({ requestId: randomUUID(), amount: '1500.00', paidOn: '2030-01-05', mode: 'CASH' })
      .expect(422);
    expect((res.body as Body).code).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  it('retrying the same requestId returns the original receipt, not a second write', async () => {
    const invoice = await setupStructureAndInvoice('1000.00');
    const requestId = randomUUID();
    const first = await api().post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`).set(bearer(office)).send({ requestId, amount: '400.00', paidOn: '2030-01-05', mode: 'CASH' }).expect(201);
    const second = await api().post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`).set(bearer(office)).send({ requestId, amount: '400.00', paidOn: '2030-01-05', mode: 'CASH' }).expect(201);
    expect((second.body as Body).id).toBe((first.body as Body).id);
    expect((second.body as Body).receiptNo).toBe((first.body as Body).receiptNo);
    expect(await h.prisma.feePayment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it('voiding a payment keeps its receipt number but stops it counting toward the invoice', async () => {
    const invoice = await setupStructureAndInvoice('1000.00');
    const pay = await api().post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`).set(bearer(office)).send({ requestId: randomUUID(), amount: '1000.00', paidOn: '2030-01-05', mode: 'CASH' }).expect(201);
    expect((await api().get(`/api/v1/admin/fee-invoices/${invoice.id}`).set(bearer(office)).expect(200)).body.status).toBe('PAID');

    const voided = await api().post(`/api/v1/admin/fee-payments/${(pay.body as Body).id}/void`).set(bearer(office)).send({ reason: 'Entered by mistake' }).expect(200);
    expect((voided.body as Body).voided).toBe(true);
    expect((voided.body as Body).receiptNo).toBe((pay.body as Body).receiptNo);

    const invoiceAfter = await api().get(`/api/v1/admin/fee-invoices/${invoice.id}`).set(bearer(office)).expect(200);
    expect((invoiceAfter.body as Body).status).toBe('PENDING');
    expect((invoiceAfter.body as Body).amountPaid).toBe('0.00');
  });

  it('waiving an invoice is terminal: a payment attempt afterwards is 409 INVOICE_NOT_PAYABLE', async () => {
    const invoice = await setupStructureAndInvoice('1000.00');
    await api().post(`/api/v1/admin/fee-invoices/${invoice.id}/waive`).set(bearer(office)).send({ reason: 'Fee concession' }).expect(200);
    const res = await api().post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`).set(bearer(office)).send({ requestId: randomUUID(), amount: '100.00', paidOn: '2030-01-05', mode: 'CASH' }).expect(409);
    expect((res.body as Body).code).toBe('INVOICE_NOT_PAYABLE');
  });

  it('ACCOUNTS can read and record payments but a TEACHER is forbidden from the ledger entirely (resource-level authorisation)', async () => {
    const invoice = await setupStructureAndInvoice('1000.00');
    await api().get(`/api/v1/admin/fee-invoices/${invoice.id}`).set(bearer(accounts)).expect(200);
    await api().post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`).set(bearer(accounts)).send({ requestId: randomUUID(), amount: '100.00', paidOn: '2030-01-05', mode: 'CASH' }).expect(201);

    await api().get(`/api/v1/admin/fee-invoices/${invoice.id}`).set(bearer(teacher)).expect(403);
    await api().post(`/api/v1/admin/fee-invoices/${invoice.id}/payments`).set(bearer(teacher)).send({ requestId: randomUUID(), amount: '100.00', paidOn: '2030-01-05', mode: 'CASH' }).expect(403);
  });

  it('concurrent payment inserts allocate gapless, collision-free receipt numbers', async () => {
    // Several invoices in the same session so each parallel request locks/unlocks the shared
    // per-session ReceiptCounter rather than colliding on a single invoice's business rules.
    const head = await h.prisma.feeHead.create({ data: { name: `Concurrency-${randomUUID().slice(0, 8)}` } });
    await api().put('/api/v1/admin/fee-structure').set(bearer(office)).send({ sessionId: w.session.id, classLevelId, rows: [{ feeHeadId: head.id, amount: '5000.00', frequency: 'ONE_TIME' }] }).expect(200);
    await api().post('/api/v1/admin/fee-invoices/generate').set(bearer(office)).send({ sessionId: w.session.id, periodLabel: `Concurrent-${randomUUID().slice(0, 8)}`, dueOn: '2030-01-01', classLevelIds: [classLevelId] }).expect(200);
    const invoices = (await api().get(`/api/v1/admin/fee-invoices?classLevelId=${classLevelId}&limit=50`).set(bearer(office)).expect(200)).body.items as Body[];
    expect(invoices.length).toBeGreaterThanOrEqual(3);

    const before = (await h.prisma.receiptCounter.findUnique({ where: { sessionId: w.session.id } }))?.next ?? 1;

    const results = await Promise.all(
      invoices.slice(0, 3).map((inv) =>
        api().post(`/api/v1/admin/fee-invoices/${inv.id}/payments`).set(bearer(office)).send({ requestId: randomUUID(), amount: '500.00', paidOn: '2030-01-05', mode: 'CASH' }),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);

    const receiptNos = results.map((r) => (r.body as Body).receiptNo as string);
    expect(new Set(receiptNos).size).toBe(receiptNos.length); // no collisions

    const seqs = receiptNos.map((n) => Number(n.split('/')[1])).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1]! + 1); // no gaps

    const after = (await h.prisma.receiptCounter.findUnique({ where: { sessionId: w.session.id } }))!.next;
    expect(after).toBe(before + 3);
    expect(await h.prisma.feePayment.count({ where: { sessionId: w.session.id } })).toBe(3);
  });
});
