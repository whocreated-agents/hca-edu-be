import { Controller, Res } from '@nestjs/common';
import { publicAccess, route } from '@hca/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Endpoint, Input, Parsed } from '../common/endpoint';
import { Problem } from '../common/problem';
import { StorageService } from './storage.service';

/**
 * Not part of the locked @hca/contracts registry: this is a storage-internal serving endpoint, not
 * a business-shape contract. The HMAC signature IS the access control (see StorageService.signUrl),
 * so access is `public` and a bad/expired/tampered signature is a plain 404 -- indistinguishable
 * from a file that never existed, same pattern used elsewhere in this codebase for id probing.
 */
export const filesRoute = route({
  method: 'GET',
  path: '/files/:key',
  access: publicAccess,
  summary: 'Serve a privately-stored file via a short-lived HMAC-signed URL (see StorageService.signUrl). 404 on bad/expired signature.',
  params: z.object({ key: z.string().min(1).max(1000) }),
  query: z.object({ exp: z.coerce.number().int(), mime: z.string().min(1).max(200), sig: z.string().min(1).max(200) }),
  response: z.unknown(),
  responseKind: 'file',
  status: 200,
});

@Controller()
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Endpoint(filesRoute)
  async serve(
    @Input() { params, query }: Parsed<{ key: string }, { exp: number; mime: string; sig: string }>,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.storage.verify(params.key, query.mime, query.exp, query.sig)) throw Problem.notFound();
    const buffer = await this.storage.get(params.key);
    res.setHeader('Content-Type', query.mime);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  }
}
