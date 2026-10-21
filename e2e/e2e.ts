/**
 * Dry-run E2E for agentic-postcard/adapters against local fakes of the
 * PostGrid print-mail API and the Lob API. Nothing real is sent: both
 * fakes run on 127.0.0.1 inside this Bun process and each adapter's
 * baseUrl points at its fake.
 *
 * The PostGrid fake answers POST /print-mail/v1/postcards with the
 * fields the receipt converts: `id`, `status`, `url`, `price` (decimal
 * major units) and `expectedDeliveryDate`. The Lob fake answers
 * POST /v1/postcards with `id`, `cost`, and `expected_delivery_date`.
 * A city of "Springfield" with a 66 in the street fails the injected
 * address check — the same convention the directory CRM fake uses.
 *
 * Run: bun e2e/e2e.ts
 */
import {
  LobPostcardAdapter,
  PostGridPostcardAdapter,
  sendVerifiedPostcard,
  VendorError,
} from "../src/adapters.js";
import type {
  PostcardAddress,
  RecipientCheck,
} from "../src/adapters.js";

declare const Bun: {
  serve(opts: {
    port: number;
    hostname: string;
    fetch(req: Request): Response | Promise<Response>;
  }): { port: number; stop(): void };
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status });

const postgridLog: unknown[] = [];
const pg = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("x-api-key") !== "test_postgrid_key") {
      return json({ error: "unauthorized" }, 401);
    }
    if (url.pathname === "/print-mail/v1/postcards" && req.method === "POST") {
      const body = (await req.json()) as Record<string, unknown>;
      postgridLog.push(body);
      if (body.size !== "6x4") return json({ error: "want size 6x4" }, 422);
      return json({
        id: `postcard_${postgridLog.length}`,
        object: "postcard",
        status: "ready",
        live: false,
        size: "6x4",
        url: "https://pg.example/preview/postcard_1.pdf",
        price: "0.85",
        expectedDeliveryDate: "2026-10-28",
      });
    }
    return json({ error: "not found" }, 404);
  },
});

const lob = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("authorization") !== `Basic ${btoa("test_lob_key:")}`) {
      return json({ error: "unauthorized" }, 401);
    }
    if (url.pathname === "/v1/postcards" && req.method === "POST") {
      return json({
        id: "psc_1",
        url: "https://lob.example/preview/psc_1.pdf",
        cost: "0.50",
        expected_delivery_date: "2026-10-27",
      });
    }
    return json({ error: "not found" }, 404);
  },
});

// The injected verifier stands in for agentic-address in the CRM:
// PostcardAddress in, a deliverability verdict out.
const verify = (to: PostcardAddress): Promise<RecipientCheck> =>
  Promise.resolve(
    to.city === "Springfield" && to.line1.includes("66 ")
      ? { deliverability: "undeliverable", score: 15 }
      : { deliverability: "deliverable", score: 95 },
  );

let passed = 0;
const check = (name: string, cond: boolean) => {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed += 1;
  console.log(`ok ${name}`);
};

const to: PostcardAddress = {
  name: "Ada",
  line1: "1 Main St",
  city: "Boston",
  state: "MA",
  zip: "02108",
};
const art = { front: "<html>front</html>", back: "<html>back</html>" };

const pgAdapter = new PostGridPostcardAdapter({
  apiKey: "test_postgrid_key",
  baseUrl: `http://127.0.0.1:${pg.port}`,
});
const sent = await sendVerifiedPostcard({ to, ...art }, {
  adapter: pgAdapter,
  verify,
});
check("postgrid vendor id", sent.receipt.vendorId === "postcard_1");
check("postgrid cost cents", sent.receipt.costCents === 85);
check("postgrid currency", sent.receipt.currency === "USD");
check(
  "postgrid expected delivery",
  sent.receipt.expectedDelivery === "2026-10-28",
);
check("postgrid size mapped", (postgridLog[0] as { size: string }).size === "6x4");
check("recipient passed", sent.recipient.deliverability === "deliverable");

const lobAdapter = new LobPostcardAdapter({
  apiKey: "test_lob_key",
  baseUrl: `http://127.0.0.1:${lob.port}/v1`,
});
const lobSent = await sendVerifiedPostcard({ to, ...art }, {
  adapter: lobAdapter,
  verify,
});
check("lob vendor id", lobSent.receipt.vendorId === "psc_1");
check("lob cost cents", lobSent.receipt.costCents === 50);
check(
  "lob expected delivery",
  lobSent.receipt.expectedDelivery === "2026-10-27",
);

const before = postgridLog.length;
let refused = false;
try {
  await sendVerifiedPostcard(
    {
      to: { line1: "66 Elm St", city: "Springfield", state: "IL", zip: "62701" },
      ...art,
    },
    { adapter: pgAdapter, verify },
  );
} catch (error) {
  refused = error instanceof VendorError;
}
check("undeliverable address refused", refused);
check("refused send never reached postgrid", postgridLog.length === before);

let threw = false;
try {
  new PostGridPostcardAdapter({});
} catch (error) {
  threw = error instanceof VendorError;
}
check("missing key is refused", threw);

pg.stop();
lob.stop();
console.log(`PASS ${passed} checks`);
