import { SCHOOL_TIMEZONE } from '@hca/contracts';
import { Prisma } from '@prisma/client';

export const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const money = (d: Prisma.Decimal | number | string): string => new Prisma.Decimal(d).toFixed(2);

/** Today's calendar date at the school (Asia/Kolkata), never the server's or a device's local date. */
export function schoolToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const encodeCursor = (offset: number): string => Buffer.from(String(offset)).toString('base64url');
export const decodeCursor = (c: string | undefined): number => {
  if (!c) return 0;
  const n = Number(Buffer.from(c, 'base64url').toString());
  return Number.isInteger(n) && n >= 0 ? n : 0;
};
