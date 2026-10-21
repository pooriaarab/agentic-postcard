import { describe, expect, test } from "vitest";
import { AdapterError } from "./adapters.js";
import { LobPostcardAdapter } from "./vendors/lob.js";
import { postgridSize, PostGridPostcardAdapter } from "./vendors/postgrid.js";
import { DryRunPostcardAdapter } from "./vendors/stub.js";
import type { PostcardSend } from "./postcard.js";

const SEND: PostcardSend = {
  to: { name: "Ava Lee", line1: "90 Canal St", city: "Boston", state: "MA", zip: "02114" },
  from: { name: "Jo Park", line1: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
  front: "<html>front</html>",
  back: "<html>back</html>",
  size: "4x6",
  description: "test card",
};

interface Seen {
  url: string;
  init: RequestInit;
}

function mockFetch(responder: (seen: Seen) => Response): typeof fetch {
  const fn = async (url: unknown, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(url), init: init ?? {} });
    return responder({ url: String(url), init: init ?? {} });
  };
  const seen: Seen[] = [];
  (fn as unknown as { seen: Seen[] }).seen = seen;
  return fn as unknown as typeof fetch;
}

function seenOf(fn: typeof fetch): Seen[] {
  return (fn as unknown as { seen: Seen[] }).seen;
}

function jsonBody(seen: Seen): Record<string, unknown> {
  return JSON.parse(String(seen.init.body)) as Record<string, unknown>;
}

function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

describe("lob adapter", () => {
  test("posts the documented shape with basic auth", async () => {
    const fetchFn = mockFetch(() =>
      ok({ id: "psc_abc123", url: "https://proof.test/psc_abc123.pdf" }),
    );
    const adapter = new LobPostcardAdapter({ apiKey: "key-1", fetchFn });
    const receipt = await adapter.sendCard(SEND);
    expect(receipt).toMatchObject({
      adapter: "lob",
      id: "psc_abc123",
      trackingUrl: "https://proof.test/psc_abc123.pdf",
    });
    const [call] = seenOf(fetchFn);
    expect(call.url).toBe("https://api.lob.com/v1/postcards");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("key-1:").toString("base64")}`);
    expect(jsonBody(call)).toMatchObject({
      size: "4x6",
      front: "<html>front</html>",
      back: "<html>back</html>",
      use_type: "operational",
      to: {
        name: "Ava Lee",
        address_line1: "90 Canal St",
        address_city: "Boston",
        address_state: "MA",
        address_zip: "02114",
        address_country: "US",
      },
    });
  });

  test("falls back to the retrieve URL when no proof URL returns", async () => {
    const fetchFn = mockFetch(() => ok({ id: "psc_no_url" }));
    const adapter = new LobPostcardAdapter({ apiKey: "key-1", fetchFn });
    const receipt = await adapter.sendCard(SEND);
    expect(receipt.trackingUrl).toBe("https://api.lob.com/v1/postcards/psc_no_url");
  });

  test("a 422 throws AdapterError with status", async () => {
    const fetchFn = mockFetch(
      () => new Response(JSON.stringify({ error: "bad address" }), { status: 422 }),
    );
    const adapter = new LobPostcardAdapter({ apiKey: "key-1", fetchFn });
    const error = await adapter.sendCard(SEND).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).status).toBe(422);
    expect((error as Error).message).toContain("bad address");
  });

  test("a network failure throws AdapterError", async () => {
    const fetchFn = (async () => {
      throw new Error("socket hangup");
    }) as unknown as typeof fetch;
    const adapter = new LobPostcardAdapter({ apiKey: "key-1", fetchFn });
    await expect(adapter.sendCard(SEND)).rejects.toThrow(/lob request failed/);
  });

  test("missing key throws at construction", () => {
    expect(() => new LobPostcardAdapter({ apiKey: "" })).toThrow(AdapterError);
  });

  test("track maps the last event to status", async () => {
    const fetchFn = mockFetch(() =>
      ok({
        id: "psc_abc123",
        expected_delivery_date: "2026-10-20",
        tracking_events: [
          { name: "mailed", time: "2026-10-11T10:00:00Z" },
          { name: "in_transit", time: "2026-10-12T10:00:00Z", location: "Boston" },
        ],
      }),
    );
    const adapter = new LobPostcardAdapter({ apiKey: "key-1", fetchFn });
    const info = await adapter.trackCard("psc_abc123");
    expect(info).toMatchObject({
      adapter: "lob",
      id: "psc_abc123",
      status: "in_transit",
      expectedDelivery: "2026-10-20",
    });
    expect(info.events).toHaveLength(2);
    expect(seenOf(fetchFn)[0].url).toBe("https://api.lob.com/v1/postcards/psc_abc123");
  });

  test("cancel reports the deleted flag", async () => {
    const fetchFn = mockFetch(() => ok({ id: "psc_abc123", deleted: true }));
    const adapter = new LobPostcardAdapter({ apiKey: "key-1", fetchFn });
    const result = await adapter.cancelCard("psc_abc123");
    expect(result).toMatchObject({ cancelled: true, status: "cancelled" });
    expect(seenOf(fetchFn)[0].init.method).toBe("DELETE");
  });
});

describe("postgrid adapter", () => {
  test("sizes map to postgrid names", () => {
    expect(postgridSize("4x6")).toBe("6x4");
    expect(postgridSize("6x9")).toBe("9x6");
    expect(() => postgridSize("5x7")).toThrow(AdapterError);
  });

  test("posts the documented shape with x-api-key", async () => {
    const fetchFn = mockFetch(() =>
      ok({ id: "postcard_abc123", status: "ready", url: "https://proof.test/pg.pdf" }),
    );
    const adapter = new PostGridPostcardAdapter({ apiKey: "key-2", fetchFn });
    const receipt = await adapter.sendCard(SEND);
    expect(receipt).toMatchObject({
      adapter: "postgrid",
      id: "postcard_abc123",
      status: "ready",
      trackingUrl: "https://proof.test/pg.pdf",
    });
    const [call] = seenOf(fetchFn);
    expect(call.url).toBe("https://api.postgrid.com/print-mail/v1/postcards");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("key-2");
    expect(jsonBody(call)).toMatchObject({
      frontHTML: "<html>front</html>",
      backHTML: "<html>back</html>",
      size: "6x4",
      to: {
        firstName: "Ava Lee",
        addressLine1: "90 Canal St",
        city: "Boston",
        provinceOrState: "MA",
        postalOrZip: "02114",
        countryCode: "US",
      },
    });
  });

  test("a 401 throws AdapterError with status", async () => {
    const fetchFn = mockFetch(() => new Response("bad key", { status: 401 }));
    const adapter = new PostGridPostcardAdapter({ apiKey: "nope", fetchFn });
    const error = await adapter.sendCard(SEND).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).status).toBe(401);
  });

  test("a network failure throws AdapterError", async () => {
    const fetchFn = (async () => {
      throw new Error("dns fail");
    }) as unknown as typeof fetch;
    const adapter = new PostGridPostcardAdapter({ apiKey: "key-2", fetchFn });
    await expect(adapter.sendCard(SEND)).rejects.toThrow(/postgrid request failed/);
  });

  test("track maps status and tracking number", async () => {
    const fetchFn = mockFetch(() =>
      ok({ id: "postcard_abc123", status: "printing", imbStatus: "entered_mail_stream" }),
    );
    const adapter = new PostGridPostcardAdapter({ apiKey: "key-2", fetchFn });
    const info = await adapter.trackCard("postcard_abc123");
    expect(info).toMatchObject({ adapter: "postgrid", status: "printing" });
    expect(info.events).toEqual([{ name: "entered_mail_stream" }]);
  });

  test("cancel without note deletes, with note posts cancellation", async () => {
    const fetchFn = mockFetch(() => ok({ id: "postcard_1", status: "cancelled" }));
    const adapter = new PostGridPostcardAdapter({ apiKey: "key-2", fetchFn });
    const plain = await adapter.cancelCard("postcard_1");
    expect(plain).toMatchObject({ cancelled: true });
    expect(seenOf(fetchFn)[0].init.method).toBe("DELETE");
    const noted = await adapter.cancelCard("postcard_1", "duplicate");
    expect(noted).toMatchObject({ cancelled: true });
    const second = seenOf(fetchFn)[1];
    expect(second.url).toBe(
      "https://api.postgrid.com/print-mail/v1/postcards/postcard_1/cancellation",
    );
    expect(jsonBody(second)).toEqual({ note: "duplicate" });
  });
});

describe("dry-run stub", () => {
  test("returns a dry receipt and validates input", async () => {
    const stub = new DryRunPostcardAdapter();
    const receipt = await stub.sendCard(SEND);
    expect(receipt.adapter).toBe("dry-run");
    expect(receipt.id.startsWith("dry_")).toBe(true);
    expect(receipt.trackingUrl).toContain(receipt.id);
    await expect(stub.sendCard({ ...SEND, front: " " })).rejects.toThrow(/front/);
    const info = await stub.trackCard(receipt.id);
    expect(info.status).toBe("dry-run");
    const cancelled = await stub.cancelCard(receipt.id);
    expect(cancelled.cancelled).toBe(true);
  });
});
