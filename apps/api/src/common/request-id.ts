import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(req: Request & { id?: string }, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  req.id = inbound && /^[A-Za-z0-9._-]{8,64}$/.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
