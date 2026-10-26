import { bearer, Harness, login, resetDb, seedWorld, startApp, World } from './harness';

type Body = Record<string, any>;

describe('admissions', () => {
  let h: Harness;
  let w: World;
  let office: string;
  let teacher: string;
  let classLevelId: string;

  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.app.close(); });
  beforeEach(async () => {
    await resetDb(h);
    w = await seedWorld(h);
    office = await login(h, w.office.email);
    teacher = await login(h, w.teacherA.email);
    await h.prisma.academicSession.update({ where: { id: w.session.id }, data: { isAdmissionOpen: true } });
    classLevelId = (await h.prisma.classLevel.findFirstOrThrow()).id;
  });

  const api = () => h.http();

  const applicationForm = {
    childDob: '2019-05-01',
    gender: 'MALE' as const,
    address: { line1: '12 Nehru Marg', city: 'Pilani', state: 'Rajasthan', pin: '333031' },
    father: { fullName: 'Rakesh Sharma', phone: '9811122233' },
    emergencyContact: { name: 'Rakesh Sharma', relation: 'Father', phone: '9811122233' },
  };

  it('stage 1 -> stage 2 -> approve -> stage 3 handoff creates a student, end to end', async () => {
    const enquiry = await api()
      .post('/api/v1/public/enquiries')
      .send({ childName: 'New Kid', classLevelId, parentName: 'Rakesh Sharma', phone: '9811122233', locality: 'Pilani' })
      .expect(201);
    expect((enquiry.body as Body).reference).toMatch(/^ENQ-/);

    const list = await api().get('/api/v1/admin/enquiries').set(bearer(office)).expect(200);
    const enquiryId = (list.body as Body).items[0].id as string;
    expect((list.body as Body).items[0].childName).toBe('New Kid');

    const invite = await api().post(`/api/v1/admin/enquiries/${enquiryId}/invite`).set(bearer(office)).expect(201);
    const token = (invite.body as Body).link.split('token=')[1] as string;

    const view = await api().get(`/api/v1/public/applications/${token}`).expect(200);
    expect((view.body as Body).editable).toBe(true);

    const submitted = await api().put(`/api/v1/public/applications/${token}`).send(applicationForm).expect(200);
    const applicationId = (await api().get('/api/v1/admin/applications').set(bearer(office)).expect(200)).body.items[0].id as string;
    expect((submitted.body as Body).status).toBe('SUBMITTED');

    await api().patch(`/api/v1/admin/applications/${applicationId}/status`).set(bearer(office)).send({ status: 'REVIEWED' }).expect(200);
    const approved = await api().patch(`/api/v1/admin/applications/${applicationId}/status`).set(bearer(office)).send({ status: 'APPROVED' }).expect(200);
    expect((approved.body as Body).status).toBe('APPROVED');

    const created = await api()
      .post(`/api/v1/admin/applications/${applicationId}/student`)
      .set(bearer(office))
      .send({ admissionNo: 'ADM-NEW-1' })
      .expect(201);
    expect((created.body as Body).student.admissionNo).toBe('ADM-NEW-1');
  });

  it('rejecting an application requires a note', async () => {
    const enquiry = await api().post('/api/v1/public/enquiries').send({ childName: 'K2', classLevelId, parentName: 'P2', phone: '9811122244', locality: 'Pilani' }).expect(201);
    void enquiry;
    const enquiryId = (await api().get('/api/v1/admin/enquiries').set(bearer(office)).expect(200)).body.items[0].id as string;
    const invite = await api().post(`/api/v1/admin/enquiries/${enquiryId}/invite`).set(bearer(office)).expect(201);
    const token = (invite.body as Body).link.split('token=')[1] as string;
    await api().put(`/api/v1/public/applications/${token}`).send(applicationForm).expect(200);
    const applicationId = (await api().get('/api/v1/admin/applications').set(bearer(office)).expect(200)).body.items[0].id as string;
    await api().patch(`/api/v1/admin/applications/${applicationId}/status`).set(bearer(office)).send({ status: 'REJECTED' }).expect(400);
    await api().patch(`/api/v1/admin/applications/${applicationId}/status`).set(bearer(office)).send({ status: 'REVIEWED' }).expect(200);
    await api().patch(`/api/v1/admin/applications/${applicationId}/status`).set(bearer(office)).send({ status: 'REJECTED', note: 'Seat not available' }).expect(200);
  });

  it('reissuing a stage-2 link revokes the old one (IDOR / stale-token attempt): 404 APPLICATION_LINK_INVALID', async () => {
    const enquiry = await api().post('/api/v1/public/enquiries').send({ childName: 'K3', classLevelId, parentName: 'P3', phone: '9811122255', locality: 'Pilani' }).expect(201);
    void enquiry;
    const enquiryId = (await api().get('/api/v1/admin/enquiries').set(bearer(office)).expect(200)).body.items[0].id as string;
    const first = await api().post(`/api/v1/admin/enquiries/${enquiryId}/invite`).set(bearer(office)).expect(201);
    const oldToken = (first.body as Body).link.split('token=')[1] as string;
    await api().post(`/api/v1/admin/enquiries/${enquiryId}/invite`).set(bearer(office)).expect(201);

    const res = await api().get(`/api/v1/public/applications/${oldToken}`).expect(404);
    expect((res.body as Body).code).toBe('APPLICATION_LINK_INVALID');
  });

  it('a nonsense token looks exactly like a revoked one: 404, no information leak', async () => {
    const res = await api().get('/api/v1/public/applications/this-token-does-not-exist-at-all-123456').expect(404);
    expect((res.body as Body).code).toBe('APPLICATION_LINK_INVALID');
  });

  it('a teacher cannot reach the admission pipeline', async () => {
    await api().get('/api/v1/admin/enquiries').set(bearer(teacher)).expect(403);
  });

  it('enquiries are rejected when no session has admissions open', async () => {
    await h.prisma.academicSession.update({ where: { id: w.session.id }, data: { isAdmissionOpen: false } });
    const res = await api().post('/api/v1/public/enquiries').send({ childName: 'Closed', classLevelId, parentName: 'P', phone: '9811122266', locality: 'Pilani' }).expect(409);
    expect((res.body as Body).code).toBe('NO_ADMISSION_SESSION_OPEN');
  });

  it('the honeypot field silently discards a bot submission without creating an enquiry', async () => {
    const before = await h.prisma.enquiry.count();
    await api().post('/api/v1/public/enquiries').send({ childName: 'Bot', classLevelId, parentName: 'Bot', phone: '9811122277', locality: 'X', website: 'http://spam.example' }).expect(201);
    expect(await h.prisma.enquiry.count()).toBe(before);
  });
});
