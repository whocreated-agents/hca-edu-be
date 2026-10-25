import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { RouteDef } from '@hca/contracts';
import { CONFIG, type Config } from '../config';
import { HcaRequest, ROUTE_KEY } from './endpoint';
import { Problem } from './problem';

const WINDOW_MS = 60_000;
const LIMITS = { sensitive: 10, normal: 300 } as const;

/**
 * Per-IP fixed window, in process memory: one API process on one VPS (ADR-001). Complements, and
 * is independent of, the per-account lockout in AuthService. Replace with a shared store if the
 * API is ever scaled horizontally.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.cfg.RATE_LIMIT_ENABLED) return true;
    const def = Reflect.getMetadata(ROUTE_KEY, ctx.getHandler()) as RouteDef | undefined;
    const req = ctx.switchToHttp().getRequest<HcaRequest>();
    const bucket = def?.sensitive ? 'sensitive' : 'normal';
    const key = `${bucket}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + WINDOW_MS };
      this.hits.set(key, e);
    }
    e.count += 1;
    if (e.count > LIMITS[bucket]) {
      throw new Problem({ status: 429, code: 'RATE_LIMITED', detail: 'Too many requests', retryAfterSeconds: Math.ceil((e.resetAt - now) / 1000) });
    }
    return true;
  }
}
