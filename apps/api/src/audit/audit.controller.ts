import { Controller } from '@nestjs/common';
import { routes, type QueryOut } from '@hca/contracts';
import { Endpoint, Input, Parsed } from '../common/endpoint';
import { AuditService } from './audit.service';

const r = routes.adminAudit;

/** Admin-only read of the append-only audit log. */
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Endpoint(r.audit)
  list(@Input() { query }: Parsed<unknown, QueryOut<typeof r.audit>>) {
    return this.audit.list(query);
  }
}
