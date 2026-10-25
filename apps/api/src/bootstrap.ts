import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@hca/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { appModule } from './app.module';
import { requestId } from './common/request-id';
import type { Config } from './config';

export async function createApp(config: Config): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(appModule(config), {
    logger: config.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true, exposedHeaders: ['X-Request-Id'] });
  app.enableShutdownHooks();
  return app;
}
