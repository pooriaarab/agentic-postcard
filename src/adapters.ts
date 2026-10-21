import { VendorError } from "agentic-core";
import type { Guards, Logger } from "agentic-core";
import {
  addressCountry,
  assertSendRequest,
  DEFAULT_SIZE,
  type CancelResult,
  type PostcardAddress,
  type PostcardReceipt,
  type PostcardSend,
  type PostcardVendorAdapter,
  type RecipientCheck,
  type RecipientVerifier,
  type TrackingInfo,
} from "./shared.js";

// Fetch-only entry point for Cloudflare Workers and other hosts with
// no filesystem and no process.env. `import { PostGridPostcardAdapter }
// from "agentic-postcard/adapters"` takes every credential as an
// argument; nothing is read from the environment. The SDK, CLI, and
// MCP entry points keep their env fallbacks in ./vendors/.

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
export { DryRunPostcardAdapter } from "./vendors/stub.js";
export { VendorError } from "agentic-core";

// Integer minor units from a vendor price (a decimal major-unit
// string or number). Empty stays unknown; Twilio-style negative
// charges report their magnitude.
function centsOf(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function basicAuth(user: string, password = ""): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

function errorText(vendor: string, status: number, body: string): string {
  const trimmed = body.trim().slice(0, 400);
  return trimmed.length > 0
    ? `${vendor} got status ${status}: ${trimmed}`
    : `${vendor} got status ${status}`;
}

// Lob. Sends postcards through the Lob Print and Mail API. Base
// https://api.lob.com/v1, HTTP Basic auth with the API key as the
// username, JSON bodies. The postcard object's `cost` field carries
// the charge as a decimal string and `expected_delivery_date` the
// delivery estimate.

export const LOB_BASE_URL = "https://api.lob.com/v1";

export interface LobAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface LobAddressBody {
  name?: string;
  company?: string;
  address_line1: string;
  address_line2?: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  address_country: string;
}

function toLobAddress(value: PostcardAddress): LobAddressBody {
  const body: LobAddressBody = {
    address_line1: value.line1,
    address_city: value.city,
    address_state: value.state,
    address_zip: value.zip,
    address_country: addressCountry(value),
  };
  if (value.name !== undefined) body.name = value.name;
  if (value.company !== undefined) body.company = value.company;
  if (value.line2 !== undefined) body.address_line2 = value.line2;
  return body;
}

export class LobPostcardAdapter implements PostcardVendorAdapter {
  readonly name = "lob";
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly timeoutMs: number;
  protected readonly fetchFn: typeof fetch;

  constructor(options: LobAdapterOptions = {}) {
    if (!options.apiKey) {
      throw new VendorError("lob needs an apiKey argument to send");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? LOB_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      authorization: basicAuth(this.apiKey),
      "content-type": "application/json",
      accept: "application/json",
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new VendorError(`lob request failed: ${String(error)}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new VendorError(errorText(this.name, response.status, body), {
        status: response.status,
      });
    }
    return response;
  }

  async sendCard(request: PostcardSend): Promise<PostcardReceipt> {
    assertSendRequest(request);
    const body: Record<string, unknown> = {
      to: toLobAddress(request.to),
      size: request.size ?? DEFAULT_SIZE,
      front: request.front,
      back: request.back,
      use_type: "operational",
    };
    if (request.from !== undefined) body.from = toLobAddress(request.from);
    if (request.description !== undefined) body.description = request.description;
    if (request.metadata !== undefined) body.metadata = request.metadata;
    if (request.sendDate !== undefined) body.send_date = request.sendDate;
    const response = await this.request("/postcards", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const parsed = asRecord(await response.json());
    const id = str(parsed.id);
    if (id === undefined) {
      throw new VendorError("lob send returned no card id");
    }
    const costCents = centsOf(parsed.cost ?? parsed.price);
    return {
      adapter: this.name,
      id,
      vendorId: id,
      previewUrl: str(parsed.url),
      trackingUrl:
        str(parsed.url) ?? `${this.baseUrl}/postcards/${id}`,
      ...(costCents !== undefined ? { costCents } : {}),
      ...(costCents !== undefined
        ? { currency: str(parsed.currency) ?? "USD" }
        : {}),
      ...(str(parsed.expected_delivery_date) !== undefined
        ? { expectedDelivery: str(parsed.expected_delivery_date) }
        : {}),
      at: new Date().toISOString(),
    };
  }

  async trackCard(id: string): Promise<TrackingInfo> {
    const response = await this.request(`/postcards/${encodeURIComponent(id)}`, {
      method: "GET",
    });
    const parsed = asRecord(await response.json());
    const events = (Array.isArray(parsed.tracking_events)
      ? parsed.tracking_events
      : []
    ).map((event) => {
      const entry = asRecord(event);
      return {
        name: str(entry.name) ?? "unknown",
        time: str(entry.time),
        location: str(entry.location),
      };
    });
    const last = events.length > 0 ? events[events.length - 1].name : "created";
    return {
      adapter: this.name,
      id,
      status: parsed.deleted === true ? "cancelled" : last,
      expectedDelivery: str(parsed.expected_delivery_date),
      events,
      at: new Date().toISOString(),
    };
  }

  async cancelCard(id: string): Promise<CancelResult> {
    const response = await this.request(`/postcards/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const parsed = asRecord(await response.json());
    return {
      adapter: this.name,
      id,
      cancelled: parsed.deleted === true,
      status: parsed.deleted === true ? "cancelled" : "active",
      at: new Date().toISOString(),
    };
  }
}

// PostGrid. Sends postcards through the PostGrid Print and Mail API.
// Base https://api.postgrid.com, auth header x-api-key, JSON bodies.
// Pack sizes map to PostGrid names: 4x6 to 6x4 and 6x9 to 9x6. The
// postcard object's `price` field carries the charge as a decimal
// and `expectedDeliveryDate` the delivery estimate.

export const POSTGRID_BASE_URL = "https://api.postgrid.com";

const SIZE_MAP: Record<string, string> = {
  "4x6": "6x4",
  "6x9": "9x6",
};

export function postgridSize(size: string): string {
  const mapped = SIZE_MAP[size];
  if (mapped === undefined) {
    throw new VendorError(`postgrid has no size "${size}"`);
  }
  return mapped;
}

export interface PostGridAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface PostGridContactBody {
  firstName?: string;
  companyName?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  provinceOrState: string;
  postalOrZip: string;
  countryCode: string;
}

function toContact(value: PostcardAddress): PostGridContactBody {
  const body: PostGridContactBody = {
    addressLine1: value.line1,
    city: value.city,
    provinceOrState: value.state,
    postalOrZip: value.zip,
    countryCode: addressCountry(value),
  };
  if (value.name !== undefined) body.firstName = value.name;
  if (value.company !== undefined) body.companyName = value.company;
  if (value.line2 !== undefined) body.addressLine2 = value.line2;
  return body;
}

export class PostGridPostcardAdapter implements PostcardVendorAdapter {
  readonly name = "postgrid";
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly timeoutMs: number;
  protected readonly fetchFn: typeof fetch;

  constructor(options: PostGridAdapterOptions = {}) {
    if (!options.apiKey) {
      throw new VendorError("postgrid needs an apiKey argument to send");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? POSTGRID_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "content-type": "application/json",
      accept: "application/json",
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new VendorError(`postgrid request failed: ${String(error)}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new VendorError(errorText(this.name, response.status, body), {
        status: response.status,
      });
    }
    return response;
  }

  async sendCard(request: PostcardSend): Promise<PostcardReceipt> {
    assertSendRequest(request);
    const body: Record<string, unknown> = {
      frontHTML: request.front,
      backHTML: request.back,
      size: postgridSize(request.size ?? DEFAULT_SIZE),
      to: toContact(request.to),
    };
    if (request.from !== undefined) body.from = toContact(request.from);
    if (request.description !== undefined) body.description = request.description;
    if (request.metadata !== undefined) body.metadata = request.metadata;
    if (request.sendDate !== undefined) body.sendDate = request.sendDate;
    const response = await this.request("/print-mail/v1/postcards", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const parsed = asRecord(await response.json());
    const id = str(parsed.id);
    if (id === undefined) {
      throw new VendorError("postgrid send returned no card id");
    }
    const costCents = centsOf(parsed.price);
    return {
      adapter: this.name,
      id,
      vendorId: id,
      status: str(parsed.status),
      previewUrl: str(parsed.url),
      trackingUrl:
        str(parsed.url) ?? `${this.baseUrl}/print-mail/v1/postcards/${id}`,
      ...(costCents !== undefined ? { costCents } : {}),
      ...(costCents !== undefined ? { currency: "USD" } : {}),
      ...(str(parsed.expectedDeliveryDate) !== undefined
        ? { expectedDelivery: str(parsed.expectedDeliveryDate) }
        : {}),
      at: new Date().toISOString(),
    };
  }

  async trackCard(id: string): Promise<TrackingInfo> {
    const response = await this.request(
      `/print-mail/v1/postcards/${encodeURIComponent(id)}`,
      { method: "GET" },
    );
    const parsed = asRecord(await response.json());
    const events =
      typeof parsed.imbStatus === "string"
        ? [{ name: parsed.imbStatus }]
        : [];
    return {
      adapter: this.name,
      id,
      status: str(parsed.status) ?? "unknown",
      trackingNumber: str(parsed.trackingNumber),
      expectedDelivery: str(parsed.expectedDeliveryDate),
      events,
      at: new Date().toISOString(),
    };
  }

  async cancelCard(id: string, note?: string): Promise<CancelResult> {
    const encoded = encodeURIComponent(id);
    const response =
      note !== undefined
        ? await this.request(`/print-mail/v1/postcards/${encoded}/cancellation`, {
            method: "POST",
            body: JSON.stringify({ note }),
          })
        : await this.request(`/print-mail/v1/postcards/${encoded}`, {
            method: "DELETE",
          });
    const parsed = asRecord(await response.json());
    const status = str(parsed.status) ?? "unknown";
    return {
      adapter: this.name,
      id,
      cancelled: status === "cancelled",
      status,
      at: new Date().toISOString(),
    };
  }
}

// Verified send. The recipient is checked through an injected verifier
// (an agentic-address verify call in the CRM) before the vendor sees
// the card. An undeliverable verdict or a thrown check refuses the
// send and spends nothing.

export interface VerifiedSendOptions {
  adapter: PostcardVendorAdapter;
  verify: RecipientVerifier;
  guards?: Guards;
  logger?: Logger;
}

export interface VerifiedSendResult {
  receipt: PostcardReceipt;
  recipient: RecipientCheck;
}

export function addressInputOf(to: PostcardAddress): {
  street: string;
  line2?: string;
  city: string;
  state: string;
  postal: string;
  country: string;
} {
  return {
    street: to.line1,
    ...(to.line2 !== undefined ? { line2: to.line2 } : {}),
    city: to.city,
    state: to.state,
    postal: to.zip,
    country: addressCountry(to),
  };
}

export async function sendVerifiedPostcard(
  request: PostcardSend,
  options: VerifiedSendOptions,
): Promise<VerifiedSendResult> {
  assertSendRequest(request);
  options.guards?.checkDispatch(`${request.front}\n${request.back}`);
  const recipient = await options.verify(request.to);
  if (recipient.deliverability === "undeliverable") {
    throw new VendorError(
      `recipient address is undeliverable (score ${recipient.score})`,
    );
  }
  const receipt = await options.adapter.sendCard(request);
  options.guards?.recordDispatch();
  options.logger?.info(`sent postcard ${receipt.id} via ${options.adapter.name}`);
  return { receipt, recipient };
}
