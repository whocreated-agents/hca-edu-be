import { z } from 'zod';

/** Everything on the wire is JSON with these primitives. No JS number ever carries money. */

export const Uuid = z.uuid();

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

/** Calendar date, `YYYY-MM-DD`, no timezone. Used for dob, paidOn, attendance date, session bounds. */
export const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(isRealDate, 'Not a real calendar date');

/** `YYYY-MM`, for month views. */
export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

/** Instant, ISO-8601 with offset (the API always emits UTC `Z`). */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Rupees as a decimal string with at most two places: "1250" or "1250.50". Never a number. */
export const Money = z.string().regex(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/, 'Expected a rupee amount like 1250 or 1250.50');

/** Strictly positive money, for payments, structure amounts and invoice lines. */
export const PositiveMoney = Money.refine((v) => Number(v) > 0, 'Must be greater than zero');

/**
 * Indian mobile, canonical form = 10 digits. Input tolerates what a person types ("+91 94605 40956",
 * "09460540956", "94605-40956") and is normalised, so the stored/queried form is one thing.
 */
export const Phone = z
  .string()
  .transform((v) => v.replace(/[\s\-().]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'));

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

/** Free text that should never be blank or absurdly long. */
export const ShortText = (max = 120) => z.string().trim().min(1).max(max);
export const LongText = (max = 10_000) => z.string().trim().min(1).max(max);

export const Password = z.string().min(8, 'At least 8 characters').max(128);

/**
 * 32-symbol alphabet with no 0/O or 1/I. Slips print it as `ABCDE-FGHJK`; input is upper-cased and
 * stripped of spaces/hyphens before matching, so reading it back over the phone is forgiving.
 */
export const ACTIVATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ACTIVATION_CODE_LENGTH = 10;
export const ActivationCodeInput = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(new RegExp(`^[${ACTIVATION_CODE_ALPHABET}]{${ACTIVATION_CODE_LENGTH}}$`), 'Invalid code'));

/** Keyset pagination. `cursor` is opaque to clients. */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});
export const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const IdParam = z.object({ id: Uuid });
export const Empty = z.object({});
export const Ack = z.object({ ok: z.literal(true) });

export type Ack = z.infer<typeof Ack>;

/** Used by the web client and the server so "years of service" has exactly one implementation. */
export function yearsSince(foundedOn: string, now: Date = new Date()): number {
  const [y, m, d] = foundedOn.split('-').map(Number) as [number, number, number];
  let years = now.getUTCFullYear() - y;
  const beforeAnniversary = now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}
