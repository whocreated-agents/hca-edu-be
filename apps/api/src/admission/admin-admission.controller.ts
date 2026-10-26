import { Controller, Res } from '@nestjs/common';
import { routes, type BodyOut, type ParamsOut, type QueryOut } from '@hca/contracts';
import type { Response } from 'express';
import { Endpoint, Input, Me, Parsed, Principal, Req, type HcaRequest } from '../common/endpoint';
import { AdmissionService } from './admission.service';

const r = routes.adminAdmissions;

/** Admin admission pipeline: enquiries board, invitations, applications, CSV export, stage-3 handoff. */
@Controller()
export class AdminAdmissionController {
  constructor(private readonly admission: AdmissionService) {}

  @Endpoint(r.enquiries)
  enquiries(@Input() { query }: Parsed<unknown, QueryOut<typeof r.enquiries>>) {
    return this.admission.enquiries(query);
  }

  @Endpoint(r.updateEnquiry)
  updateEnquiry(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.updateEnquiry>, unknown, BodyOut<typeof r.updateEnquiry>>) {
    return this.admission.updateEnquiry(me, params.id, body.state, req.ip ?? null);
  }

  @Endpoint(r.invite)
  invite(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.invite>>) {
    return this.admission.invite(me, params.id, req.ip ?? null);
  }

  @Endpoint(r.applications)
  applications(@Input() { query }: Parsed<unknown, QueryOut<typeof r.applications>>) {
    return this.admission.applications(query);
  }

  @Endpoint(r.exportApplications)
  async exportApplications(@Input() { query }: Parsed<unknown, QueryOut<typeof r.exportApplications>>, @Res() res: Response) {
    const csv = await this.admission.exportApplications(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="applications.csv"');
    res.send(csv);
  }

  @Endpoint(r.application)
  application(@Input() { params }: Parsed<ParamsOut<typeof r.application>>) {
    return this.admission.application(params.id);
  }

  @Endpoint(r.setApplicationStatus)
  setApplicationStatus(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.setApplicationStatus>, unknown, BodyOut<typeof r.setApplicationStatus>>) {
    return this.admission.setApplicationStatus(me, params.id, body.status, body.note, req.ip ?? null);
  }

  @Endpoint(r.createStudentFromApplication)
  createStudentFromApplication(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.createStudentFromApplication>, unknown, BodyOut<typeof r.createStudentFromApplication>>) {
    return this.admission.createStudentFromApplication(me, params.id, body, req.ip ?? null);
  }
}
