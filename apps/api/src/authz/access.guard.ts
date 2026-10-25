import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { RouteDef } from '@hca/contracts';
import { CryptoService } from '../auth/crypto.service';
import { HcaRequest, ROUTE_KEY } from '../common/endpoint';
import { Problem } from '../common/problem';
import { PrismaService } from '../prisma.service';
import { RelationsService } from './relations.service';

const uuid = z.uuid();

/**
 * The single place access is decided, registered globally so it applies to every handler.
 *
 *  - A handler with no @Endpoint declaration is DENIED (default deny; there is no "forgot to guard").
 *  - `public` routes pass; everything else needs a valid access token whose epoch still matches the
 *    user row and whose user is ACTIVE, so suspension and password change take effect immediately.
 *  - `roles` are checked (403), then the declared relation (404, indistinguishable from absent).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
    private readonly relations: RelationsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const def = Reflect.getMetadata(ROUTE_KEY, ctx.getHandler()) as RouteDef | undefined;
    if (!def) throw Problem.forbidden('Route has no access declaration');
    if (def.access.kind === 'public') return true;

    const req = ctx.switchToHttp().getRequest<HcaRequest>();
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? this.crypto.verifyAccess(token) : null;
    if (!claims) throw Problem.unauthenticated();

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, role: true, status: true, authEpoch: true } });
    if (!user || user.status !== 'ACTIVE' || user.authEpoch !== claims.ep) throw Problem.unauthenticated();
    req.principal = { id: user.id, role: user.role };

    if (def.access.kind === 'authenticated') return true;
    if (!def.access.roles.includes(user.role)) throw Problem.forbidden();

    const rel = def.access.relation;
    if (rel) {
      const id = (req.params as Record<string, string | undefined>)[rel.param];
      if (!id || !uuid.safeParse(id).success || !(await this.relations.allows(req.principal, rel, id))) throw Problem.notFound();
    }
    return true;
  }
}
