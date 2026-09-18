/**
 * SMS OTP Provider (Sendchamp)
 *
 * Sendchamp's send API is JSON and auth'd via a plain `Authorization: Bearer
 * <apiKey>` header, but the request/response shape (array of recipients,
 * "route" field, nested `data.status`) is different enough from the generic
 * gateway in sms.provider.ts that it gets its own provider.
 *
 * Get your API key from the Sendchamp dashboard (Settings > API Keys). Use
 * the test key while SENDCHAMP_ROUTE=dnd against sandbox numbers, and the
 * live key in production.
 */

import axios from 'axios';
import config from '../../../../config';
import { OtpDeliveryProvider } from './types';

interface SendchampResponse {
  status: string;
  code: string;
  message: string;
  data?: {
    id: string;
    phone_number: string;
    reference: string;
    status: string;
  };
}

export const sendchampOtpProvider: OtpDeliveryProvider = {
  channel: 'phone',

  isEnabled(): boolean {
    const { sms } = config.auth;
    return sms.enabled && sms.provider === 'sendchamp' && !!sms.sendchamp.apiKey;
  },

  async send(identifier: string, code: string): Promise<void> {
    const { sms, otp } = config.auth;
    // Sendchamp expects the number in international format without the
    // leading "+" (e.g. "2348012345678") - a leading "+" is silently
    // accepted (status: "success") but never actually reaches the handset.
    const to = identifier.startsWith('+') ? identifier.slice(1) : identifier;

    const { data } = await axios.post<SendchampResponse>(
      `${sms.sendchamp.baseUrl}/sms/send`,
      {
        to: [to],
        message: `Your 2Settle login code is ${code}. It expires in ${Math.round(otp.expiresInSec / 60)} minutes.`,
        sender_name: sms.sendchamp.senderName,
        route: sms.sendchamp.route,
      },
      {
        headers: {
          Authorization: `Bearer ${sms.sendchamp.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (data?.status !== 'success') {
      throw new Error(`Sendchamp SMS failed: ${data?.message || 'unknown error'}`);
    }

    // "success" here only means Sendchamp accepted the request - it does
    // not mean the SMS was delivered to the handset. Log the full response
    // since the exact response shape isn't confirmed yet.
    console.log(`[sendchamp] queued OTP sms to=${to}:`, JSON.stringify(data));
  },
};
