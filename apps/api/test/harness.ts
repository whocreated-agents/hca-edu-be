import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { AuthService } from '../src/auth/auth.service';
import { MailerService } from '../src/mail/mailer.service';
import { PrismaService } from '../src/prisma.service';

export const PASSWORD = 'correct horse battery';

export async function startApp(over: Record<string, string> = {}) {
  const url = process.env.TEST_DATABASE_URL!;
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0000',
    TOKEN_PEPPER: 'test-pepper-test-pepper-test-pepper-0000',
    COOKIE_SECURE: 'false',
    TRUST_PROXY: 'false',
    RATE_LIMIT_ENABLED: 'false',
    ARGON2_FAST: 'true',
    MAIL_TRANSPORT: 'memory',
    FIELD_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    FILE_STORAGE_ROOT: `./var/test-storage/${randomUUID()}`,
    FILE_SIGNING_SECRET: 'test-file-signing-secret-test-file-signing-0000',
    ...over,
  });
  const app: NestExpressApplication = await createApp(config);
  await app.init();
  const server = app.getHttpServer() as any;
  if (server && typeof server.setMaxListeners === 'function') server.setMaxListeners(50);
  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    auth: app.get(AuthService),
    mailer: app.get(MailerService),
  };
}
export type Harness = Awaited<ReturnType<typeof startApp>>;

export async function resetDb(h: Harness): Promise<void> {
  const rows = await h.prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await h.prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

let phoneSeq = 6000000000;
export const nextPhone = (): string => String(phoneSeq++);

export interface World {
  admin: { id: string; email: string };
  office: { id: string; email: string };
  session: { id: string };
  sectionA: { id: string };
  sectionB: { id: string };
  teacherA: { id: string; email: string };
  teacherB: { id: string; email: string };
  familyA: { phone: string; userId: string; studentIds: string[] };
  familyB: { phone: string; userId: string; studentIds: string[] };
  roster: string[]; // students of sectionA
}

/** Two sections, two class teachers, two families (A has two children, B has one in the other section). */
export async function seedWorld(h: Harness): Promise<World> {
  const p = h.prisma;
  const hash = await h.app.get(await import('../src/auth/crypto.service').then((m) => m.CryptoService)).hashSecret(PASSWORD);
  const staffUser = async (role: 'SUPER_ADMIN' | 'OFFICE' | 'TEACHER', n: string) =>
    p.user.create({ data: { role, status: 'ACTIVE', email: `${n}@hca.test`, emailVerifiedAt: new Date(), passwordHash: hash } });
  const admin = await staffUser('SUPER_ADMIN', 'admin');
  const office = await staffUser('OFFICE', 'office');
  const tuA = await staffUser('TEACHER', 'teacher-a');
  const tuB = await staffUser('TEACHER', 'teacher-b');
  const staff = (userId: string, code: string, fullName: string) =>
    p.staff.create({ data: { userId, employeeCode: code, fullName, designation: 'Teacher', phone: nextPhone(), joinedOn: new Date('2020-04-01') } });
  const sa = await staff(tuA.id, 'T-A', 'Teacher A');
  const sb = await staff(tuB.id, 'T-B', 'Teacher B');

  const session = await p.academicSession.create({ data: { label: '2099-00', startsOn: new Date('2000-01-01'), endsOn: new Date('2099-12-31'), state: 'RUNNING' } });
  const cl = await p.classLevel.create({ data: { name: 'Class T', order: 99, stage: 'PRIMARY' } });
  const sectionA = await p.section.create({ data: { sessionId: session.id, classLevelId: cl.id, name: 'A', classTeacherId: sa.id } });
  const sectionB = await p.section.create({ data: { sessionId: session.id, classLevelId: cl.id, name: 'B', classTeacherId: sb.id } });

  let adm = 1;
  const student = async (sectionId: string, rollNo: number, name: string) => {
    const s = await p.student.create({ data: { admissionNo: `T${adm++}`, fullName: name, dob: new Date('2015-05-05'), gender: 'FEMALE' } });
    await p.enrollment.create({ data: { studentId: s.id, sessionId: session.id, sectionId, rollNo } });
    return s.id;
  };
  const family = async (tag: string, kids: string[]) => {
    const phone = nextPhone();
    const user = await p.user.create({ data: { role: 'PARENT', status: 'INVITED', phone } });
    const g = await p.guardian.create({ data: { userId: user.id, fullName: `Parent ${tag}`, relation: 'Mother', phone } });
    for (const k of kids) await p.studentGuardian.create({ data: { studentId: k, guardianId: g.id, isPrimary: true } });
    return { phone, userId: user.id, studentIds: kids };
  };
  const a1 = await student(sectionA.id, 1, 'A One');
  const a2 = await student(sectionA.id, 2, 'A Two');
  const a3 = await student(sectionA.id, 3, 'A Three');
  const b1 = await student(sectionB.id, 1, 'B One');
  return {
    admin: { id: admin.id, email: admin.email! },
    office: { id: office.id, email: office.email! },
    session,
    sectionA,
    sectionB,
    teacherA: { id: tuA.id, email: tuA.email! },
    teacherB: { id: tuB.id, email: tuB.email! },
    familyA: await family('A', [a1, a2]),
    familyB: await family('B', [b1]),
    roster: [a1, a2, a3],
  };
}

/** Issue a slip and activate the account through the real HTTP flow; returns the access token. */
export async function activateParent(h: Harness, w: World, fam: { phone: string; userId: string }): Promise<string> {
  const { code } = await h.auth.reissueCode({ id: w.office.id, role: 'OFFICE' }, fam.userId, { ip: null, userAgent: null });
  const res = await h.http().post('/api/v1/auth/activate').send({ identifier: fam.phone, code, newPassword: PASSWORD }).expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

export async function login(h: Harness, identifier: string, password = PASSWORD): Promise<string> {
  const res = await h.http().post('/api/v1/auth/login').send({ identifier, password }).expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
export const uuid = randomUUID;
