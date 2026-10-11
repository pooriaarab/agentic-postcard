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

// PostGrid adapter. Sends postcards through the PostGrid Print and
// Mail API. Base https://api.postgrid.com, auth header x-api-key,
// JSON bodies. Pack sizes map to PostGrid names: 4x6 to 6x4 and
// 6x9 to 9x6.

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

interface PostGridPostcardBody {
  id?: string;
  status?: string;
  url?: string;
  trackingNumber?: string;
  imbStatus?: string;
}

function errorText(status: number, body: string): string {
  const trimmed = body.trim().slice(0, 400);
  return trimmed.length > 0
    ? `postgrid got status ${status}: ${trimmed}`
    : `postgrid got status ${status}`;
}

export class PostGridPostcardAdapter implements PostcardVendorAdapter {
  readonly name = "postgrid";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: PostGridAdapterOptions = {}) {
    const key =
      options.apiKey ??
      process.env.POSTGRID_API_KEY ??
      process.env.POSTGRID_PRINT_MAIL_API_KEY;
    if (!key) {
      throw new VendorError("postgrid needs POSTGRID_API_KEY to send");
    }
    this.apiKey = key;
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
      throw new VendorError(errorText(response.status, body), {
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
    const parsed = (await response.json()) as PostGridPostcardBody;
    if (typeof parsed.id !== "string" || parsed.id.length === 0) {
      throw new VendorError("postgrid send returned no card id");
    }
    return {
      adapter: this.name,
      id: parsed.id,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      previewUrl: typeof parsed.url === "string" ? parsed.url : undefined,
      trackingUrl:
        typeof parsed.url === "string" && parsed.url.length > 0
          ? parsed.url
          : `${this.baseUrl}/print-mail/v1/postcards/${parsed.id}`,
      at: new Date().toISOString(),
    };
  }

  async trackCard(id: string): Promise<TrackingInfo> {
    const response = await this.request(
      `/print-mail/v1/postcards/${encodeURIComponent(id)}`,
      { method: "GET" },
    );
    const parsed = (await response.json()) as PostGridPostcardBody;
    const events =
      typeof parsed.imbStatus === "string"
        ? [{ name: parsed.imbStatus }]
        : [];
    return {
      adapter: this.name,
      id,
      status: typeof parsed.status === "string" ? parsed.status : "unknown",
      trackingNumber:
        typeof parsed.trackingNumber === "string" ? parsed.trackingNumber : undefined,
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
    const parsed = (await response.json()) as PostGridPostcardBody;
    const status = typeof parsed.status === "string" ? parsed.status : "unknown";
    return {
      adapter: this.name,
      id,
      cancelled: status === "cancelled",
      status,
      at: new Date().toISOString(),
    };
  }
}
