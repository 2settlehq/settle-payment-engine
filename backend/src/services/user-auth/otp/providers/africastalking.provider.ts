/**
 * SMS OTP Provider (Africa's Talking)
 *
 * Africa's Talking's messaging API is form-encoded (not JSON) and auth'd via
 * an `apiKey` header + a `username` field - different enough from a generic
 * REST gateway that it gets its own provider rather than fitting the
 * config-driven generic one in sms.provider.ts.
 *
 * For sandbox testing (no paid account needed), set:
 *   AFRICASTALKING_USERNAME=sandbox
 *   AFRICASTALKING_BASE_URL=https://api.sandbox.africastalking.com/version1/messaging
 * Sandbox messages only deliver to numbers registered as simulator numbers
 * in your Africa's Talking dashboard.
 */

import axios from 'axios';
import config from '../../../../config';
import { OtpDeliveryProvider } from './types';

interface AfricasTalkingRecipient {
  status: string;
  statusCode: number;
  number: string;
  cost: string;
  messageId: string;
}

interface AfricasTalkingResponse {
  SMSMessageData: {
    Message: string;
    Recipients: AfricasTalkingRecipient[];
  };
}

export const africasTalkingOtpProvider: OtpDeliveryProvider = {
  channel: 'phone',

  isEnabled(): boolean {
    const { sms } = config.auth;
    return (
      sms.enabled &&
      sms.provider === 'africastalking' &&
      !!sms.africastalking.apiKey &&
      !!sms.africastalking.username
    );
  },

  async send(identifier: string, code: string): Promise<void> {
    const { sms, otp } = config.auth;
    const to = identifier.startsWith('+') ? identifier : `+${identifier}`;

    const body = new URLSearchParams({
      username: sms.africastalking.username,
      to,
      message: `Your 2Settle login code is ${code}. It expires in ${Math.round(otp.expiresInSec / 60)} minutes.`,
    });
    if (sms.senderId) {
      body.set('from', sms.senderId);
    }

    const { data } = await axios.post<AfricasTalkingResponse>(
      sms.africastalking.baseUrl,
      body,
      {
        headers: {
          apiKey: sms.africastalking.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10000,
      }
    );

    // Africa's Talking returns 2xx even when the individual message fails,
    // so success has to be checked per-recipient rather than via HTTP status.
    const recipients = data?.SMSMessageData?.Recipients ?? [];
    const failed = recipients.find((r) => r.status !== 'Success');
    if (failed) {
      throw new Error(`Africa's Talking SMS failed: ${failed.status}`);
    }
  },
};
