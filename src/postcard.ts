import { randomUUID } from "node:crypto";
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

// Addresses. One shape feeds both vendors. Each vendor maps it to
// its own contact fields before it sends the request.

export interface PostcardAddress {
  name?: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

const ADDRESS_FIELDS = ["line1", "city", "state", "zip"] as const;

export function assertAddress(
  value: PostcardAddress,
  label: string,
): asserts value is PostcardAddress {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} must be an object`);
  }
  for (const field of ADDRESS_FIELDS) {
    const entry = value[field];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`${label} needs a non-empty "${field}"`);
    }
  }
}

export function addressCountry(value: PostcardAddress): string {
  return value.country?.trim() || "US";
}

// Sizes. The pack speaks 4x6 and 6x9. Each vendor maps these to
// its own catalog names. Unknown sizes throw before any request.

export type PostcardSize = "4x6" | "6x9";

export const DEFAULT_SIZE: PostcardSize = "4x6";

export function assertSize(value: unknown): asserts value is PostcardSize {
  if (value !== "4x6" && value !== "6x9") {
    throw new Error(`size must be "4x6" or "6x9", got ${JSON.stringify(value)}`);
  }
}

// Send request. Front and back carry full HTML. Size defaults to
// 4x6. Metadata tags the send in the vendor dashboard.

export interface PostcardSend {
  to: PostcardAddress;
  from?: PostcardAddress;
  front: string;
  back: string;
  size?: PostcardSize;
  description?: string;
  metadata?: Record<string, string>;
  sendDate?: string;
}

export function assertSendRequest(value: PostcardSend): void {
  assertAddress(value.to, "to");
  if (value.from !== undefined) {
    assertAddress(value.from, "from");
  }
  if (typeof value.front !== "string" || value.front.trim().length === 0) {
    throw new Error("send needs a non-empty front HTML string");
  }
  if (typeof value.back !== "string" || value.back.trim().length === 0) {
    throw new Error("send needs a non-empty back HTML string");
  }
  if (value.size !== undefined) {
    assertSize(value.size);
  }
}

// Receipt. Every send returns one tracked page URL: the vendor
// proof page for live sends, a dry-run marker for previews.

export interface PostcardReceipt {
  adapter: string;
  id: string;
  status?: string;
  previewUrl?: string;
  trackingUrl: string;
  at: string;
}

export interface TrackingEvent {
  name: string;
  time?: string;
  location?: string;
}

export interface TrackingInfo {
  adapter: string;
  id: string;
  status: string;
  expectedDelivery?: string;
  trackingNumber?: string;
  events: TrackingEvent[];
  at: string;
}

export interface CancelResult {
  adapter: string;
  id: string;
  cancelled: boolean;
  status?: string;
  at: string;
}

// Vendor adapters. Each one sends, tracks, and cancels through
// its vendor API. All failures throw VendorError.

export interface PostcardVendorAdapter {
  readonly name: string;
  sendCard(request: PostcardSend): Promise<PostcardReceipt>;
  trackCard(id: string): Promise<TrackingInfo>;
  cancelCard(id: string, note?: string): Promise<CancelResult>;
}

export type VendorName = "lob" | "postgrid" | "dry-run";

export interface AdapterKeys {
  lobKey?: string;
  postgridKey?: string;
}

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

// Card HTML. Wraps a plain message in front and back pages so a
// sender with no artwork can still mail a card.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface CardHtml {
  front: string;
  back: string;
}

export function buildCardHtml(message: string): CardHtml {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new Error("message must be a non-empty string");
  }
  const safe = escapeHtml(message.trim()).replace(/\n/g, "<br>");
  const front = [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"></head>',
    '<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Georgia,serif;">',
    `<p style="font-size:42px;text-align:center;padding:48px;">${safe}</p>`,
    "</body></html>",
  ].join("");
  const back = [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"></head>',
    '<body style="margin:0;padding:64px;font-family:Georgia,serif;">',
    `<p style="font-size:20px;line-height:1.5;">${safe}</p>`,
    "</body></html>",
  ].join("");
  return { front, back };
}

// Send flow. Validates, checks guards, sends, then records cost.
// Dry run walks the same path but moves no card and records nothing.

export interface SendPostcardOptions {
  vendor?: string;
  live?: boolean;
  guards?: Guards;
  logger?: Logger;
  keys?: AdapterKeys;
}

export interface SendPostcardResult {
  dryRun: boolean;
  receipt: PostcardReceipt;
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
    };
  }
  if (adapter.name === "dry-run") {
    throw new VendorError(
      "live send needs a vendor key: set LOB_API_KEY or POSTGRID_API_KEY",
    );
  }
  const receipt = await adapter.sendCard(request);
  guards.recordDispatch();
  recordCost({ kind: "dispatch", adapter: adapter.name, units: 1 });
  options.logger?.info(`sent postcard ${receipt.id} via ${adapter.name}`);
  return { dryRun: false, receipt };
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
