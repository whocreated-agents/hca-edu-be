import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { CONFIG, type Config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class MailerService {
  private readonly log = new Logger('Mailer');
  private readonly transport: Transporter | null;
  /** Populated only when MAIL_TRANSPORT=memory (tests). */
  readonly outbox: Mail[] = [];

  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    this.transport =
      cfg.MAIL_TRANSPORT === 'memory'
        ? null
        : createTransport({
            host: cfg.SMTP_HOST || 'localhost',
            port: cfg.SMTP_PORT,
            secure: cfg.SMTP_PORT === 465,
            ...(cfg.SMTP_USER ? { auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } } : {}),
          });
  }

  /** Never throws: callers must not leak (via errors or timing) whether an address received mail. */
  async send(mail: Mail): Promise<void> {
    try {
      if (!this.transport) {
        this.outbox.push(mail);
        return;
      }
      await this.transport.sendMail({ from: this.cfg.SMTP_FROM, ...mail });
    } catch (e) {
      this.log.error(`Mail send failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
