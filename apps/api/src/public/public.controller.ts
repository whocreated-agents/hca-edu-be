import { Controller } from '@nestjs/common';
import { routes, type ParamsOut, type QueryOut } from '@hca/contracts';
import { Endpoint, Input, Parsed } from '../common/endpoint';
import { PublicService } from './public.service';

const r = routes.public;

/** Public (anonymous) reads: profile, CMS content, notices, fees, session, class levels. */
@Controller()
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Endpoint(r.classLevels)
  classLevels() {
    return this.svc.classLevels();
  }

  @Endpoint(r.session)
  session() {
    return this.svc.session();
  }

  @Endpoint(r.profile)
  profile() {
    return this.svc.profile();
  }

  @Endpoint(r.content)
  content() {
    return this.svc.content();
  }

  @Endpoint(r.notices)
  notices(@Input() { query }: Parsed<unknown, QueryOut<typeof r.notices>>) {
    return this.svc.notices(query);
  }

  @Endpoint(r.notice)
  notice(@Input() { params }: Parsed<ParamsOut<typeof r.notice>>) {
    return this.svc.notice(params.slug);
  }

  @Endpoint(r.fees)
  fees() {
    return this.svc.fees();
  }
}
