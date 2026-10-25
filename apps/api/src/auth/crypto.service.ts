import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ACCESS_TOKEN_TTL_SECONDS, ACTIVATION_CODE_ALPHABET, ACTIVATION_CODE_LENGTH, type Role } from '@hca/contracts';
import { CONFIG, type Config } from '../config';

export interface AccessClaims {
  sub: string;
  role: Role;
  /** User.authEpoch at issue time; a mismatch means the token was revoked. */
  ep: number;
}

@Injectable()
export class CryptoService {
  private readonly argonOpts: argon2.Options;
  /** Verified against when the account does not exist, so login time does not reveal it. */
  private dummyHash: Promise<string>;

  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    this.argonOpts = cfg.ARGON2_FAST
      ? { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 }
      : { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
    this.dummyHash = argon2.hash('not-a-real-password', this.argonOpts);
  }

  hashSecret(plain: string): Promise<string> {
    return argon2.hash(plain, this.argonOpts);
  }

  async verifySecret(hash: string | null | undefined, plain: string): Promise<boolean> {
    if (!hash) {
      await argon2.verify(await this.dummyHash, plain).catch(() => false);
      return false;
    }
    return argon2.verify(hash, plain).catch(() => false);
  }

  /** High-entropy random tokens (refresh, reset, verify): HMAC-SHA256 with a server pepper, no salt needed. */
  newToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.tokenHash(token) };
  }

  tokenHash(token: string): string {
    return createHmac('sha256', this.cfg.TOKEN_PEPPER).update(token).digest('hex');
  }

  /** 10 chars from the unambiguous 32-symbol alphabet; ~50 bits, CSPRNG-uniform via randomInt. */
  newActivationCode(): { raw: string; display: string } {
    let raw = '';
    for (let i = 0; i < ACTIVATION_CODE_LENGTH; i++) raw += ACTIVATION_CODE_ALPHABET[randomInt(ACTIVATION_CODE_ALPHABET.length)];
    return { raw, display: `${raw.slice(0, 5)}-${raw.slice(5)}` };
  }

  signAccess(c: AccessClaims): string {
    return jwt.sign(c, this.cfg.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS, issuer: 'hca-api' });
  }

  verifyAccess(token: string): AccessClaims | null {
    try {
      const p = jwt.verify(token, this.cfg.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'hca-api' });
      if (typeof p === 'string') return null;
      const { sub, role, ep } = p as Partial<AccessClaims>;
      if (typeof sub !== 'string' || typeof role !== 'string' || typeof ep !== 'number') return null;
      return { sub, role, ep };
    } catch {
      return null;
    }
  }
}

export const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};
