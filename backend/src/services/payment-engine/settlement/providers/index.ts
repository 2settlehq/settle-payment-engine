export type { SettlementProvider, SettlementTransferResult } from './types';
export { MongoroSettlementProvider, mongoroSettlementProvider } from './mongoro.provider';

import { SettlementProvider } from './types';
import { mongoroSettlementProvider } from './mongoro.provider';

// Registered provider set. Add new settlement rails here.
export const ALL_SETTLEMENT_PROVIDERS: SettlementProvider[] = [
  mongoroSettlementProvider,
];
