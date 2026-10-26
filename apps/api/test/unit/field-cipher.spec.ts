import { randomBytes } from 'node:crypto';
import { FieldCipherService } from '../../src/common/field-cipher.service';

function makeCipher(key = randomBytes(32).toString('base64')): FieldCipherService {
  // Construct directly: FieldCipherService only reads cfg.FIELD_ENCRYPTION_KEY.
  return new FieldCipherService({ FIELD_ENCRYPTION_KEY: key } as never);
}

describe('FieldCipherService', () => {
  it('round-trips a plaintext string', () => {
    const c = makeCipher();
    const blob = c.encrypt('123456789012');
    expect(c.decrypt(blob)).toBe('123456789012');
  });

  it('round-trips empty and unicode strings', () => {
    const c = makeCipher();
    expect(c.decrypt(c.encrypt(''))).toBe('');
    expect(c.decrypt(c.encrypt('नमस्ते दुनिया'))).toBe('नमस्ते दुनिया');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const c = makeCipher();
    const a = c.encrypt('same input');
    const b = c.encrypt('same input');
    expect(a.equals(b)).toBe(false);
  });

  it('follows the version(1)|iv(12)|tag(16)|ciphertext layout', () => {
    const c = makeCipher();
    const blob = c.encrypt('hello');
    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(1 + 12 + 16 + Buffer.from('hello', 'utf8').length);
  });

  it('throws, does not silently return garbage, when the auth tag is tampered', () => {
    const c = makeCipher();
    const blob = c.encrypt('do not leak me');
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff; // flip a ciphertext byte, which invalidates the tag
    expect(() => c.decrypt(tampered)).toThrow();
  });

  it('throws when the auth tag byte itself is flipped', () => {
    const c = makeCipher();
    const blob = c.encrypt('do not leak me');
    const tampered = Buffer.from(blob);
    tampered[20] = tampered[20]! ^ 0xff; // inside the 16-byte tag region (offset 13..28)
    expect(() => c.decrypt(tampered)).toThrow();
  });

  it('cannot be decrypted with a different key', () => {
    const a = makeCipher();
    const b = makeCipher();
    expect(() => b.decrypt(a.encrypt('secret'))).toThrow();
  });

  it('rejects a ciphertext that is too short', () => {
    const c = makeCipher();
    expect(() => c.decrypt(Buffer.from([1, 2, 3]))).toThrow();
  });
});
