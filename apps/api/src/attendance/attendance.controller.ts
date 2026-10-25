import { Controller } from '@nestjs/common';
import { routes, type BodyOut, type ParamsOut, type QueryOut } from '@hca/contracts';
import { Endpoint, Input, Me, Parsed, Principal, Req, type HcaRequest } from '../common/endpoint';
import { AttendanceService } from './attendance.service';

const r = routes.attendance;

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Endpoint(r.mySections)
  mySections(@Me() me: Principal) {
    return this.attendance.mySections(me.id);
  }

  @Endpoint(r.roster)
  roster(@Input() { params }: Parsed<ParamsOut<typeof r.roster>>) {
    return this.attendance.roster(params.id);
  }

  @Endpoint(r.getDay)
  getDay(@Me() me: Principal, @Input() { params }: Parsed<ParamsOut<typeof r.getDay>>) {
    return this.attendance.getDay(me, params.id, params.date);
  }

  @Endpoint(r.putDay)
  putDay(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.putDay>, unknown, BodyOut<typeof r.putDay>>) {
    return this.attendance.putDay(me, params.id, params.date, body, req.ip ?? null);
  }

  @Endpoint(r.finalise)
  finalise(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.finalise>>) {
    return this.attendance.setFinalised(me, params.id, params.date, true, req.ip ?? null);
  }

  @Endpoint(r.unfinalise)
  unfinalise(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.unfinalise>>) {
    return this.attendance.setFinalised(me, params.id, params.date, false, req.ip ?? null);
  }

  @Endpoint(r.report)
  report(@Input() { query }: Parsed<unknown, QueryOut<typeof r.report>>) {
    return this.attendance.report(query);
  }
}
