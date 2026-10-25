import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ErrorCode, ProblemDetails } from '@hca/contracts';
import type { Request, Response } from 'express';

const TITLES: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  422: 'Unprocessable Content', 423: 'Locked', 429: 'Too Many Requests', 500: 'Internal Server Error',
};

export interface ProblemInit {
  status: number;
  code: ErrorCode;
  detail?: string;
  errors?: ProblemDetails['errors'];
  retryAfterSeconds?: number;
  extra?: Record<string, unknown>;
}

/** The one exception type handlers throw. Rendered as RFC 9457 problem+json by {@link ProblemFilter}. */
export class Problem extends Error {
  constructor(public readonly init: ProblemInit) {
    super(init.detail ?? init.code);
  }
  static notFound(detail = 'Not found'): Problem { return new Problem({ status: 404, code: 'NOT_FOUND', detail }); }
  static forbidden(detail = 'You do not have access to this'): Problem { return new Problem({ status: 403, code: 'FORBIDDEN', detail }); }
  static unauthenticated(detail = 'Sign in required'): Problem { return new Problem({ status: 401, code: 'UNAUTHENTICATED', detail }); }
  static conflict(detail: string, code: ErrorCode = 'CONFLICT', extra?: Record<string, unknown>): Problem {
    return new Problem({ status: 409, code, detail, ...(extra ? { extra } : {}) });
  }
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(err: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = String(req.id ?? res.getHeader('X-Request-Id') ?? '');

    let init: ProblemInit;
    if (err instanceof Problem) {
      init = err.init;
    } else if (err instanceof HttpException) {
      const status = err.getStatus();
      const code: ErrorCode = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
      init = { status, code, detail: status === 404 ? 'Not found' : status >= 500 ? undefined : err.message };
    } else {
      this.log.error(`[${requestId}] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      init = { status: 500, code: 'INTERNAL' };
    }

    const body: ProblemDetails = {
      type: 'about:blank',
      title: TITLES[init.status] ?? 'Error',
      status: init.status,
      code: init.code,
      requestId,
      ...(init.detail ? { detail: init.detail } : {}),
      ...(init.errors ? { errors: init.errors } : {}),
      ...(init.retryAfterSeconds !== undefined ? { retryAfterSeconds: init.retryAfterSeconds } : {}),
      ...(init.extra ? { extra: init.extra } : {}),
    };
    if (init.retryAfterSeconds !== undefined) res.setHeader('Retry-After', String(init.retryAfterSeconds));
    res.status(init.status).type('application/problem+json').send(body);
  }
}
