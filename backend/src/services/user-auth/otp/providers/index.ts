export type { OtpDeliveryProvider } from './types';
export { emailOtpProvider } from './email.provider';
export { smsOtpProvider } from './sms.provider';
export { createConsoleProvider } from './console.provider';

import { OtpChannel } from '../../types';
import { OtpDeliveryProvider } from './types';
import { emailOtpProvider } from './email.provider';
import { smsOtpProvider } from './sms.provider';
import { createConsoleProvider } from './console.provider';

const REAL_PROVIDERS: Record<OtpChannel, OtpDeliveryProvider> = {
  email: emailOtpProvider,
  phone: smsOtpProvider,
};

const CONSOLE_FALLBACKS: Record<OtpChannel, OtpDeliveryProvider> = {
  email: createConsoleProvider('email'),
  phone: createConsoleProvider('phone'),
};

/**
 * Returns the provider to use for a channel - the real provider if it's
 * configured/enabled, otherwise the console fallback (dev mode).
 */
export function getOtpProvider(channel: OtpChannel): OtpDeliveryProvider {
  const provider = REAL_PROVIDERS[channel];
  return provider.isEnabled() ? provider : CONSOLE_FALLBACKS[channel];
}
