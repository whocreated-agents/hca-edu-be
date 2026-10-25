import { execSync } from 'node:child_process';

export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://hemantkumar@localhost:5432/hca_who3_test';
  if (!/test/.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test"');
  process.env.TEST_DATABASE_URL = url;
  execSync('npx prisma migrate deploy', { cwd: `${__dirname}/../../..`, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
