import { Controller } from '@nestjs/common';
import { routes, type BodyOut, type ParamsOut, type QueryOut } from '@hca/contracts';
import { Endpoint, Input, Me, Parsed, Principal, Req, type HcaRequest } from '../common/endpoint';
import { ContentService } from './content.service';

const r = routes.adminContent;

/**
 * Admin CMS: notices, content blocks, school profile, facilities, statistics. Media/photograph
 * consent routes in the same contract group (BLUEPRINT-001 §2.7, PHOTO-CONSENT-REQUIREMENTS.md)
 * are a separate, larger DPDP-compliance workflow and are deliberately NOT wired by this controller
 * -- see the WHO-6 PR description for the follow-up ticket this leaves open.
 */
@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Endpoint(r.notices)
  notices(@Input() { query }: Parsed<unknown, QueryOut<typeof r.notices>>) {
    return this.content.notices(query);
  }

  @Endpoint(r.notice)
  notice(@Input() { params }: Parsed<ParamsOut<typeof r.notice>>) {
    return this.content.notice(params.id);
  }

  @Endpoint(r.createNotice)
  createNotice(@Me() me: Principal, @Req() req: HcaRequest, @Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createNotice>>) {
    return this.content.createNotice(me, body, req.ip ?? null);
  }

  @Endpoint(r.updateNotice)
  updateNotice(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.updateNotice>, unknown, BodyOut<typeof r.updateNotice>>) {
    return this.content.updateNotice(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.deleteNotice)
  deleteNotice(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.deleteNotice>>) {
    return this.content.deleteNotice(me, params.id, req.ip ?? null);
  }

  @Endpoint(r.contentBlocks)
  contentBlocks() {
    return this.content.contentBlocks();
  }

  @Endpoint(r.putContentBlock)
  putContentBlock(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.putContentBlock>, unknown, BodyOut<typeof r.putContentBlock>>) {
    return this.content.putContentBlock(me, params.key, body, req.ip ?? null);
  }

  @Endpoint(r.profile)
  profile() {
    return this.content.profile();
  }

  @Endpoint(r.putProfile)
  putProfile(@Me() me: Principal, @Req() req: HcaRequest, @Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.putProfile>>) {
    return this.content.putProfile(me, body, req.ip ?? null);
  }

  @Endpoint(r.facilities)
  facilities() {
    return this.content.facilities();
  }

  @Endpoint(r.createFacility)
  createFacility(@Me() me: Principal, @Req() req: HcaRequest, @Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createFacility>>) {
    return this.content.createFacility(me, body, req.ip ?? null);
  }

  @Endpoint(r.updateFacility)
  updateFacility(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.updateFacility>, unknown, BodyOut<typeof r.updateFacility>>) {
    return this.content.updateFacility(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.deleteFacility)
  deleteFacility(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.deleteFacility>>) {
    return this.content.deleteFacility(me, params.id, req.ip ?? null);
  }

  @Endpoint(r.stats)
  stats() {
    return this.content.stats();
  }

  @Endpoint(r.createStat)
  createStat(@Me() me: Principal, @Req() req: HcaRequest, @Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createStat>>) {
    return this.content.createStat(me, body, req.ip ?? null);
  }

  @Endpoint(r.updateStat)
  updateStat(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.updateStat>, unknown, BodyOut<typeof r.updateStat>>) {
    return this.content.updateStat(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.deleteStat)
  deleteStat(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params }: Parsed<ParamsOut<typeof r.deleteStat>>) {
    return this.content.deleteStat(me, params.id, req.ip ?? null);
  }
}
