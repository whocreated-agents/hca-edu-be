import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import * as C from '../src';

const all = C.allRoutes();
const key = (r: { def: C.RouteDef }) => `${r.def.method} ${r.def.path}`;

describe('route registry', () => {
  it('has no duplicate method+path', () => {
    const seen = new Set<string>();
    for (const r of all) {
      expect(seen.has(key(r))).toBe(false);
      seen.add(key(r));
    }
  });

  it('every path param in the path is declared in params', () => {
    for (const r of all) {
      const names = [...r.def.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
      const shape = (r.def.params as z.ZodObject).shape as Record<string, unknown>;
      for (const n of names) expect({ route: key(r), n, declared: n in shape }).toEqual({ route: key(r), n, declared: true });
    }
  });

  it('every relation param exists in the path', () => {
    for (const r of all) {
      if (r.def.access.kind === 'roles' && r.def.access.relation) {
        expect(r.def.path).toContain(`:${r.def.access.relation.param}`);
      }
    }
  });

  it('only /public, /auth and the stage-2 token routes are anonymous', () => {
    for (const r of all) {
      if (r.def.access.kind === 'public') expect(r.def.path).toMatch(/^\/(public|auth)\//);
    }
  });

  it('every /admin route is closed to PARENT, TEACHER and STUDENT unless explicitly allowed', () => {
    for (const r of all.filter((x) => x.def.path.startsWith('/admin'))) {
      expect(r.def.access.kind).toBe('roles');
      if (r.def.access.kind === 'roles') {
        expect(r.def.access.roles).not.toContain('PARENT');
        expect(r.def.access.roles).not.toContain('STUDENT');
        expect(r.def.access.roles).not.toContain('TEACHER');
      }
    }
  });

  it('every route addressing a child or a section carries a relation check', () => {
    for (const r of all) {
      if (r.def.access.kind !== 'roles') continue;
      if (r.def.path.startsWith('/children/')) expect(r.def.access.relation?.resource).toBe('student');
      if (r.def.path.startsWith('/sections/')) expect(r.def.access.relation?.resource).toBe('section');
    }
  });

  it('covers every endpoint listed in BLUEPRINT-001 section 4', () => {
    const must = [
      'GET /public/profile', 'GET /public/content', 'GET /public/notices', 'GET /public/fees', 'GET /public/session',
      'POST /public/enquiries', 'POST /auth/login', 'POST /auth/activate', 'POST /auth/password/forgot',
      'POST /auth/password/reset', 'POST /auth/password/change', 'POST /auth/refresh', 'POST /auth/logout',
      'GET /me/children', 'GET /children/:id', 'GET /children/:id/fees', 'GET /children/:id/attendance', 'GET /me/notices',
      'GET /staff/me/sections', 'GET /sections/:id/roster', 'GET /sections/:id/attendance/:date',
      'PUT /sections/:id/attendance/:date', 'GET /admin/applications', 'PATCH /admin/applications/:id/status',
      'GET /admin/audit', 'GET /admin/students/:id/sensitive', 'PUT /admin/students/:id/sensitive',
      'POST /admin/users/:id/activation-code',
    ];
    const have = new Set(all.map(key));
    expect(must.filter((m) => !have.has(m))).toEqual([]);
  });

  it('sensitive-tier routes are OFFICE+ only (no ACCOUNTS)', () => {
    for (const m of ['GET', 'PUT']) {
      const r = all.find((x) => key(x) === `${m} /admin/students/:id/sensitive`)!;
      expect(r.def.access).toMatchObject({ kind: 'roles' });
      if (r.def.access.kind === 'roles') expect([...r.def.access.roles].sort()).toEqual(['OFFICE', 'SUPER_ADMIN']);
    }
  });

  it('login-class routes are marked sensitive for rate limiting', () => {
    for (const p of ['/auth/login', '/auth/activate', '/auth/password/forgot', '/auth/password/reset']) {
      expect(all.find((x) => x.def.path === p)!.def.sensitive).toBe(true);
    }
  });
});

describe('prisma parity', () => {
  const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const prismaEnums = [...schema.matchAll(/^enum (\w+) \{([^}]*)\}/gms)].map((m) => ({
    name: m[1]!,
    values: m[2]!.split('\n').map((l) => l.replace(/\/\/.*/, '').trim()).filter(Boolean),
  }));
  it('every Prisma enum has an identical contract enum', () => {
    const ours = C as unknown as Record<string, unknown>;
    for (const e of prismaEnums) {
      const z_ = ours[e.name] as z.ZodEnum | undefined;
      if (!z_) continue; // internal-only enums are not on the wire
      expect({ e: e.name, v: [...z_.options] }).toEqual({ e: e.name, v: e.values });
    }
  });
  it('the wire-visible enums are all present', () => {
    const names = prismaEnums.map((e) => e.name);
    for (const n of ['Role', 'SessionState', 'AttendanceStatus', 'InvoiceStatus', 'ApplicationStatus']) expect(names).toContain(n);
  });
});

describe('attendance submission', () => {
  const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const base = { mutationId: sid(99), capturedAt: '2026-10-26T03:00:00Z' };
  it('accepts a full register', () => {
    expect(C.AttendanceSubmission.safeParse({ ...base, entries: [{ studentId: sid(1), status: 'PRESENT' }, { studentId: sid(2), status: 'ABSENT' }] }).success).toBe(true);
  });
  it('rejects duplicate students, empty registers and unknown fields', () => {
    expect(C.AttendanceSubmission.safeParse({ ...base, entries: [{ studentId: sid(1), status: 'PRESENT' }, { studentId: sid(1), status: 'ABSENT' }] }).success).toBe(false);
    expect(C.AttendanceSubmission.safeParse({ ...base, entries: [] }).success).toBe(false);
    expect(C.AttendanceSubmission.safeParse({ ...base, extra: 1, entries: [{ studentId: sid(1), status: 'PRESENT' }] }).success).toBe(false);
  });
  it('requires a client-generated mutationId (idempotency key)', () => {
    expect(C.AttendanceSubmission.safeParse({ capturedAt: base.capturedAt, entries: [{ studentId: sid(1), status: 'PRESENT' }] }).success).toBe(false);
  });
});

describe('primitives', () => {
  it('normalises phones', () => {
    for (const v of ['94605 40956', '+91 94605-40956', '09460540956']) expect(C.Phone.parse(v)).toBe('9460540956');
    expect(C.Phone.safeParse('12345').success).toBe(false);
  });
  it('normalises activation codes and rejects look-alikes', () => {
    expect(C.ActivationCodeInput.parse('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(C.ActivationCodeInput.safeParse('ABCDE-FGHJ0').success).toBe(false);
  });
  it('money is a decimal string, never a number', () => {
    expect(C.Money.safeParse('1250.50').success).toBe(true);
    expect(C.Money.safeParse(1250).success).toBe(false);
    expect(C.Money.safeParse('12.505').success).toBe(false);
  });
  it('yearsSince computes from foundedOn and rolls on the anniversary', () => {
    expect(C.yearsSince('2003-04-15', new Date('2026-04-14T00:00:00Z'))).toBe(22);
    expect(C.yearsSince('2003-04-15', new Date('2026-04-15T00:00:00Z'))).toBe(23);
  });
  it('buildPath substitutes and encodes', () => {
    expect(C.buildPath({ path: '/children/:id' }, { id: 'a b' })).toBe('/api/v1/children/a%20b');
    expect(() => C.buildPath({ path: '/children/:id' })).toThrow();
  });
});
