/**
 * Email OTP Provider (SMTP via nodemailer)
 */

import fs from 'fs';
import path from 'path';
import nodemailer, { Transporter } from 'nodemailer';
import config from '../../../../config';
import { OtpDeliveryProvider } from './types';
import { buildOtpEmailHtml, LOGO_CID } from './email.template';

const LOGO_PATH = path.join(__dirname, '../../../../assets/logo.png');

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.auth.email.smtpHost,
      port: config.auth.email.smtpPort,
      secure: config.auth.email.smtpPort === 465,
      auth: {
        user: config.auth.email.smtpUser,
        pass: config.auth.email.smtpPassword,
      },
      // Nodemailer's defaults (2min connect/socket, 30s greeting) far exceed the
      // route's request timeout, so a stalled SMTP handshake would hang past it
      // and crash with ERR_HTTP_HEADERS_SENT when it finally resolves. Fail fast
      // and well within the route's timeout instead.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return transporter;
}

export const emailOtpProvider: OtpDeliveryProvider = {
  channel: 'email',

  isEnabled(): boolean {
    return config.auth.email.enabled && !!config.auth.email.smtpHost;
  },

  async send(identifier: string, code: string): Promise<void> {
    const minutes = Math.round(config.auth.otp.expiresInSec / 60);
    await getTransporter().sendMail({
      from: config.auth.email.fromAddress,
      to: identifier,
      subject: 'Your 2Settle login code',
      text: `Your login code is ${code}. It expires in ${minutes} minutes.`,
      html: buildOtpEmailHtml(code, minutes),
      attachments: fs.existsSync(LOGO_PATH)
        ? [{ filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID }]
        : [],
    });
  },
};
