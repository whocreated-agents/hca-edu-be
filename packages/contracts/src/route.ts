import { z } from 'zod';
import type { Role } from './enums';

/**
 * A route is the single declaration of an endpoint: its shape AND who may call it. The API mounts
 * handlers from these declarations (so the authorisation matrix in BLUEPRINT-001 §5 cannot drift
 * from the controllers) and the web client calls through the same declarations.
 *
 * Relation checks (BLUEPRINT-001 §5, last paragraph) are part of the declaration. A principal who
 * fails one gets 404, not 403, so ids cannot be probed for existence.
 */
export type Relation =
  /**
   * `:param` is a Student id. PARENT: must be linked through Guardian -> StudentGuardian.
   * TEACHER: student must be ACTIVE-enrolled in a section the teacher teaches in the RUNNING session.
   * Other allowed roles are unrestricted.
   */
  | { resource: 'student'; param: string }
  /**
   * `:param` is a Section id. TEACHER: `class` = must be the section's class teacher (needed to
   * mark attendance); `any` = class teacher or subject teacher (roster read). Other allowed roles
   * are unrestricted.
   */
  | { resource: 'section'; param: string; teacher: 'class' | 'any' };

export type Access =
  | { kind: 'public' }
  /** Any signed-in user, no role requirement (e.g. change own password). */
  | { kind: 'authenticated' }
  | { kind: 'roles'; roles: readonly Role[]; relation?: Relation };

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDef<
  P extends z.ZodType = z.ZodType,
  Q extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  readonly method: HttpMethod;
  /** Express-style path relative to {@link API_PREFIX}, e.g. `/children/:id/fees`. */
  readonly path: string;
  readonly access: Access;
  readonly summary: string;
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly response: R;
  /** Success status. 200 unless stated. */
  readonly status: 200 | 201 | 202 | 204;
  /** `multipart` bodies carry a file; `body` then describes the non-file fields. */
  readonly bodyKind: 'json' | 'multipart' | 'none';
  /** Response is not JSON (CSV export, file download). `response` is then z.unknown(). */
  readonly responseKind: 'json' | 'csv' | 'file' | 'none';
  /** Rate-limited harder than the default (login, activation, reset, anonymous writes). */
  readonly sensitive: boolean;
}

export const API_PREFIX = '/api/v1';

const NoParams = z.object({});
const NoQuery = z.object({});
const NoBody = z.undefined();

interface RouteInit<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType, R extends z.ZodType> {
  method: HttpMethod;
  path: string;
  access: Access;
  summary: string;
  params?: P;
  query?: Q;
  body?: B;
  response?: R;
  status?: RouteDef['status'];
  bodyKind?: RouteDef['bodyKind'];
  responseKind?: RouteDef['responseKind'];
  sensitive?: boolean;
}

export function route<
  P extends z.ZodType = typeof NoParams,
  Q extends z.ZodType = typeof NoQuery,
  B extends z.ZodType = typeof NoBody,
  R extends z.ZodType = z.ZodUndefined,
>(init: RouteInit<P, Q, B, R>): RouteDef<P, Q, B, R> {
  return {
    method: init.method,
    path: init.path,
    access: init.access,
    summary: init.summary,
    params: (init.params ?? NoParams) as P,
    query: (init.query ?? NoQuery) as Q,
    body: (init.body ?? NoBody) as B,
    response: (init.response ?? z.undefined()) as R,
    status: init.status ?? (init.response ? (init.method === 'POST' ? 201 : 200) : 204),
    bodyKind: init.bodyKind ?? (init.body ? 'json' : 'none'),
    responseKind: init.responseKind ?? (init.response ? 'json' : 'none'),
    sensitive: init.sensitive ?? false,
  };
}

export const publicAccess: Access = { kind: 'public' };
export const authenticated: Access = { kind: 'authenticated' };
export const roles = (r: readonly Role[], relation?: Relation): Access =>
  relation ? { kind: 'roles', roles: r, relation } : { kind: 'roles', roles: r };

// `*In` is what a client must send; `*Out` is what a handler receives after parsing (transforms
// applied) and what the server must return.
export type ParamsIn<T extends RouteDef> = z.input<T['params']>;
export type QueryIn<T extends RouteDef> = z.input<T['query']>;
export type BodyIn<T extends RouteDef> = z.input<T['body']>;
export type ParamsOut<T extends RouteDef> = z.output<T['params']>;
export type QueryOut<T extends RouteDef> = z.output<T['query']>;
export type BodyOut<T extends RouteDef> = z.output<T['body']>;
export type ResponseOf<T extends RouteDef> = z.output<T['response']>;

/** Substitute `:params` into a route path; throws if one is missing. */
export function buildPath(def: Pick<RouteDef, 'path'>, params: Record<string, string> = {}): string {
  return (
    API_PREFIX +
    def.path.replace(/:([A-Za-z0-9_]+)/g, (_, k: string) => {
      const v = params[k];
      if (v === undefined) throw new Error(`Missing path param :${k} for ${def.path}`);
      return encodeURIComponent(v);
    })
  );
}
