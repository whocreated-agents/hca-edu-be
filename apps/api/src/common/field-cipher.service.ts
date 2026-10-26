import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CONFIG, type Config } from '../config';

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = 'aes-256-gcm';

/**
 * Field-level encryption for StudentSensitive columns (aadhaarEnc, medicalNotesEnc). Applied in
 * the API, not pgcrypto (CONTRACT-LOCK-001 D-12), so the key never appears in SQL text or query
 * logs. Wire layout per the schema comment: version(1) | iv(12) | tag(16) | ciphertext.
 */
@Injectable()
export class FieldCipherService {
  private readonly key: Buffer;

  constructor(@Inject(CONFIG) cfg: Config) {
    this.key = Buffer.from(cfg.FIELD_ENCRYPTION_KEY, 'base64');
    if (this.key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
  }

  /** Throws if the layout is malformed or the tag does not verify (tampering or wrong key). */
  decrypt(blob: Buffer): string {
    if (blob.length < 1 + IV_LEN + TAG_LEN) throw new Error('Ciphertext too short');
    const version = blob[0];
    if (version !== VERSION) throw new Error(`Unsupported ciphertext version ${version}`);
    const iv = blob.subarray(1, 1 + IV_LEN);
    const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
    const ciphertext = blob.subarray(1 + IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
