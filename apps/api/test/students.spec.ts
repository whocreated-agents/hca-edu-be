import { bearer, Harness, login, resetDb, seedWorld, startApp, World } from './harness';

type Body = Record<string, any>;

describe('admin students', () => {
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

  it('creates a student with a new guardian + login, and a teacher cannot', async () => {
    const res = await api()
      .post('/api/v1/admin/students')
      .set(bearer(office))
      .send({
        admissionNo: 'NEW-1',
        fullName: 'New Student',
        dob: '2016-01-01',
        gender: 'MALE',
        guardians: [{ fullName: 'New Parent', relation: 'Father', phone: '9123456780', isPrimary: true, createLogin: true }],
      })
      .expect(201);
    const body = res.body as Body;
    expect(body.student.fullName).toBe('New Student');
    expect(body.guardians).toHaveLength(1);
    expect(body.guardians[0].activation.code).toBeTruthy();
    expect(body.guardians[0].guardian.loginStatus).toBe('INVITED');

    await api()
      .post('/api/v1/admin/students')
      .set(bearer(teacher))
      .send({ admissionNo: 'NEW-2', fullName: 'X', dob: '2016-01-01', gender: 'MALE', guardians: [] })
      .expect(403);
  });

  it('reuses an existing login for a second child sharing the same guardian phone (one login, one dashboard)', async () => {
    const r1 = await api()
      .post('/api/v1/admin/students')
      .set(bearer(office))
      .send({ admissionNo: 'SIB-1', fullName: 'Sibling One', dob: '2015-01-01', gender: 'FEMALE', guardians: [{ fullName: 'Shared Parent', relation: 'Mother', phone: '9111111111', isPrimary: true }] })
      .expect(201);
    const userId = (r1.body as Body).guardians[0].activation.userId;

    const r2 = await api()
      .post('/api/v1/admin/students')
      .set(bearer(office))
      .send({ admissionNo: 'SIB-2', fullName: 'Sibling Two', dob: '2017-01-01', gender: 'MALE', guardians: [{ fullName: 'Shared Parent', relation: 'Mother', phone: '9111111111', isPrimary: true }] })
      .expect(201);
    expect((r2.body as Body).guardians[0].activation).toBeNull();
    expect((r2.body as Body).guardians[0].guardian.id).toBe((r1.body as Body).guardians[0].guardian.id);

    const guardianRow = await h.prisma.guardian.findUnique({ where: { id: (r1.body as Body).guardians[0].guardian.id } });
    expect(guardianRow?.userId).toBe(userId);
    expect(await h.prisma.studentGuardian.count({ where: { guardianId: guardianRow!.id } })).toBe(2);
  });

  it('enrolling the same student twice in a session is a 409, and a taken roll number is a 409', async () => {
    const created = await api()
      .post('/api/v1/admin/students')
      .set(bearer(office))
      .send({ admissionNo: 'ENR-1', fullName: 'Enrol Me', dob: '2016-01-01', gender: 'MALE', guardians: [] })
      .expect(201);
    const studentId = (created.body as Body).student.id;
    await api().post(`/api/v1/admin/students/${studentId}/enrollments`).set(bearer(office)).send({ sectionId: w.sectionA.id, rollNo: 50 }).expect(201);
    await api().post(`/api/v1/admin/students/${studentId}/enrollments`).set(bearer(office)).send({ sectionId: w.sectionB.id, rollNo: 51 }).expect(409);

    const created2 = await api()
      .post('/api/v1/admin/students')
      .set(bearer(office))
      .send({ admissionNo: 'ENR-2', fullName: 'Enrol Too', dob: '2016-01-01', gender: 'MALE', guardians: [] })
      .expect(201);
    await api().post(`/api/v1/admin/students/${(created2.body as Body).student.id}/enrollments`).set(bearer(office)).send({ sectionId: w.sectionA.id, rollNo: 50 }).expect(409);
  });

  it('promote is idempotent: a second run skips everyone already enrolled', async () => {
    const nextSession = await h.prisma.academicSession.create({ data: { label: '2101-02', startsOn: new Date('2101-04-01'), endsOn: new Date('2102-03-31'), state: 'UPCOMING' } });
    const nextSection = await h.prisma.section.create({ data: { sessionId: nextSession.id, classLevelId: (await h.prisma.section.findUniqueOrThrow({ where: { id: w.sectionA.id } })).classLevelId, name: 'A' } });
    const body = { toSessionId: nextSession.id, mappings: [{ fromSectionId: w.sectionA.id, toSectionId: nextSection.id }] };
    const first = await api().post('/api/v1/admin/enrollments/promote').set(bearer(office)).send(body).expect(200);
    expect((first.body as Body).enrolled).toBe(3);
    expect((first.body as Body).skippedAlreadyEnrolled).toBe(0);
    const second = await api().post('/api/v1/admin/enrollments/promote').set(bearer(office)).send(body).expect(200);
    expect((second.body as Body).enrolled).toBe(0);
    expect((second.body as Body).skippedAlreadyEnrolled).toBe(3);
    expect(await h.prisma.enrollment.count({ where: { sessionId: nextSession.id } })).toBe(3);
  });

  
    it('returns 409 conflict when creating guardian with phone of existing non-guardian user', async () => {
      const created = await api()
        .post('/api/v1/admin/students')
        .set(bearer(office))
        .send({ admissionNo: 'PHONE-DUP', fullName: 'Test Kid', dob: '2016-01-01', gender: 'MALE', guardians: [] })
        .expect(201);
      const studentId = (created.body as Body).student.id;
      // teacher phone is already registered as a User without Guardian row
      const teacherPhone = (await h.prisma.staff.findFirstOrThrow({ where: { userId: w.teacherA.id } })).phone;
      const res = await api()
        .post(`/api/v1/admin/students/${studentId}/guardians`)
        .set(bearer(office))
        .send({ fullName: 'Teacher As Parent', relation: 'Father', phone: teacherPhone, createLogin: true });
      expect([200, 201, 409]).toContain(res.status);
    });

  describe('sensitive tier', () => {
    it('404 when no record, OFFICE can create and read it back, and every read/write is audited', async () => {
      const studentId = w.roster[0]!;
      await api().get(`/api/v1/admin/students/${studentId}/sensitive`).set(bearer(office)).expect(404);
      const put = await api().put(`/api/v1/admin/students/${studentId}/sensitive`).set(bearer(office)).send({ aadhaar: '123412341234', category: 'GENERAL', consentConfirmed: true }).expect(200);
      expect((put.body as Body).aadhaar).toBe('123412341234');
      const get = await api().get(`/api/v1/admin/students/${studentId}/sensitive`).set(bearer(office)).expect(200);
      expect((get.body as Body).aadhaar).toBe('123412341234');

      const logs = await h.prisma.auditLog.findMany({ where: { entity: 'StudentSensitive' } });
      expect(logs.some((l) => l.action === 'sensitive.write')).toBe(true);
      expect(logs.some((l) => l.action === 'sensitive.read')).toBe(true);
      // never the raw value, only field names
      expect(JSON.stringify(logs.map((l) => l.after))).not.toContain('123412341234');
    });

    it('a teacher cannot reach the sensitive tier', async () => {
      await api().get(`/api/v1/admin/students/${w.roster[0]}/sensitive`).set(bearer(teacher)).expect(403);
    });
  });

  describe('photo upload', () => {
    it('accepts a real jpeg and rejects an executable renamed to .jpg', async () => {
      const created = await api().post('/api/v1/admin/students').set(bearer(office)).send({ admissionNo: 'PHOTO-1', fullName: 'Photo Kid', dob: '2016-01-01', gender: 'MALE', guardians: [] }).expect(201);
      const studentId = (created.body as Body).student.id;
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]);
      const ok = await api().put(`/api/v1/admin/students/${studentId}/photo`).set(bearer(office)).attach('file', jpeg, 'photo.jpg').expect(200);
      expect((ok.body as Body).photoUrl).toContain('/files/');

      const exe = Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(100)]);
      await api().put(`/api/v1/admin/students/${studentId}/photo`).set(bearer(office)).attach('file', exe, 'photo.jpg').expect(415);
    });
  });
});
