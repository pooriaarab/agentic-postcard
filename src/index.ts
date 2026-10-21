export { VERSION } from "./version.js";
export {
  defineBrand,
  createLogger,
  GuardError,
  VendorError,
  createGuards,
  LocalRouterAdapter,
  HttpRouterAdapter,
  recordCost,
  getCostReport,
  resetCosts,
  createDryRunResult,
  dispatchText,
  summarizeText,
} from "./core.js";
export type {
  BrandConfig,
  LogLevel,
  Logger,
  LoggerOptions,
  CapsConfig,
  QuietHoursConfig,
  GuardsConfig,
  Guards,
  DispatchReceipt,
  RouterAdapter,
  HttpRouterOptions,
  CostEntry,
  CostReport,
  DispatchOptions,
  DispatchResult,
  TopWord,
  TextSummary,
  SummarizeOptions,
} from "./core.js";
export {
  assertAddress,
  assertSize,
  assertSendRequest,
  addressCountry,
  buildCardHtml,
  selectAdapter,
  sendPostcard,
  trackPostcard,
  cancelPostcard,
  DEFAULT_SIZE,
} from "./postcard.js";
export type {
  PostcardAddress,
  PostcardSize,
  PostcardSend,
  PostcardReceipt,
  TrackingEvent,
  TrackingInfo,
  CancelResult,
  PostcardVendorAdapter,
  VendorName,
  AdapterKeys,
  CardHtml,
  SendPostcardOptions,
  SendPostcardResult,
} from "./postcard.js";
export { LobPostcardAdapter, LOB_BASE_URL } from "./vendors/lob.js";
export type { LobAdapterOptions } from "./vendors/lob.js";
export {
  PostGridPostcardAdapter,
  POSTGRID_BASE_URL,
  postgridSize,
} from "./vendors/postgrid.js";
export type { PostGridAdapterOptions } from "./vendors/postgrid.js";
export { DryRunPostcardAdapter } from "./vendors/stub.js";
// The vendor adapters throw AdapterError (the /adapters entry defines
// it locally); the Node path re-exports it so SDK callers can catch it.
export { AdapterError } from "./adapters.js";

import { defineBrand, type BrandConfig } from "./core.js";
import { VERSION } from "./version.js";

export const DEFAULT_BRAND: BrandConfig = defineBrand({
  name: "Agentic postcard",
  command: "agentic-postcard",
  description: "Send postcards through print vendors from CLI, code, or MCP.",
  keywords: [
    "postcards",
    "direct-mail",
    "lob",
    "postgrid",
    "agentic-suite",
    "claude-code",
    "codex",
    "cli",
    "mcp",
  ],
  version: VERSION,
});
