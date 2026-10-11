import { VendorError } from "../core.js";
import {
  addressCountry,
  assertSendRequest,
  DEFAULT_SIZE,
  type CancelResult,
  type PostcardAddress,
  type PostcardReceipt,
  type PostcardSend,
  type PostcardVendorAdapter,
  type TrackingInfo,
} from "../postcard.js";

// Lob adapter. Sends postcards through the Lob Print and Mail API.
// Base https://api.lob.com/v1, HTTP Basic auth with the API key as
// the username, JSON bodies. Sizes 4x6 and 6x9 pass through as-is.

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

interface LobTrackingEvent {
  name?: string;
  time?: string;
  location?: string;
}

interface LobPostcardBody {
  id?: string;
  url?: string;
  expected_delivery_date?: string;
  tracking_events?: LobTrackingEvent[];
  deleted?: boolean;
}

function errorText(status: number, body: string): string {
  const trimmed = body.trim().slice(0, 400);
  return trimmed.length > 0 ? `lob got status ${status}: ${trimmed}` : `lob got status ${status}`;
}

export class LobPostcardAdapter implements PostcardVendorAdapter {
  readonly name = "lob";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: LobAdapterOptions = {}) {
    const key = options.apiKey ?? process.env.LOB_API_KEY;
    if (!key) {
      throw new VendorError("lob needs LOB_API_KEY to send");
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? LOB_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
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
      throw new VendorError(`lob request failed: ${String(error)}`, { cause: error });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new VendorError(errorText(response.status, body), {
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
    const parsed = (await response.json()) as LobPostcardBody;
    if (typeof parsed.id !== "string" || parsed.id.length === 0) {
      throw new VendorError("lob send returned no card id");
    }
    return {
      adapter: this.name,
      id: parsed.id,
      previewUrl: typeof parsed.url === "string" ? parsed.url : undefined,
      trackingUrl:
        typeof parsed.url === "string" && parsed.url.length > 0
          ? parsed.url
          : `${this.baseUrl}/postcards/${parsed.id}`,
      at: new Date().toISOString(),
    };
  }

  async trackCard(id: string): Promise<TrackingInfo> {
    const response = await this.request(`/postcards/${encodeURIComponent(id)}`, {
      method: "GET",
    });
    const parsed = (await response.json()) as LobPostcardBody;
    const events = (parsed.tracking_events ?? []).map((event) => ({
      name: event.name ?? "unknown",
      time: event.time,
      location: event.location,
    }));
    const last = events.length > 0 ? events[events.length - 1].name : "created";
    return {
      adapter: this.name,
      id,
      status: parsed.deleted === true ? "cancelled" : last,
      expectedDelivery:
        typeof parsed.expected_delivery_date === "string"
          ? parsed.expected_delivery_date
          : undefined,
      events,
      at: new Date().toISOString(),
    };
  }

  async cancelCard(id: string): Promise<CancelResult> {
    const response = await this.request(`/postcards/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const parsed = (await response.json()) as LobPostcardBody;
    return {
      adapter: this.name,
      id,
      cancelled: parsed.deleted === true,
      status: parsed.deleted === true ? "cancelled" : "active",
      at: new Date().toISOString(),
    };
  }
}
