import { bearer, Harness, login, resetDb, seedWorld, startApp, World } from './harness';

type Body = Record<string, any>;

describe('admin academic', () => {
  let h: Harness;
  let w: World;
  let admin: string;
  let office: string;
  let teacher: string;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.app.close(); });
  beforeEach(async () => {
    await resetDb(h);
    w = await seedWorld(h);
    admin = await login(h, w.admin.email);
    office = await login(h, w.office.email);
    teacher = await login(h, w.teacherA.email);
  });

  const api = () => h.http();

  describe('sessions', () => {
    it('creates a session always UPCOMING', async () => {
      const res = await api().post('/api/v1/admin/sessions').set(bearer(office)).send({ label: '2030-31', startsOn: '2030-04-01', endsOn: '2031-03-31' }).expect(201);
      expect((res.body as Body).state).toBe('UPCOMING');
    });

    it('a teacher cannot create a session (403)', async () => {
      await api().post('/api/v1/admin/sessions').set(bearer(teacher)).send({ label: '2030-31', startsOn: '2030-04-01', endsOn: '2031-03-31' }).expect(403);
    });

    it('UPCOMING -> RUNNING closes the previously running session in the same transaction', async () => {
      const created = await api().post('/api/v1/admin/sessions').set(bearer(office)).send({ label: '2030-31', startsOn: '2030-04-01', endsOn: '2031-03-31' }).expect(201);
      const next = (created.body as Body).id;
      const res = await api().post(`/api/v1/admin/sessions/${next}/transition`).set(bearer(office)).send({ to: 'RUNNING' }).expect(200);
      expect((res.body as Body).state).toBe('RUNNING');
      const old = await h.prisma.academicSession.findUnique({ where: { id: w.session.id } });
      expect(old?.state).toBe('CLOSED');
      const runningCount = await h.prisma.academicSession.count({ where: { state: 'RUNNING' } });
      expect(runningCount).toBe(1);
    });

    it('RUNNING -> CLOSED works; CLOSED is terminal (409 on any further transition)', async () => {
      const res = await api().post(`/api/v1/admin/sessions/${w.session.id}/transition`).set(bearer(office)).send({ to: 'CLOSED' }).expect(200);
      expect((res.body as Body).state).toBe('CLOSED');
      const again = await api().post(`/api/v1/admin/sessions/${w.session.id}/transition`).set(bearer(office)).send({ to: 'RUNNING' }).expect(409);
      expect((again.body as Body).code).toBe('SESSION_STATE_INVALID');
    });

    it('UPCOMING -> CLOSED directly is 409 (anything but the two legal edges is invalid)', async () => {
      const created = await api().post('/api/v1/admin/sessions').set(bearer(office)).send({ label: '2031-32', startsOn: '2031-04-01', endsOn: '2032-03-31' }).expect(201);
      const id = (created.body as Body).id;
      const res = await api().post(`/api/v1/admin/sessions/${id}/transition`).set(bearer(office)).send({ to: 'CLOSED' }).expect(409);
      expect((res.body as Body).code).toBe('SESSION_STATE_INVALID');
    });

    it('two sessions cannot both have admissions open', async () => {
      await api().patch(`/api/v1/admin/sessions/${w.session.id}`).set(bearer(office)).send({ isAdmissionOpen: true }).expect(200);
      const created = await api().post('/api/v1/admin/sessions').set(bearer(office)).send({ label: '2032-33', startsOn: '2032-04-01', endsOn: '2033-03-31', isAdmissionOpen: true }).expect(409);
      expect((created.body as Body).code).toBe('SESSION_STATE_INVALID');
    });

    it('concurrent RUNNING transitions on two different upcoming sessions: exactly one running session survives', async () => {
      const a = (await api().post('/api/v1/admin/sessions').set(bearer(office)).send({ label: '2040-41', startsOn: '2040-04-01', endsOn: '2041-03-31' }).expect(201)).body.id;
      const b = (await api().post('/api/v1/admin/sessions').set(bearer(office)).send({ label: '2041-42', startsOn: '2041-04-01', endsOn: '2042-03-31' }).expect(201)).body.id;
      const results = await Promise.all([
        api().post(`/api/v1/admin/sessions/${a}/transition`).set(bearer(office)).send({ to: 'RUNNING' }),
        api().post(`/api/v1/admin/sessions/${b}/transition`).set(bearer(office)).send({ to: 'RUNNING' }),
      ]);
      for (const r of results) expect([200, 409]).toContain(r.status);
      const runningCount = await h.prisma.academicSession.count({ where: { state: 'RUNNING' } });
      expect(runningCount).toBe(1);
    });
  });

  describe('holidays', () => {
    it('adds a holiday inside the session and rejects duplicates', async () => {
      const res = await api().post(`/api/v1/admin/sessions/${w.session.id}/holidays`).set(bearer(office)).send({ date: '2050-01-01', label: 'New Year' }).expect(201);
      expect((res.body as Body).label).toBe('New Year');
      await api().post(`/api/v1/admin/sessions/${w.session.id}/holidays`).set(bearer(office)).send({ date: '2050-01-01', label: 'Dup' }).expect(409);
    });

    it('rejects a holiday outside the session bounds', async () => {
      await api().post(`/api/v1/admin/sessions/${w.session.id}/holidays`).set(bearer(office)).send({ date: '1900-01-01', label: 'Too early' }).expect(422);
    });
  });

  describe('class levels', () => {
    it('edits age bounds only', async () => {
      const list = await api().get('/api/v1/admin/class-levels').set(bearer(office)).expect(200);
      const cl = (list.body as Body[])[0]!;
      const res = await api().patch(`/api/v1/admin/class-levels/${cl.id}`).set(bearer(office)).send({ minAge: 3, maxAge: 5 }).expect(200);
      expect((res.body as Body).minAge).toBe(3);
      expect((res.body as Body).maxAge).toBe(5);
    });
  });

  describe('sections', () => {
    it('rejects a duplicate (session, class, name)', async () => {
      const cl = await h.prisma.section.findUnique({ where: { id: w.sectionA.id } });
      await api()
        .post('/api/v1/admin/sections')
        .set(bearer(office))
        .send({ sessionId: w.session.id, classLevelId: cl!.classLevelId, name: 'A' })
        .expect(409);
    });

    it('a teacher cannot create a section', async () => {
      await api().post('/api/v1/admin/sections').set(bearer(teacher)).send({ sessionId: w.session.id, classLevelId: w.session.id, name: 'Z' }).expect(403);
    });
  });

  describe('staff', () => {
    it('creates a teacher and returns a one-time activation code that activates through the real flow', async () => {
      const res = await api()
        .post('/api/v1/admin/staff')
        .set(bearer(admin))
        .send({ fullName: 'New Teacher', email: 'new.teacher@hca.test', phone: '9876543210', designation: 'PGT', employeeCode: 'EMP-99', joinedOn: '2024-06-01', role: 'TEACHER' })
        .expect(201);
      const body = res.body as Body;
      expect(body.activation.code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      const activated = await api().post('/api/v1/auth/activate').send({ identifier: 'new.teacher@hca.test', code: body.activation.code, newPassword: 'correct horse battery' }).expect(200);
      expect((activated.body as Body).user.role).toBe('TEACHER');
    });

    it('only SUPER_ADMIN may create staff; OFFICE gets 403', async () => {
      await api()
        .post('/api/v1/admin/staff')
        .set(bearer(office))
        .send({ fullName: 'X', email: 'x@hca.test', phone: '9876543211', designation: 'PGT', employeeCode: 'EMP-98', joinedOn: '2024-06-01', role: 'TEACHER' })
        .expect(403);
    });

    it('a teacher cannot read the staff list', async () => {
      await api().get('/api/v1/admin/staff').set(bearer(teacher)).expect(403);
    });

    it('deactivating staff suspends the linked user', async () => {
      const staffRow = await h.prisma.staff.findFirst({ where: { userId: w.teacherA.id } });
      const res = await api().patch(`/api/v1/admin/staff/${staffRow!.id}`).set(bearer(admin)).send({ isActive: false }).expect(200);
      expect((res.body as Body).isActive).toBe(false);
      const user = await h.prisma.user.findUnique({ where: { id: w.teacherA.id } });
      expect(user?.status).toBe('SUSPENDED');
    });
  });
});
