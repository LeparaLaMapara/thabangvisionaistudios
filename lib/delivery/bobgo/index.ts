/** Bob Go courier-aggregator adapter. UNVERIFIED contract: see api-contract.ts and docs/logistics/bobgo.md. */
export { BOBGO_CAPABILITIES, BOBGO_CONTRACT, BOBGO_CONTRACT_SOURCES, BOBGO_PROVIDER_ID, BOBGO_STATUS, mapBobgoStatus, type ContractSource } from './api-contract';
export { bobgoConfigFromEnv, bobgoDelivery, bobgoRandsToCents, createBobgoAdapter, type BobgoConfig } from './adapter';
export { bobgoWebhookParser, createBobgoWebhookParser, type BobgoSignatureVerifier } from './webhook';
