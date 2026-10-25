import {
  ProblemDetails,
  buildPath,
  type BodyIn,
  type ParamsIn,
  type QueryIn,
  type ResponseOf,
  type RouteDef,
} from '@hca/contracts';

// Server components call the API directly; the browser uses same-origin (proxied by Next rewrites).
const BASE =
  typeof window === 'undefined' ? (process.env.API_INTERNAL_URL ?? 'http://localhost:3001') : '';

let accessToken: string | null = null;
export const setAccessToken = (t: string | null): void => {
  accessToken = t;
};
export const getAccessToken = (): string | null => accessToken;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ProblemDetails | null,
  ) {
    super(problem?.title ?? `HTTP ${status}`);
    this.name = 'ApiError';
  }
  get code(): ProblemDetails['code'] | undefined {
    return this.problem?.code;
  }
}

type Args<T extends RouteDef> = {
  params?: ParamsIn<T>;
  query?: QueryIn<T>;
  body?: BodyIn<T>;
  signal?: AbortSignal;
};

export async function call<T extends RouteDef>(def: T, args: Args<T> = {}): Promise<ResponseOf<T>> {
  const path = buildPath(def, args.params ?? {});
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args.query ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, typeof x === 'string' ? x : JSON.stringify(x)));
    else qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const hasBody = args.body !== undefined && def.bodyKind === 'json';
  if (hasBody) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: def.method,
    headers,
    body: hasBody ? JSON.stringify(args.body) : undefined,
    credentials: 'include',
    cache: 'no-store',
    signal: args.signal ?? null,
  });

  if (!res.ok) {
    let problem: ProblemDetails | null = null;
    try {
      const parsed = ProblemDetails.safeParse(await res.json());
      if (parsed.success) problem = parsed.data;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, problem);
  }
  if (res.status === 204 || def.responseKind !== 'json') return undefined as ResponseOf<T>;
  return def.response.parse(await res.json()) as ResponseOf<T>;
}
