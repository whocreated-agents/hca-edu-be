import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class MaintenanceService {
  private readonly log = new Logger('Maintenance');
  constructor(private readonly auth: AuthService) {}

  // Notice expiry sweep, session state transition and the nightly pg_dump (BLUEPRINT-001 s6) belong
  // with their own feature modules; only token hygiene lives here.
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredCredentials(): Promise<void> {
    try {
      await this.auth.purgeExpired();
    } catch (e) {
      this.log.error(`purge failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
