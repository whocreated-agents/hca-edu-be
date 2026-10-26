import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CONFIG, type Config } from '../config';
import { Problem } from '../common/problem';

/**
 * Content-sniffed magic-number signatures for the handful of formats this app ever accepts
 * (admission documents: jpeg/png/pdf; student photos: jpeg/png). `file-type` (the package listed
 * in package.json) ships ESM-only as of v21 and cannot be `import()`-ed from Jest's CommonJS vm
 * sandbox without `--experimental-vm-modules` (a Jest/Node limitation, not fixable here without
 * migrating the whole test suite to ESM). Sniffing the small, fixed set of magic numbers this app
 * actually needs is simpler and dependency-free, and is exactly as resistant to a renamed/relabelled
 * file as a library sniff would be: the check is on bytes, never on filename or claimed MIME type.
 */
const SIGNATURES: { mime: string; ext: string; magic: number[] }[] = [
  { mime: 'image/jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'application/pdf', ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
];

export interface PutResult {
  fileKey: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

const DEFAULT_SIGNED_URL_TTL_SECONDS = 10 * 60;

/**
 * Local-volume storage behind a narrow interface (ADR-001): callers never see a filesystem path,
 * only a `fileKey` and, for serving, a signed URL. Swapping the backing store for S3 later means
 * replacing this file only.
 *
 * Size caps and allowed-type sets are policy decisions that differ per use (admission documents vs
 * student photos) and are validated by the CALLER, not here (see admin-students.ts / public.ts
 * comments for the exact limits).
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    this.root = resolve(cfg.FILE_STORAGE_ROOT);
  }

  /** Sniffs the real type from content (never the client's claimed MIME type or filename). See {@link SIGNATURES}. */
  sniff(buffer: Buffer): Promise<{ mime: string; ext: string } | null> {
    for (const sig of SIGNATURES) {
      if (buffer.length >= sig.magic.length && sig.magic.every((byte, i) => buffer[i] === byte)) {
        return Promise.resolve({ mime: sig.mime, ext: sig.ext });
      }
    }
    return Promise.resolve(null);
  }

  async put(buffer: Buffer, opts: { prefix: string; mimeType: string; ext?: string }): Promise<PutResult> {
    const fileKey = `${opts.prefix}/${randomUUID()}${opts.ext ? `.${opts.ext}` : ''}`;
    const abs = this.pathFor(fileKey);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buffer);
    return { fileKey, mimeType: opts.mimeType, sizeBytes: buffer.length };
  }

  async get(fileKey: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(fileKey));
    } catch {
      throw Problem.notFound();
    }
  }

  async delete(fileKey: string): Promise<void> {
    await rm(this.pathFor(fileKey), { force: true });
  }

  /** A short-lived HMAC-signed URL for GET /files/:key. The signature covers key, mime and expiry. */
  signUrl(fileKey: string, mimeType: string, ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS): SignedUrl {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(fileKey, mimeType, exp);
    const url = `/api/v1/files/${encodeURIComponent(fileKey)}?exp=${exp}&mime=${encodeURIComponent(mimeType)}&sig=${sig}`;
    return { url, expiresAt: new Date(exp * 1000) };
  }

  /** Verifies a signature produced by {@link signUrl}. False on any mismatch, tamper or expiry. */
  verify(fileKey: string, mimeType: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = this.sign(fileKey, mimeType, exp);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(fileKey: string, mimeType: string, exp: number): string {
    return createHmac('sha256', this.cfg.FILE_SIGNING_SECRET).update(`${fileKey}:${mimeType}:${exp}`).digest('hex');
  }

  /** No `..` segments reach the filesystem: fileKeys are always server-generated, but this is cheap insurance. */
  private pathFor(fileKey: string): string {
    if (fileKey.includes('..') || fileKey.startsWith('/')) throw Problem.notFound();
    return join(this.root, fileKey);
  }
}
