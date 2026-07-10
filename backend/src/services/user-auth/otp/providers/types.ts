/**
 * OTP Delivery Provider Interface
 *
 * Same shape as SettlementProvider (settlement/providers/types.ts) — implement
 * this to add a new delivery channel. The registry in ./index.ts picks the
 * provider for a channel based on config, falling back to the console
 * provider when nothing is configured (local dev).
 */

import { OtpChannel } from '../../types';

export interface OtpDeliveryProvider {
  readonly channel: OtpChannel;
  isEnabled(): boolean;
  send(identifier: string, code: string): Promise<void>;
}
