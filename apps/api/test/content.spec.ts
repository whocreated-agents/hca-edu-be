import { bearer, Harness, login, resetDb, seedWorld, startApp, World } from './harness';

type Body = Record<string, any>;

describe('content / CMS', () => {
  let h: Harness;
  let w: World;
  let office: string;
  let teacher: string;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.app.close(); });
  beforeEach(async () => {
    await resetDb(h);
    w = await seedWorld(h);
    office = await login(h, w.office.email);
    teacher = await login(h, w.teacherA.email);
  });

  const api = () => h.http();

  describe('notices', () => {
    it('an expired notice is excluded from the public list and the public one-notice read', async () => {
      const past = await api()
        .post('/api/v1/admin/notices')
        .set(bearer(office))
        .send({ title: 'April 2025 Holiday', body: 'Old notice', tag: 'HOLIDAY', isPublished: true, publishFrom: '2025-04-01T00:00:00Z', publishUntil: '2025-04-30T00:00:00Z' })
        .expect(201);
      const live = await api()
        .post('/api/v1/admin/notices')
        .set(bearer(office))
        .send({ title: 'Diwali Holiday', body: 'Still current', tag: 'HOLIDAY', isPublished: true, publishFrom: '2020-01-01T00:00:00Z', publishUntil: null })
        .expect(201);

      const publicList = await api().get('/api/v1/public/notices').expect(200);
      const slugs = (publicList.body as Body).items.map((n: Body) => n.slug);
      expect(slugs).toContain((live.body as Body).slug);
      expect(slugs).not.toContain((past.body as Body).slug);

      await api().get(`/api/v1/public/notices/${(past.body as Body).slug}`).expect(404);
      await api().get(`/api/v1/public/notices/${(live.body as Body).slug}`).expect(200);

      // the admin view still sees both, including the expired one
      const adminList = await api().get('/api/v1/admin/notices').set(bearer(office)).expect(200);
      expect((adminList.body as Body).items).toHaveLength(2);
    });

    it('a draft (unpublished) notice never appears publicly even inside its window', async () => {
      const draft = await api()
        .post('/api/v1/admin/notices')
        .set(bearer(office))
        .send({ title: 'Draft Notice', body: 'Not yet', tag: 'EVENT', isPublished: false, publishFrom: '2020-01-01T00:00:00Z' })
        .expect(201);
      const publicList = await api().get('/api/v1/public/notices').expect(200);
      expect((publicList.body as Body).items.map((n: Body) => n.slug)).not.toContain((draft.body as Body).slug);
    });

    it('filters the public list by tag', async () => {
      await api().post('/api/v1/admin/notices').set(bearer(office)).send({ title: 'Fee due', body: 'Pay up', tag: 'FEE', isPublished: true, publishFrom: '2020-01-01T00:00:00Z' }).expect(201);
      await api().post('/api/v1/admin/notices').set(bearer(office)).send({ title: 'Exam dates', body: 'Dates', tag: 'EXAM', isPublished: true, publishFrom: '2020-01-01T00:00:00Z' }).expect(201);
      const res = await api().get('/api/v1/public/notices?tag=FEE').expect(200);
      expect((res.body as Body).items).toHaveLength(1);
      expect((res.body as Body).items[0].tag).toBe('FEE');
    });

    it('a teacher cannot write a notice', async () => {
      await api().post('/api/v1/admin/notices').set(bearer(teacher)).send({ title: 'X', body: 'Y', tag: 'EVENT', publishFrom: '2020-01-01T00:00:00Z' }).expect(403);
    });

    it('slugs are made unique from duplicate titles', async () => {
      const a = await api().post('/api/v1/admin/notices').set(bearer(office)).send({ title: 'Same Title', body: 'A', tag: 'EVENT', publishFrom: '2020-01-01T00:00:00Z' }).expect(201);
      const b = await api().post('/api/v1/admin/notices').set(bearer(office)).send({ title: 'Same Title', body: 'B', tag: 'EVENT', publishFrom: '2020-01-01T00:00:00Z' }).expect(201);
      expect((a.body as Body).slug).not.toBe((b.body as Body).slug);
    });
  });

  describe('content blocks, profile, facilities, stats', () => {
    it('round-trips a content block and audits the write', async () => {
      const put = await api().put('/api/v1/admin/content/home.hero').set(bearer(office)).send({ data: { headline: 'Welcome' } }).expect(200);
      expect((put.body as Body).data.headline).toBe('Welcome');
      const list = await api().get('/api/v1/admin/content').set(bearer(office)).expect(200);
      expect((list.body as Body[]).some((b) => b.key === 'home.hero')).toBe(true);
      const logs = await h.prisma.auditLog.findMany({ where: { entity: 'ContentBlock' } });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('school profile has no yearsOfService field and round-trips via admin write + public read', async () => {
      const put = await api()
        .put('/api/v1/admin/profile')
        .set(bearer(office))
        .send({ name: 'Happy Children Academy', addressLines: ['Pilani'], phones: ['9811100000'], email: 'info@hca.edu.in', hours: '8am-2pm', foundedOn: '2003-04-15', board: 'RBSE', registrationNo: '103 JJN 2003-04' })
        .expect(200);
      expect(put.body as Body).not.toHaveProperty('yearsOfService');
      const pub = await api().get('/api/v1/public/profile').expect(200);
      expect((pub.body as Body).foundedOn).toBe('2003-04-15');
    });

    it('facilities and stats CRUD', async () => {
      const f = await api().post('/api/v1/admin/facilities').set(bearer(office)).send({ title: 'Library', description: 'Big one', order: 1 }).expect(201);
      await api().put(`/api/v1/admin/facilities/${(f.body as Body).id}`).set(bearer(office)).send({ title: 'Library', description: 'Even bigger', order: 1 }).expect(200);
      await api().delete(`/api/v1/admin/facilities/${(f.body as Body).id}`).set(bearer(office)).expect(204);

      const s = await api().post('/api/v1/admin/stats').set(bearer(office)).send({ label: 'Students', value: '600+', order: 1 }).expect(201);
      const stats = await api().get('/api/v1/public/content').set(bearer(office)).expect(200);
      void stats;
      await api().delete(`/api/v1/admin/stats/${(s.body as Body).id}`).set(bearer(office)).expect(204);
    });
  });

  describe('public fees', () => {
    it('renders the structure of the RUNNING session with online payment marked unavailable', async () => {
      const head = await h.prisma.feeHead.create({ data: { name: 'Tuition' } });
      const section = await h.prisma.section.findUniqueOrThrow({ where: { id: w.sectionA.id } });
      await h.prisma.feeStructure.create({ data: { sessionId: w.session.id, classLevelId: section.classLevelId, feeHeadId: head.id, amount: '1500.00', frequency: 'MONTHLY' } });
      const res = await api().get('/api/v1/public/fees').expect(200);
      expect((res.body as Body).onlinePaymentAvailable).toBe(false);
      expect((res.body as Body).classes[0].heads[0].amount).toBe('1500.00');
    });
  });
});
