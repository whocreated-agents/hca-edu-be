import { Controller, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DOCUMENT_MAX_BYTES, routes, type BodyOut, type ParamsOut, type QueryOut } from '@hca/contracts';
import { Endpoint, Input, Me, Parsed, Principal, Req, type HcaRequest } from '../common/endpoint';
import { Problem } from '../common/problem';
import { StudentsService } from './students.service';

const r = routes.adminStudents;

@Controller()
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Endpoint(r.students)
  list(@Input() { query }: Parsed<unknown, QueryOut<typeof r.students>>) {
    return this.students.list(query);
  }

  @Endpoint(r.createStudent)
  create(@Me() me: Principal, @Req() req: HcaRequest, @Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createStudent>>) {
    return this.students.create(me, body, req.ip ?? null);
  }

  @Endpoint(r.student)
  detail(@Input() { params }: Parsed<ParamsOut<typeof r.student>>) {
    return this.students.detail(params.id);
  }

  @Endpoint(r.updateStudent)
  update(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.updateStudent>, unknown, BodyOut<typeof r.updateStudent>>) {
    return this.students.update(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.uploadPhoto)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES } }))
  uploadPhoto(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.uploadPhoto>>, @UploadedFile() file?: { buffer: Buffer }) {
    if (!file) throw new Problem({ status: 400, code: 'VALIDATION_FAILED', detail: 'A file is required' });
    return this.students.uploadPhoto(me, params.id, file, req.ip ?? null);
  }

  @Endpoint(r.enroll)
  enroll(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.enroll>, unknown, BodyOut<typeof r.enroll>>) {
    return this.students.enroll(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.updateEnrollment)
  updateEnrollment(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.updateEnrollment>, unknown, BodyOut<typeof r.updateEnrollment>>) {
    return this.students.updateEnrollment(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.promote)
  promote(@Me() me: Principal, @Req() req: HcaRequest, @Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.promote>>) {
    return this.students.promote(me, body, req.ip ?? null);
  }

  @Endpoint(r.linkGuardian)
  linkGuardian(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.linkGuardian>, unknown, BodyOut<typeof r.linkGuardian>>) {
    return this.students.linkGuardian(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.unlinkGuardian)
  unlinkGuardian(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.unlinkGuardian>>) {
    return this.students.unlinkGuardian(me, params.id, params.guardianId, req.ip ?? null);
  }

  @Endpoint(r.updateGuardian)
  updateGuardian(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.updateGuardian>, unknown, BodyOut<typeof r.updateGuardian>>) {
    return this.students.updateGuardian(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.getSensitive)
  getSensitive(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.getSensitive>>) {
    return this.students.getSensitive(me, params.id, req.ip ?? null);
  }

  @Endpoint(r.putSensitive)
  putSensitive(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.putSensitive>, unknown, BodyOut<typeof r.putSensitive>>) {
    return this.students.putSensitive(me, params.id, body, req.ip ?? null);
  }
}
