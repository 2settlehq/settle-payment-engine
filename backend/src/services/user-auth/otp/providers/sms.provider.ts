/**
 * SMS OTP Provider (generic HTTP gateway)
 *
 * Not tied to a specific vendor - posts { to, message, senderId } with the
 * API key as a bearer token to config.auth.sms.gatewayUrl. Works with most
 * REST-based SMS gateways (Termii, Africa's Talking, etc); adjust the
 * request shape below to match your provider's API if it differs.
 */

import axios from 'axios';
import config from '../../../../config';
import { OtpDeliveryProvider } from './types';

export const smsOtpProvider: OtpDeliveryProvider = {
  channel: 'phone',

  isEnabled(): boolean {
    const { sms } = config.auth;
    return sms.enabled && sms.provider === 'generic' && !!sms.gatewayUrl;
  },

  async send(identifier: string, code: string): Promise<void> {
    await axios.post(
      config.auth.sms.gatewayUrl,
      {
        to: identifier,
        senderId: config.auth.sms.senderId,
        message: `Your 2Settle login code is ${code}. It expires in ${Math.round(config.auth.otp.expiresInSec / 60)} minutes.`,
      },
      {
        headers: { Authorization: `Bearer ${config.auth.sms.apiKey}` },
        timeout: 10000,
      }
    );
  },
};
