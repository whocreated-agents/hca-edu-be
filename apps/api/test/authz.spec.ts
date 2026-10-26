import { allRoutes } from '@hca/contracts';
import { activateParent, bearer, Harness, login, PASSWORD, resetDb, seedWorld, startApp, uuid, World } from './harness';

type Body = Record<string, any>;
/** Groups whose handlers exist in this PR; the rest are contract-only until the backend tasks land. */
const IMPLEMENTED = new Set<string>(['auth', 'parent', 'attendance', 'adminAcademic', 'adminStudents', 'adminAdmissions', 'public']);
// `adminFees`, `adminContent` and `adminAudit` land in later commits on this same branch, each
// adding itself to this set once its controller is fully wired. `adminContent` will stay excluded
// even then: this PR wires notices, content blocks, profile, facilities and stats, but NOT the
// media/photograph-consent routes in the same contract group (MediaAsset/MediaConsent) -- that is
// a separate DPDP-compliance workflow (file upload + cross-endpoint consent enforcement) out of
// scope for WHO-6; see the PR description for the follow-up ticket. Including the whole group here
// would fail the "every declared route is mounted" check below, since those specific routes have
// no controller.

describe('authorisation (anti-IDOR)', () => {
  let h: Harness;
  let w: World;
  let tokA: string;
  let tokB: string;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.app.close(); });
  beforeEach(async () => {
    await resetDb(h);
    w = await seedWorld(h);
    tokA = await activateParent(h, w, w.familyA);
    tokB = await activateParent(h, w, w.familyB);
  });

  const get = (path: string, tok?: string) => (tok ? h.http().get(`/api/v1${path}`).set(bearer(tok)) : h.http().get(`/api/v1${path}`));

  it('a parent sees exactly their own children', async () => {
    const res = await get('/me/children', tokA).expect(200);
    expect((res.body as Body[]).map((c) => c.student.id).sort()).toEqual([...w.familyA.studentIds].sort());
    const resB = await get('/me/children', tokB).expect(200);
    expect((resB.body as Body[]).map((c) => c.student.id)).toEqual(w.familyB.studentIds);
  });

  it.each(['', '/fees', '/attendance'])('parent B gets 404 (not 403, not data) for family A child %s', async (suffix) => {
    const foreign = w.familyA.studentIds[0]!;
    const res = await get(`/children/${foreign}${suffix}`, tokB).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('A One');
    // identical to a child that does not exist: ids cannot be probed
    const missing = await get(`/children/${uuid()}${suffix}`, tokB).expect(404);
    expect({ ...(res.body as Body), requestId: 0, instance: 0 }).toEqual({ ...(missing.body as Body), requestId: 0, instance: 0 });
    await get(`/children/${foreign}${suffix}`, tokA).expect(200);
  });

  it('a child never exposes sensitive-tier fields', async () => {
    const res = await get(`/children/${w.familyA.studentIds[0]}`, tokA).expect(200);
    const text = JSON.stringify(res.body);
    for (const k of ['aadhaar', 'Aadhaar', 'medical', 'passwordHash', 'tokenHash']) expect(text).not.toContain(k);
  });

  it('a sibling link grants access to every linked child, and only those', async () => {
    for (const id of w.familyA.studentIds) await get(`/children/${id}`, tokA).expect(200);
    await get(`/children/${w.familyB.studentIds[0]}`, tokA).expect(404);
  });

  it('a malformed id is a 404 like any unknown id, never a 500', async () => {
    await get('/children/not-a-uuid', tokA).expect(404);
  });

  it('parents cannot reach staff or admin surfaces', async () => {
    await get(`/sections/${w.sectionA.id}/roster`, tokA).expect(403);
    await get('/staff/me/sections', tokA).expect(403);
    await get('/admin/attendance/reports?from=2024-01-01&to=2024-01-31', tokA).expect(403);
  });

  it('teachers cannot read parent-only routes, nor another teacher\'s section', async () => {
    const t = await login(h, w.teacherA.email);
    await get('/me/children', t).expect(403);
    await get(`/sections/${w.sectionA.id}/roster`, t).expect(200);
    await get(`/sections/${w.sectionB.id}/roster`, t).expect(404);
    await get(`/sections/${w.sectionB.id}/attendance/2024-01-02`, t).expect(404);
  });

  it('every non-public route rejects a missing or garbage token with 401', async () => {
    const closed = allRoutes().filter((r) => IMPLEMENTED.has(r.group)).map((r) => r.def).filter((d) => d.access.kind !== 'public');
    expect(closed.length).toBeGreaterThan(10);
    for (const def of closed) {
      const path = `/api/v1${def.path.replace(/:\w+/g, uuid())}`.replace(/\/[0-9a-f-]{36}$/, (m) => (def.path.endsWith(':date') ? '/2024-01-02' : m));
      const verb = def.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      await h.http()[verb](path).expect(401);
      await h.http()[verb](path).set(bearer('garbage.token.value')).expect(401);
    }
  });

  it('a route with no declaration is denied by default', async () => {
    await h.http().get('/api/v1/definitely-not-a-route').expect(404);
    // an authenticated request to an undeclared handler would hit AccessGuard; the registry/handler parity test below covers it
  });

  it('every declared route has a mounted handler (registry parity)', () => {
    const router = (h.app.getHttpAdapter().getInstance() as any).router;
    const mounted = new Set<string>();
    for (const layer of router.stack as any[]) if (layer.route) for (const m of Object.keys(layer.route.methods)) mounted.add(`${m.toUpperCase()} ${layer.route.path}`);
    const missing = allRoutes()
      .filter((r) => IMPLEMENTED.has(r.group))
      .filter((r) => !mounted.has(`${r.def.method} /api/v1${r.def.path}`));
    expect(missing.map((r) => `${r.def.method} ${r.def.path}`)).toEqual([]);
  });

  it('a suspended parent loses access mid-session', async () => {
    await h.prisma.user.update({ where: { id: w.familyA.userId }, data: { status: 'SUSPENDED', authEpoch: { increment: 1 } } });
    await get('/me/children', tokA).expect(401);
  });

  it('login still works after activation (sanity for the fixture)', async () => {
    expect(await login(h, w.familyA.phone, PASSWORD)).toBeTruthy();
  });
});
