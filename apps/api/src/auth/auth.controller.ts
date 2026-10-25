import { Controller, Res } from '@nestjs/common';
import {
  REFRESH_COOKIE_NAME,
  routes,
  type BodyOut,
  type ParamsOut,
  type SessionUser,
} from '@hca/contracts';
import type { Response } from 'express';
import { Endpoint, HcaRequest, Input, Me, Parsed, Principal, Req } from '../common/endpoint';
import { CONFIG, type Config } from '../config';
import { Inject } from '@nestjs/common';
import { AuthService, type Ctx, type Issued } from './auth.service';

const r = routes.auth;
const ctxOf = (req: HcaRequest): Ctx => ({ ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null });
const refreshOf = (req: HcaRequest): string | undefined => {
  const v: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE_NAME];
  return typeof v === 'string' ? v : undefined;
};

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private setCookie(res: Response, issued: Issued) {
    res.cookie(REFRESH_COOKIE_NAME, issued.refresh.token, {
      httpOnly: true,
      secure: this.cfg.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: issued.refresh.maxAgeMs,
    });
    return issued.session;
  }

  private clearCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE_NAME, { httpOnly: true, secure: this.cfg.COOKIE_SECURE, sameSite: 'strict', path: '/api/v1/auth' });
  }

  @Endpoint(r.login)
  async login(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.login>>, @Req() req: HcaRequest, @Res({ passthrough: true }) res: Response) {
    return this.setCookie(res, await this.auth.login(body, ctxOf(req)));
  }

  @Endpoint(r.activate)
  async activate(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.activate>>, @Req() req: HcaRequest, @Res({ passthrough: true }) res: Response) {
    return this.setCookie(res, await this.auth.activate(body, ctxOf(req)));
  }

  @Endpoint(r.refresh)
  async refresh(@Req() req: HcaRequest, @Res({ passthrough: true }) res: Response) {
    try {
      return this.setCookie(res, await this.auth.refresh(refreshOf(req), ctxOf(req)));
    } catch (e) {
      this.clearCookie(res);
      throw e;
    }
  }

  @Endpoint(r.logout)
  async logout(@Req() req: HcaRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(refreshOf(req));
    this.clearCookie(res);
  }

  @Endpoint(r.forgot)
  async forgot(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.forgot>>) {
    await this.auth.forgot(body.identifier);
    return { ok: true as const };
  }

  @Endpoint(r.reset)
  async reset(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.reset>>, @Req() req: HcaRequest) {
    await this.auth.reset(body, ctxOf(req));
    return { ok: true as const };
  }

  @Endpoint(r.change)
  async change(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.change>>, @Me() me: Principal, @Req() req: HcaRequest, @Res({ passthrough: true }) res: Response) {
    return this.setCookie(res, await this.auth.change(me.id, body, refreshOf(req), ctxOf(req)));
  }

  @Endpoint(r.me)
  me(@Me() me: Principal): Promise<SessionUser> {
    return this.auth.me(me.id);
  }

  @Endpoint(r.setEmail)
  async setEmail(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.setEmail>>, @Me() me: Principal) {
    await this.auth.setEmail(me.id, body.email);
    return { ok: true as const };
  }

  @Endpoint(r.verifyEmail)
  async verifyEmail(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.verifyEmail>>) {
    await this.auth.verifyEmail(body.token);
    return { ok: true as const };
  }

  @Endpoint(r.reissueCode)
  reissue(@Input() { params }: Parsed<ParamsOut<typeof r.reissueCode>>, @Me() me: Principal, @Req() req: HcaRequest) {
    return this.auth.reissueCode(me, params.id, ctxOf(req));
  }

  @Endpoint(r.setUserStatus)
  async setStatus(@Input() { params, body }: Parsed<ParamsOut<typeof r.setUserStatus>, unknown, BodyOut<typeof r.setUserStatus>>, @Me() me: Principal, @Req() req: HcaRequest) {
    await this.auth.setStatus(me, params.id, body.status, ctxOf(req));
    return { ok: true as const };
  }
}
