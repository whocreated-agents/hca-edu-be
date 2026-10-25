import { REFRESH_COOKIE_NAME, LOGIN_MAX_FAILURES } from '@hca/contracts';
import { activateParent, bearer, Harness, PASSWORD, resetDb, seedWorld, startApp, World } from './harness';

type Body = Record<string, any>;

describe('auth', () => {
  let h: Harness;
  let w: World;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.app.close(); });
  beforeEach(async () => { await resetDb(h); w = await seedWorld(h); });

  const slip = async (fam = w.familyA) => (await h.auth.reissueCode({ id: w.office.id, role: 'OFFICE' }, fam.userId, { ip: null, userAgent: null })).code;
  const cookieOf = (res: { headers: Record<string, unknown> }): string => {
    const raw = (res.headers['set-cookie'] as string[] | undefined)?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    if (!raw) throw new Error('no refresh cookie');
    return raw.split(';')[0]!;
  };
  const staffLogin = async (email: string) => ((await h.http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body as Body).accessToken as string;

  it('activates with a code, sets the password, burns the code, and sets an httpOnly cookie', async () => {
    const code = await slip();
    const res = await h.http().post('/api/v1/auth/activate').send({ identifier: w.familyA.phone, code, newPassword: PASSWORD, rememberDevice: true }).expect(200);
    expect((res.body as Body).user.needsEmail).toBe(true);
    const sc = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    expect(sc).toMatch(/Path=\/api\/v1\/auth/);
    await h.http().post('/api/v1/auth/activate').send({ identifier: w.familyA.phone, code, newPassword: 'another password 1' }).expect(401);
    await h.http().post('/api/v1/auth/login').send({ identifier: w.familyA.phone, password: PASSWORD }).expect(200);
  });

  it('rejects a wrong code, and a code that belongs to another family', async () => {
    const codeB = await slip(w.familyB);
    await slip();
    await h.http().post('/api/v1/auth/activate').send({ identifier: w.familyA.phone, code: codeB, newPassword: PASSWORD }).expect(401);
    await h.http().post('/api/v1/auth/activate').send({ identifier: w.familyA.phone, code: 'AAAAA-AAAAA', newPassword: PASSWORD }).expect(401);
  });

  it('login fails with one generic error for unknown user and wrong password', async () => {
    await activateParent(h, w, w.familyA);
    const wrong = await h.http().post('/api/v1/auth/login').send({ identifier: w.familyA.phone, password: 'nope-nope-nope' }).expect(401);
    const unknown = await h.http().post('/api/v1/auth/login').send({ identifier: '9999999999', password: 'nope-nope-nope' }).expect(401);
    expect((wrong.body as Body).code).toBe('INVALID_CREDENTIALS');
    expect((unknown.body as Body).code).toBe('INVALID_CREDENTIALS');
    expect(wrong.headers['content-type']).toMatch(/problem\+json/);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    await activateParent(h, w, w.familyA);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await h.http().post('/api/v1/auth/login').send({ identifier: w.familyA.phone, password: 'wrong-wrong' }).expect(401);
    const res = await h.http().post('/api/v1/auth/login').send({ identifier: w.familyA.phone, password: PASSWORD }).expect(423);
    expect((res.body as Body).code).toBe('ACCOUNT_LOCKED');
  });

  it('rotates refresh tokens and kills the whole family when an old one is replayed', async () => {
    const c1 = cookieOf(await h.http().post('/api/v1/auth/login').send({ identifier: w.teacherA.email, password: PASSWORD }).expect(200));
    const c2 = cookieOf(await h.http().post('/api/v1/auth/refresh').set('Cookie', c1).expect(200));
    expect(c2).not.toBe(c1);
    await h.http().post('/api/v1/auth/refresh').set('Cookie', c1).expect(401);
    await h.http().post('/api/v1/auth/refresh').set('Cookie', c2).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const c = cookieOf(await h.http().post('/api/v1/auth/login').send({ identifier: w.teacherA.email, password: PASSWORD }).expect(200));
    await h.http().post('/api/v1/auth/logout').set('Cookie', c).expect(204);
    await h.http().post('/api/v1/auth/refresh').set('Cookie', c).expect(401);
  });

  it('emailed reset: works once, only to the address on record, and revokes sessions', async () => {
    const access = await staffLogin(w.teacherA.email);
    h.mailer.outbox.length = 0;
    await h.http().post('/api/v1/auth/password/forgot').send({ identifier: w.teacherA.email }).expect(202);
    await h.http().post('/api/v1/auth/password/forgot').send({ identifier: 'nobody@hca.test' }).expect(202);
    expect(h.mailer.outbox).toHaveLength(1);
    expect(h.mailer.outbox[0]!.to).toBe(w.teacherA.email);
    const token = /token=([\w-]+)/.exec(h.mailer.outbox[0]!.text)![1]!;
    await h.http().post('/api/v1/auth/password/reset').send({ token, newPassword: 'brand new password 9' }).expect(200);
    await h.http().post('/api/v1/auth/password/reset').send({ token, newPassword: 'yet another one 99' }).expect(400);
    await h.http().get('/api/v1/auth/me').set(bearer(access)).expect(401);
    await h.http().post('/api/v1/auth/login').send({ identifier: w.teacherA.email, password: PASSWORD }).expect(401);
    await h.http().post('/api/v1/auth/login').send({ identifier: w.teacherA.email, password: 'brand new password 9' }).expect(200);
  });

  it('never mails a reset link to an unverified address', async () => {
    await activateParent(h, w, w.familyA);
    await h.prisma.user.update({ where: { id: w.familyA.userId }, data: { email: 'typo@example.test', emailVerifiedAt: null } });
    h.mailer.outbox.length = 0;
    await h.http().post('/api/v1/auth/password/forgot').send({ identifier: w.familyA.phone }).expect(202);
    expect(h.mailer.outbox).toHaveLength(0);
  });

  it('parent email: set, verify by link, then needsEmail clears', async () => {
    const access = await activateParent(h, w, w.familyA);
    h.mailer.outbox.length = 0;
    await h.http().put('/api/v1/auth/me/email').set(bearer(access)).send({ email: 'mum@example.test' }).expect(202);
    const token = /token=([\w-]+)/.exec(h.mailer.outbox[0]!.text)![1]!;
    await h.http().post('/api/v1/auth/email/verify').send({ token }).expect(200);
    const me = await h.http().get('/api/v1/auth/me').set(bearer(access)).expect(200);
    expect((me.body as Body).needsEmail).toBe(false);
  });

  it('office reissue invalidates the old password, tokens and sessions', async () => {
    const oldAccess = await activateParent(h, w, w.familyA);
    const oldCookie = cookieOf(await h.http().post('/api/v1/auth/login').send({ identifier: w.familyA.phone, password: PASSWORD }).expect(200));
    const officeTok = await staffLogin(w.office.email);

    const issued = await h.http().post(`/api/v1/admin/users/${w.familyA.userId}/activation-code`).set(bearer(officeTok)).expect(201);
    expect((issued.body as Body).code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    await h.http().get('/api/v1/auth/me').set(bearer(oldAccess)).expect(401);
    await h.http().post('/api/v1/auth/refresh').set('Cookie', oldCookie).expect(401);
    await h.http().post('/api/v1/auth/login').send({ identifier: w.familyA.phone, password: PASSWORD }).expect(401);
    await h.http().post('/api/v1/auth/activate').send({ identifier: w.familyA.phone, code: (issued.body as Body).code, newPassword: 'fresh password 123' }).expect(200);
  });

  it('parents cannot issue codes; office cannot reissue its own or staff codes', async () => {
    const parentTok = await activateParent(h, w, w.familyA);
    await h.http().post(`/api/v1/admin/users/${w.familyB.userId}/activation-code`).set(bearer(parentTok)).expect(403);
    const officeTok = await staffLogin(w.office.email);
    await h.http().post(`/api/v1/admin/users/${w.office.id}/activation-code`).set(bearer(officeTok)).expect(403);
    await h.http().post(`/api/v1/admin/users/${w.teacherA.id}/activation-code`).set(bearer(officeTok)).expect(403);
  });

  it('suspending a user kills their access token immediately', async () => {
    const access = await activateParent(h, w, w.familyA);
    const officeTok = await staffLogin(w.office.email);
    await h.http().patch(`/api/v1/admin/users/${w.familyA.userId}/status`).set(bearer(officeTok)).send({ status: 'SUSPENDED' }).expect(200);
    await h.http().get('/api/v1/auth/me').set(bearer(access)).expect(401);
    const r = await h.http().post('/api/v1/auth/login').send({ identifier: w.familyA.phone, password: PASSWORD }).expect(403);
    expect((r.body as Body).code).toBe('ACCOUNT_SUSPENDED');
  });

  it('rejects malformed or unexpected input with a validation problem, not a 500', async () => {
    const r = await h.http().post('/api/v1/auth/login').send({ identifier: 'x', password: '' }).expect(400);
    expect((r.body as Body).code).toBe('VALIDATION_FAILED');
    await h.http().post('/api/v1/auth/login').send({ identifier: w.office.email, password: PASSWORD, isAdmin: true }).expect(400);
  });
});
