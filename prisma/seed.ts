import { randomBytes } from 'node:crypto';
import { PrismaClient, type ClassStage } from '@prisma/client';
import argon2 from 'argon2';

/**
 * Idempotent: safe to run on every `docker compose up`. Creates reference data only. It ships NO
 * fee amounts (board decision 9) and no student data.
 *
 * The session is data, not a constant: its label and dates come from SEED_SESSION_* if set, else
 * from the next 1 April after "now" -- so a fresh install is UPCOMING with admissions open, which
 * is the state the school is actually in, and no year appears in this file.
 */

const prisma = new PrismaClient();

const LEVELS: { name: string; stage: ClassStage; minAge: number | null }[] = [
  { name: 'Nursery', stage: 'PRE_PRIMARY', minAge: 3 },
  { name: 'LKG', stage: 'PRE_PRIMARY', minAge: 4 },
  { name: 'UKG', stage: 'PRE_PRIMARY', minAge: 5 },
  { name: 'Class I', stage: 'PRIMARY', minAge: 6 },
  { name: 'Class II', stage: 'PRIMARY', minAge: 7 },
  { name: 'Class III', stage: 'PRIMARY', minAge: 8 },
  { name: 'Class IV', stage: 'PRIMARY', minAge: 9 },
  { name: 'Class V', stage: 'PRIMARY', minAge: 10 },
  { name: 'Class VI', stage: 'MIDDLE', minAge: 11 },
  { name: 'Class VII', stage: 'MIDDLE', minAge: 12 },
  { name: 'Class VIII', stage: 'MIDDLE', minAge: 13 },
  { name: 'Class IX', stage: 'SECONDARY', minAge: 14 },
  { name: 'Class X', stage: 'SECONDARY', minAge: 15 },
];

const FEE_HEADS = [
  { name: 'Tuition', isRecurring: true },
  { name: 'Transport', isRecurring: true },
  { name: 'Admission', isRecurring: false },
  { name: 'Annual Charges', isRecurring: false },
  { name: 'Examination', isRecurring: false },
  { name: 'Books & Stationery', isRecurring: false },
];

function nextAprilFirst(now = new Date()): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 3 ? y + 1 : y;
}

async function main(): Promise<void> {
  // BLUEPRINT/PRD say "14 levels"; Nursery, LKG, UKG + Class I..X is 13. Seeding what exists.
  for (const [i, l] of LEVELS.entries()) {
    await prisma.classLevel.upsert({
      where: { name: l.name },
      update: {},
      create: { name: l.name, order: i + 1, stage: l.stage, minAge: l.minAge, maxAge: l.minAge === null ? null : l.minAge + 1 },
    });
  }

  for (const h of FEE_HEADS) {
    await prisma.feeHead.upsert({ where: { name: h.name }, update: {}, create: h });
  }

  if ((await prisma.academicSession.count()) === 0) {
    const startYear = process.env.SEED_SESSION_START_YEAR ? Number(process.env.SEED_SESSION_START_YEAR) : nextAprilFirst();
    const yy = String((startYear + 1) % 100).padStart(2, '0');
    await prisma.academicSession.create({
      data: {
        label: process.env.SEED_SESSION_LABEL ?? `${startYear}-${yy}`,
        startsOn: new Date(Date.UTC(startYear, 3, 1)),
        endsOn: new Date(Date.UTC(startYear + 1, 2, 31)),
        state: 'UPCOMING',
        isAdmissionOpen: true,
      },
    });
  }

  await prisma.schoolProfile.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Hemant Children Academy',
      addressLines: ['Shiv Colony', 'Pilani, Rajasthan - 333031'],
      phones: ['+91 94605 40956', '+91 94139 35511'],
      email: 'info@hca.edu.in',
      hours: 'Mon - Sat: 8:00 AM - 2:00 PM',
      socials: {},
      foundedOn: new Date(Date.UTC(2003, 3, 15)),
      board: 'Rajasthan Board of Secondary Education (RBSE)',
      registrationNo: '103 JJN 2003-04',
    },
  });

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@hca.edu.in').toLowerCase();
  const existing = await prisma.user.findFirst({ where: { email, role: 'SUPER_ADMIN' } });
  if (!existing) {
    const generated = !process.env.SEED_ADMIN_PASSWORD;
    const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
    await prisma.user.create({
      data: {
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        email,
        emailVerifiedAt: new Date(),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    console.log(`seed: created SUPER_ADMIN ${email}`);
    if (generated) console.log(`seed: one-time password (change it on first login): ${password}`);
  }
  console.log(`seed: done (${LEVELS.length} class levels)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
