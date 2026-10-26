import { Controller } from '@nestjs/common';
import { routes, type BodyOut, type ParamsOut, type QueryOut } from '@hca/contracts';
import { Endpoint, Input, Me, Parsed, Principal, Req, type HcaRequest } from '../common/endpoint';
import { AcademicService } from './academic.service';

const r = routes.adminAcademic;

@Controller()
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Endpoint(r.sessions)
  sessions() {
    return this.academic.sessions();
  }

  @Endpoint(r.createSession)
  createSession(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createSession>>) {
    return this.academic.createSession(body);
  }

  @Endpoint(r.updateSession)
  updateSession(@Input() { params, body }: Parsed<ParamsOut<typeof r.updateSession>, unknown, BodyOut<typeof r.updateSession>>) {
    return this.academic.updateSession(params.id, body);
  }

  @Endpoint(r.transitionSession)
  transitionSession(@Input() { params, body }: Parsed<ParamsOut<typeof r.transitionSession>, unknown, BodyOut<typeof r.transitionSession>>) {
    return this.academic.transitionSession(params.id, body.to);
  }

  @Endpoint(r.holidays)
  holidays(@Input() { params }: Parsed<ParamsOut<typeof r.holidays>>) {
    return this.academic.holidays(params.id);
  }

  @Endpoint(r.createHoliday)
  createHoliday(@Input() { params, body }: Parsed<ParamsOut<typeof r.createHoliday>, unknown, BodyOut<typeof r.createHoliday>>) {
    return this.academic.createHoliday(params.id, body);
  }

  @Endpoint(r.deleteHoliday)
  deleteHoliday(@Input() { params }: Parsed<ParamsOut<typeof r.deleteHoliday>>) {
    return this.academic.deleteHoliday(params.id);
  }

  @Endpoint(r.classLevels)
  classLevels() {
    return this.academic.classLevels();
  }

  @Endpoint(r.updateClassLevel)
  updateClassLevel(@Input() { params, body }: Parsed<ParamsOut<typeof r.updateClassLevel>, unknown, BodyOut<typeof r.updateClassLevel>>) {
    return this.academic.updateClassLevel(params.id, body);
  }

  @Endpoint(r.sections)
  sections(@Input() { query }: Parsed<unknown, QueryOut<typeof r.sections>>) {
    return this.academic.sections(query);
  }

  @Endpoint(r.createSection)
  createSection(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createSection>>) {
    return this.academic.createSection(body);
  }

  @Endpoint(r.updateSection)
  updateSection(@Input() { params, body }: Parsed<ParamsOut<typeof r.updateSection>, unknown, BodyOut<typeof r.updateSection>>) {
    return this.academic.updateSection(params.id, body);
  }

  @Endpoint(r.subjectTeachers)
  subjectTeachers(@Input() { params }: Parsed<ParamsOut<typeof r.subjectTeachers>>) {
    return this.academic.subjectTeachers(params.id);
  }

  @Endpoint(r.assignSubjectTeacher)
  assignSubjectTeacher(@Input() { params, body }: Parsed<ParamsOut<typeof r.assignSubjectTeacher>, unknown, BodyOut<typeof r.assignSubjectTeacher>>) {
    return this.academic.assignSubjectTeacher(params.id, body);
  }

  @Endpoint(r.removeSubjectTeacher)
  removeSubjectTeacher(@Input() { params }: Parsed<ParamsOut<typeof r.removeSubjectTeacher>>) {
    return this.academic.removeSubjectTeacher(params.id);
  }

  @Endpoint(r.staff)
  staff(@Input() { query }: Parsed<unknown, QueryOut<typeof r.staff>>) {
    return this.academic.staffList(query);
  }

  @Endpoint(r.staffOne)
  staffOne(@Input() { params }: Parsed<ParamsOut<typeof r.staffOne>>) {
    return this.academic.staffOne(params.id);
  }

  @Endpoint(r.createStaff)
  createStaff(@Me() me: Principal, @Req() req: HcaRequest, @Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createStaff>>) {
    return this.academic.createStaff(me, body, req.ip ?? null);
  }

  @Endpoint(r.updateStaff)
  updateStaff(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.updateStaff>, unknown, BodyOut<typeof r.updateStaff>>) {
    return this.academic.updateStaff(me, params.id, body, req.ip ?? null);
  }
}
