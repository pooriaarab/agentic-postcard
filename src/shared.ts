// Shared postcard shapes and validators. This module is pure: no env,
// no filesystem, no vendor imports — so both the SDK path (postcard.ts)
// and the fetch-only /adapters entry point can build on it.

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
// proof page for live sends, a dry-run marker for previews. The
// vendor's own id, its reported cost in integer cents, and the
// expected delivery date are optional extras the vendor may send
// back: absent stays absent.

export interface PostcardReceipt {
  adapter: string;
  id: string;
  vendorId?: string;
  status?: string;
  previewUrl?: string;
  trackingUrl: string;
  costCents?: number;
  currency?: string;
  expectedDelivery?: string;
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

// Recipient check. A send verifies the recipient first and refuses
// an undeliverable address before any vendor call.

export interface RecipientCheck {
  deliverability: "deliverable" | "risky" | "undeliverable" | "unknown";
  score: number;
}

// One verify call for one recipient: the shape an agentic-address
// verifier plugs into. Returning a rejected promise refuses the send.
export type RecipientVerifier = (
  to: PostcardAddress,
) => Promise<RecipientCheck>;
