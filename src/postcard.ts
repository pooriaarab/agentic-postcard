import { randomUUID } from "node:crypto";
import { verifyAddress, type AddressVendor } from "agentic-address";
import {
  createGuards,
  recordCost,
  VendorError,
  type Guards,
  type Logger,
} from "./core.js";
import { LobPostcardAdapter } from "./vendors/lob.js";
import { PostGridPostcardAdapter } from "./vendors/postgrid.js";
import { DryRunPostcardAdapter } from "./vendors/stub.js";

// Shared shapes and validators live in ./shared.js so the fetch-only
// /adapters entry point can use them without pulling this module (and
// its agentic-address import) into a Workers bundle. They re-export
// here so existing postcard.js importers keep working.
export {
  assertAddress,
  assertSendRequest,
  assertSize,
  addressCountry,
  buildCardHtml,
  DEFAULT_SIZE,
} from "./shared.js";
export type {
  AdapterKeys,
  CancelResult,
  CardHtml,
  PostcardAddress,
  PostcardReceipt,
  PostcardSend,
  PostcardSize,
  PostcardVendorAdapter,
  RecipientCheck,
  RecipientVerifier,
  TrackingEvent,
  TrackingInfo,
  VendorName,
} from "./shared.js";

import type {
  AdapterKeys,
  PostcardAddress,
  PostcardReceipt,
  PostcardSend,
  PostcardVendorAdapter,
  RecipientCheck,
  TrackingInfo,
  CancelResult,
} from "./shared.js";
import { assertSendRequest } from "./shared.js";

function readKeys(overrides: AdapterKeys = {}): AdapterKeys {
  return {
    lobKey: overrides.lobKey ?? process.env.LOB_API_KEY,
    postgridKey:
      overrides.postgridKey ??
      process.env.POSTGRID_API_KEY ??
      process.env.POSTGRID_PRINT_MAIL_API_KEY,
  };
}

export function selectAdapter(
  name?: string,
  overrides: AdapterKeys = {},
): PostcardVendorAdapter {
  const keys = readKeys(overrides);
  if (name === "lob") {
    if (!keys.lobKey) {
      throw new VendorError("lob needs LOB_API_KEY to send");
    }
    return new LobPostcardAdapter({ apiKey: keys.lobKey });
  }
  if (name === "postgrid") {
    if (!keys.postgridKey) {
      throw new VendorError("postgrid needs POSTGRID_API_KEY to send");
    }
    return new PostGridPostcardAdapter({ apiKey: keys.postgridKey });
  }
  if (name === "dry-run" || name === undefined) {
    if (name === undefined) {
      if (keys.postgridKey) {
        return new PostGridPostcardAdapter({ apiKey: keys.postgridKey });
      }
      if (keys.lobKey) {
        return new LobPostcardAdapter({ apiKey: keys.lobKey });
      }
    }
    return new DryRunPostcardAdapter();
  }
  throw new Error(`unknown vendor "${name}", want lob, postgrid, or dry-run`);
}

// Recipient check. Every send verifies the recipient through
// agentic-address first. Dry and local checks run offline and
// free. Keyed vendors call out only on a live send, and a live
// send to an undeliverable address is refused before it mails.

export type VerifyVendor = AddressVendor;

export async function verifyRecipient(
  to: PostcardAddress,
  vendor: VerifyVendor = "dry",
  live = false,
  apiKey?: string,
): Promise<RecipientCheck> {
  const receipt = await verifyAddress({
    street: to.line1,
    line2: to.line2,
    city: to.city,
    state: to.state,
    postal: to.zip,
    country: to.country,
    vendor,
    live,
    ...(apiKey ? { apiKey } : {}),
  });
  return {
    deliverability: receipt.deliverability,
    score: receipt.score,
  };
}

// Send flow. Validates, checks guards, verifies the recipient,
// sends, then records cost. Dry run walks the same path but
// moves no card and records nothing.

export interface SendPostcardOptions {
  vendor?: string;
  live?: boolean;
  guards?: Guards;
  logger?: Logger;
  keys?: AdapterKeys;
  verifyVendor?: VerifyVendor;
}

export interface SendPostcardResult {
  dryRun: boolean;
  receipt: PostcardReceipt;
  recipient: RecipientCheck;
}

export async function sendPostcard(
  request: PostcardSend,
  options: SendPostcardOptions = {},
): Promise<SendPostcardResult> {
  assertSendRequest(request);
  const live = options.live ?? false;
  const adapter = selectAdapter(options.vendor, options.keys);
  const guards = options.guards ?? createGuards();
  guards.checkDispatch(`${request.front}\n${request.back}`);
  const verifyVendor = options.verifyVendor ?? "dry";
  const keys = readKeys(options.keys);
  const recipientCheck = await verifyRecipient(
    request.to,
    verifyVendor,
    live && verifyVendor !== "dry" && verifyVendor !== "local",
    keys.lobKey ?? keys.postgridKey,
  );
  if (!live) {
    const id = `dry_${randomUUID()}`;
    options.logger?.info(`dry run: would send via ${adapter.name}`);
    return {
      dryRun: true,
      receipt: {
        adapter: adapter.name,
        id,
        trackingUrl: `dry-run://agentic-postcard/${id}`,
        at: new Date().toISOString(),
      },
      recipient: recipientCheck,
    };
  }
  if (adapter.name === "dry-run") {
    throw new VendorError(
      "live send needs a vendor key: set LOB_API_KEY or POSTGRID_API_KEY",
    );
  }
  if (recipientCheck.deliverability === "undeliverable") {
    throw new VendorError(
      `recipient address is undeliverable (score ${recipientCheck.score})`,
    );
  }
  const receipt = await adapter.sendCard(request);
  guards.recordDispatch();
  recordCost({ kind: "dispatch", adapter: adapter.name, units: 1 });
  options.logger?.info(`sent postcard ${receipt.id} via ${adapter.name}`);
  return { dryRun: false, receipt, recipient: recipientCheck };
}

export async function trackPostcard(
  vendor: string,
  id: string,
  keys: AdapterKeys = {},
): Promise<TrackingInfo> {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("track needs a non-empty card id");
  }
  return selectAdapter(vendor, keys).trackCard(id);
}

export async function cancelPostcard(
  vendor: string,
  id: string,
  note?: string,
  keys: AdapterKeys = {},
): Promise<CancelResult> {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("cancel needs a non-empty card id");
  }
  return selectAdapter(vendor, keys).cancelCard(id, note);
}
