import { applyDecorators, createParamDecorator, Delete, ExecutionContext, Get, HttpCode, Patch, Post, Put, SetMetadata } from '@nestjs/common';
import type { RouteDef, Role } from '@hca/contracts';
import type { Request } from 'express';

export const ROUTE_KEY = 'hca:route';

/**
 * Binds a handler to a route DECLARATION from @hca/contracts. The path, method, status code,
 * access rule and input/output schemas all come from the declaration, so a controller cannot
 * drift from the contract. A handler without this decorator is denied by AccessGuard.
 */
export function Endpoint(def: RouteDef): MethodDecorator {
  const verb = { GET: Get, POST: Post, PUT: Put, PATCH: Patch, DELETE: Delete }[def.method];
  return applyDecorators(verb(def.path), SetMetadata(ROUTE_KEY, def), HttpCode(def.status));
}

export interface Principal {
  id: string;
  role: Role;
}

export interface Parsed<P = unknown, Q = unknown, B = unknown> {
  params: P;
  query: Q;
  body: B;
}

export type HcaRequest = Request & { id?: string; principal?: Principal; input?: Parsed };

/** The zod-parsed {params, query, body}. Typed per route with `Parsed<ParamsOut<R>, QueryOut<R>, BodyOut<R>>`. */
export const Input = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<HcaRequest>().input);
export const Me = createParamDecorator((_d: unknown, ctx: ExecutionContext): Principal => {
  const p = ctx.switchToHttp().getRequest<HcaRequest>().principal;
  if (!p) throw new Error('Me() used on a route without authentication');
  return p;
});
export const Req = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<HcaRequest>());
