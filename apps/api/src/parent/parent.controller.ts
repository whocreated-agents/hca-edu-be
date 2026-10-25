import { Controller } from '@nestjs/common';
import { routes, type ParamsOut, type QueryOut } from '@hca/contracts';
import { Endpoint, Input, Me, Parsed, Principal } from '../common/endpoint';
import { ParentService } from './parent.service';

const r = routes.parent;

/** Every `:id` route here carries a `student` relation in its declaration; AccessGuard enforces it. */
@Controller()
export class ParentController {
  constructor(private readonly parent: ParentService) {}

  @Endpoint(r.children)
  children(@Me() me: Principal) {
    return this.parent.children(me.id);
  }

  @Endpoint(r.child)
  child(@Input() { params }: Parsed<ParamsOut<typeof r.child>>) {
    return this.parent.child(params.id);
  }

  @Endpoint(r.childFees)
  fees(@Input() { params, query }: Parsed<ParamsOut<typeof r.childFees>, QueryOut<typeof r.childFees>>) {
    return this.parent.fees(params.id, query.sessionId);
  }

  @Endpoint(r.childAttendance)
  attendance(@Input() { params, query }: Parsed<ParamsOut<typeof r.childAttendance>, QueryOut<typeof r.childAttendance>>) {
    return this.parent.attendanceMonth(params.id, query.month);
  }

  @Endpoint(r.notices)
  notices(@Input() { query }: Parsed<unknown, QueryOut<typeof r.notices>>, @Me() me: Principal) {
    return this.parent.notices(me.id, query.limit, query.cursor);
  }
}
