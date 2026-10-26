import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { StorageService } from '../../src/storage/storage.service';
import type { Config } from '../../src/config';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeService(root: string): StorageService {
  return new StorageService({ FILE_STORAGE_ROOT: root, FILE_SIGNING_SECRET: 'unit-test-signing-secret-unit-test-0000000' } as Config);
}

describe('StorageService', () => {
  const root = `./var/test-storage-unit/${randomUUID()}`;
  const storage = makeService(root);
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('sniffs real JPEG content regardless of claimed type', async () => {
    const sniffed = await storage.sniff(Buffer.concat([JPEG_MAGIC, Buffer.alloc(100)]));
    expect(sniffed?.mime).toBe('image/jpeg');
  });

  it('sniffs real PNG content', async () => {
    const sniffed = await storage.sniff(Buffer.concat([PNG_MAGIC, Buffer.alloc(100)]));
    expect(sniffed?.mime).toBe('image/png');
  });

  it('rejects an executable renamed to look like a jpeg: sniffing finds its real type, not jpeg', async () => {
    // MZ header: a Windows PE/EXE, however it is named or labelled by the client.
    const exe = Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(200)]);
    const sniffed = await storage.sniff(exe);
    expect(sniffed?.mime).not.toBe('image/jpeg');
    expect(sniffed?.mime).not.toBe('image/png');
  });

  it('returns null for content with no recognisable signature (caller must then reject)', async () => {
    const sniffed = await storage.sniff(Buffer.from('just some plain text, not a real file format', 'utf8'));
    expect(sniffed).toBeNull();
  });

  it('writes and reads back exactly what was stored', async () => {
    const buf = Buffer.concat([JPEG_MAGIC, Buffer.from('payload')]);
    const { fileKey, sizeBytes } = await storage.put(buf, { prefix: 'test', mimeType: 'image/jpeg' });
    expect(sizeBytes).toBe(buf.length);
    const read = await storage.get(fileKey);
    expect(read.equals(buf)).toBe(true);
  });

  it('a signed URL verifies while unexpired and with the right key/mime', () => {
    const { url } = storage.signUrl('test/abc', 'image/jpeg', 60);
    const u = new URL(url, 'http://localhost');
    const exp = Number(u.searchParams.get('exp'));
    const sig = u.searchParams.get('sig')!;
    expect(storage.verify('test/abc', 'image/jpeg', exp, sig)).toBe(true);
  });

  it('a signed URL is rejected once expired', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const sig = (storage as any).sign('test/abc', 'image/jpeg', past);
    expect(storage.verify('test/abc', 'image/jpeg', past, sig)).toBe(false);
  });

  it('a tampered signature, key or mime is rejected', () => {
    const { url } = storage.signUrl('test/abc', 'image/jpeg', 60);
    const u = new URL(url, 'http://localhost');
    const exp = Number(u.searchParams.get('exp'));
    const sig = u.searchParams.get('sig')!;
    expect(storage.verify('test/other-key', 'image/jpeg', exp, sig)).toBe(false);
    expect(storage.verify('test/abc', 'image/png', exp, sig)).toBe(false);
    const flippedLastChar = sig.at(-1) === '0' ? '1' : '0';
    expect(storage.verify('test/abc', 'image/jpeg', exp, `${sig.slice(0, -1)}${flippedLastChar}`)).toBe(false);
  });

  it('refuses to read a fileKey that tries to escape the storage root', async () => {
    await expect(storage.get('../../etc/passwd')).rejects.toBeTruthy();
  });

  it('a missing file is a 404-shaped rejection, not a crash', async () => {
    await expect(storage.get('test/does-not-exist')).rejects.toBeTruthy();
  });
});
