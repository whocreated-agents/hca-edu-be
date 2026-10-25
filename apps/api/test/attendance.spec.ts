import { schoolToday } from '../src/common/format';
import { activateParent, bearer, Harness, login, resetDb, seedWorld, startApp, uuid, World } from './harness';

type Body = Record<string, any>;

const daysAgo = (n: number) => new Date(new Date(`${schoolToday()}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);

describe('attendance sync', () => {
  let h: Harness;
  let w: World;
  let teacher: string;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.app.close(); });
  beforeEach(async () => { await resetDb(h); w = await seedWorld(h); teacher = await login(h, w.teacherA.email); });

  const payload = (over: Partial<{ mutationId: string; capturedAt: string; status: string }> = {}) => ({
    mutationId: over.mutationId ?? uuid(),
    capturedAt: over.capturedAt ?? new Date().toISOString(),
    entries: w.roster.map((studentId) => ({ studentId, status: over.status ?? 'PRESENT' })),
  });
  const put = (date: string, body: unknown, tok = teacher, section = w.sectionA.id) =>
    h.http().put(`/api/v1/sections/${section}/attendance/${date}`).set(bearer(tok)).send(body as object);

  it('creates, then an exact retry is a harmless REPLAYED no-op', async () => {
    const day = daysAgo(0);
    const body = payload();
    const first = await put(day, body).expect(200);
    expect((first.body as Body).outcome).toBe('CREATED');
    const second = await put(day, body).expect(200);
    expect((second.body as Body).outcome).toBe('REPLAYED');
    expect(second.body.markedAt).toBe(first.body.markedAt);
    expect(await h.prisma.attendanceDay.count()).toBe(1);
    expect(await h.prisma.attendanceEntry.count()).toBe(3);
  });

  it('a newer submission updates in place (no duplicate rows)', async () => {
    const day = daysAgo(0);
    await put(day, payload({ capturedAt: new Date(Date.now() - 5000).toISOString() })).expect(200);
    const res = await put(day, payload({ status: 'ABSENT' })).expect(200);
    expect((res.body as Body).outcome).toBe('UPDATED');
    expect(await h.prisma.attendanceEntry.count()).toBe(3);
    expect(await h.prisma.attendanceEntry.count({ where: { status: 'ABSENT' } })).toBe(3);
  });

  it('a stale offline submission cannot overwrite a newer register (409, winner returned)', async () => {
    const day = daysAgo(0);
    const old = new Date(Date.now() - 60_000).toISOString();
    await put(day, payload({ status: 'PRESENT' })).expect(200);
    const res = await put(day, payload({ status: 'ABSENT', capturedAt: old })).expect(409);
    expect((res.body as Body).code).toBe('ATTENDANCE_STALE');
    expect(res.body.extra.current.entries.every((e: Body) => e.status === 'PRESENT')).toBe(true);
    expect(await h.prisma.attendanceEntry.count({ where: { status: 'ABSENT' } })).toBe(0);
  });

  it('a partial, over-complete or duplicated register is rejected and nothing is written', async () => {
    const day = daysAgo(0);
    const partial = payload();
    partial.entries.pop();
    const r1 = await put(day, partial).expect(422);
    expect(r1.body.code).toBe('ATTENDANCE_ROSTER_MISMATCH');
    expect(r1.body.extra.roster).toHaveLength(3);
    const extra = payload();
    extra.entries.push({ studentId: (await h.prisma.enrollment.findFirstOrThrow({ where: { sectionId: w.sectionB.id } })).studentId, status: 'PRESENT' });
    await put(day, extra).expect(422);
    const dup = payload();
    dup.entries[1] = dup.entries[0]!;
    await put(day, dup).expect(400);
    expect(await h.prisma.attendanceDay.count()).toBe(0);
  });

  it('a withdrawn student leaves the roster, so a register that still lists them is a mismatch', async () => {
    await h.prisma.enrollment.updateMany({ where: { studentId: w.roster[2] }, data: { state: 'WITHDRAWN' } });
    await put(daysAgo(0), payload()).expect(422);
  });

  it('concurrent first writes for the same register create one day, never a 500', async () => {
    const day = daysAgo(0);
    const results = await Promise.all(Array.from({ length: 6 }, () => put(day, payload({ capturedAt: new Date(Date.now() - 1000).toISOString() }))));
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(results.some((r) => r.status === 200 && r.body.outcome === 'CREATED')).toBe(true);
    expect(await h.prisma.attendanceDay.count()).toBe(1);
    expect(await h.prisma.attendanceEntry.count()).toBe(3);
  });

  it('clamps a future capturedAt so a wrong phone clock cannot pin the day', async () => {
    const day = daysAgo(0);
    const far = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const first = await put(day, payload({ capturedAt: far })).expect(200);
    expect(new Date(first.body.capturedAt).getTime()).toBeLessThanOrEqual(Date.now());
    await put(day, payload({ status: 'LATE' })).expect(200);
  });

  it('refuses future dates, holidays, dates outside the teacher window, and non-running sessions', async () => {
    const tomorrow = daysAgo(-1);
    expect((await put(tomorrow, payload()).expect(422)).body.code).toBe('ATTENDANCE_DATE_NOT_ALLOWED');
    const old = daysAgo(8);
    expect((await put(old, payload()).expect(422)).body.code).toBe('ATTENDANCE_DATE_NOT_ALLOWED');
    await put(daysAgo(7), payload()).expect(200);
    await h.prisma.holiday.create({ data: { sessionId: w.session.id, date: new Date(`${daysAgo(2)}T00:00:00Z`), label: 'Founders Day' } });
    const hol = await put(daysAgo(2), payload()).expect(422);
    expect(hol.body.detail).toContain('Founders Day');
    await h.prisma.academicSession.update({ where: { id: w.session.id }, data: { state: 'CLOSED' } });
    expect((await put(daysAgo(0), payload()).expect(422)).body.code).toBe('ATTENDANCE_SESSION_NOT_RUNNING');
  });

  it('the office has no edit window, and its correction is audited', async () => {
    const office = await login(h, w.office.email);
    await put(daysAgo(0), payload()).expect(200);
    const old = daysAgo(30);
    await put(old, payload(), office).expect(200);
    await put(old, payload({ status: 'LEAVE' }), office).expect(200);
    expect(await h.prisma.auditLog.count({ where: { action: 'attendance.correct' } })).toBe(1);
  });

  it('finalising locks the teacher out but not the office', async () => {
    const office = await login(h, w.office.email);
    const day = daysAgo(0);
    await put(day, payload({ capturedAt: new Date(Date.now() - 5000).toISOString() })).expect(200);
    await h.http().post(`/api/v1/admin/sections/${w.sectionA.id}/attendance/${day}/finalise`).set(bearer(office)).expect(200);
    expect((await put(day, payload()).expect(409)).body.code).toBe('ATTENDANCE_FINALISED');
    await put(day, payload(), office).expect(200);
    await h.http().delete(`/api/v1/admin/sections/${w.sectionA.id}/attendance/${day}/finalise`).set(bearer(office)).expect(200);
    await put(day, payload({ status: 'LATE' })).expect(200);
  });

  it('a teacher can only write their own section, a parent never', async () => {
    await put(daysAgo(0), payload(), teacher, w.sectionB.id).expect(404);
    const parent = await activateParent(h, w, w.familyA);
    await put(daysAgo(0), payload(), parent).expect(403);
  });

  it('a subject teacher may read the roster but not submit', async () => {
    const sub = await h.prisma.staff.findFirstOrThrow({ where: { userId: w.teacherB.id } });
    await h.prisma.sectionSubjectTeacher.create({ data: { sectionId: w.sectionA.id, staffId: sub.id, subject: 'Maths' } });
    const tb = await login(h, w.teacherB.email);
    await h.http().get(`/api/v1/sections/${w.sectionA.id}/roster`).set(bearer(tb)).expect(200);
    await put(daysAgo(0), payload(), tb).expect(404);
  });

  it('getDay returns a blank sheet with roster, then the stored register', async () => {
    const day = daysAgo(0);
    const blank = await h.http().get(`/api/v1/sections/${w.sectionA.id}/attendance/${day}`).set(bearer(teacher)).expect(200);
    expect(blank.body).toMatchObject({ marked: false, day: null, canSubmit: true });
    expect(blank.body.roster).toHaveLength(3);
    await put(day, payload()).expect(200);
    const done = await h.http().get(`/api/v1/sections/${w.sectionA.id}/attendance/${day}`).set(bearer(teacher)).expect(200);
    expect(done.body.marked).toBe(true);
    expect(done.body.day.entries).toHaveLength(3);
  });

  it('mySections tells the client the server date and which register is done', async () => {
    const res = await h.http().get('/api/v1/staff/me/sections').set(bearer(teacher)).expect(200);
    expect(res.body.today).toBe(schoolToday());
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.sections[0]).toMatchObject({ relationship: 'CLASS_TEACHER', canMarkAttendance: true, todayMarked: false });
  });

  it('parents see attendance with holidays marked and counts that exclude holidays', async () => {
    const parent = await activateParent(h, w, w.familyA);
    const today = schoolToday();
    await put(today, payload({ status: 'ABSENT' })).expect(200);
    const res = await h.http().get(`/api/v1/children/${w.roster[0]}/attendance`).set(bearer(parent)).expect(200);
    const row = (res.body.days as Body[]).find((d) => d.date === today)!;
    expect(row.status).toBe('ABSENT');
    expect(res.body.summary).toMatchObject({ absent: 1, workingDays: 1 });
  });
});
