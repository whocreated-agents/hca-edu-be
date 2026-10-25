import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { RouteDef } from '@hca/contracts';
import { Observable, map } from 'rxjs';
import { CONFIG, type Config } from '../config';
import { HcaRequest, ROUTE_KEY } from './endpoint';
import { Problem } from './problem';

const flatten = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));

/**
 * Parses params, query and body with the route's own zod schemas (unknown keys on bodies are
 * rejected by the contracts' strictObject). Outside production it also parses the RESPONSE, so a
 * handler that drifts from the contract fails its test instead of shipping.
 */
@Injectable()
export class ValidationInterceptor implements NestInterceptor {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const def = Reflect.getMetadata(ROUTE_KEY, ctx.getHandler()) as RouteDef | undefined;
    if (!def) return next.handle();
    const req = ctx.switchToHttp().getRequest<HcaRequest>();

    const params = def.params.safeParse(req.params);
    const query = def.query.safeParse(req.query);
    const body = def.bodyKind === 'json' ? def.body.safeParse(req.body ?? {}) : { success: true as const, data: undefined };
    const failures = [
      ...(params.success ? [] : flatten(params.error.issues).map((e) => ({ ...e, path: `params.${e.path}` }))),
      ...(query.success ? [] : flatten(query.error.issues).map((e) => ({ ...e, path: `query.${e.path}` }))),
      ...(body.success ? [] : flatten(body.error.issues).map((e) => ({ ...e, path: e.path ? `body.${e.path}` : 'body' }))),
    ];
    if (failures.length) {
      throw new Problem({ status: 400, code: 'VALIDATION_FAILED', detail: 'The request did not validate', errors: failures });
    }
    req.input = {
      params: (params as { data: unknown }).data,
      query: (query as { data: unknown }).data,
      body: (body as { data: unknown }).data,
    };

    return next.handle().pipe(
      map((out: unknown) => {
        if (this.cfg.NODE_ENV === 'production' || def.responseKind !== 'json') return out;
        const r = def.response.safeParse(out);
        if (!r.success) throw new Error(`Response drift on ${def.method} ${def.path}: ${JSON.stringify(r.error.issues.slice(0, 5))}`);
        return r.data;
      }),
    );
  }
}
