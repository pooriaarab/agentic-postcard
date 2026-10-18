import { describe, expect, test } from "vitest";
import { createGuards, getCostReport, GuardError, resetCosts, VendorError } from "./core.js";
import {
  assertSendRequest,
  buildCardHtml,
  cancelPostcard,
  selectAdapter,
  sendPostcard,
  trackPostcard,
  verifyRecipient,
  type PostcardSend,
} from "./postcard.js";
import { DryRunPostcardAdapter } from "./vendors/stub.js";
import { LobPostcardAdapter } from "./vendors/lob.js";
import { PostGridPostcardAdapter } from "./vendors/postgrid.js";

const SEND: PostcardSend = {
  to: { name: "Ava Lee", line1: "90 Canal St", city: "Boston", state: "MA", zip: "02114" },
  front: "<html>front</html>",
  back: "<html>back</html>",
};

describe("assertSendRequest", () => {
  test("accepts a full request", () => {
    expect(() => assertSendRequest({ ...SEND, size: "6x9" })).not.toThrow();
  });

  test("rejects a short address", () => {
    expect(() =>
      assertSendRequest({ ...SEND, to: { ...SEND.to, zip: " " } }),
    ).toThrow(/"zip"/);
  });

  test("rejects empty art and bad size", () => {
    expect(() => assertSendRequest({ ...SEND, back: "" })).toThrow(/back/);
    expect(() =>
      assertSendRequest({ ...SEND, size: "5x7" as unknown as "4x6" }),
    ).toThrow(/size/);
  });
});

describe("buildCardHtml", () => {
  test("escapes markup in the message", () => {
    const { front, back } = buildCardHtml("Hi <b>Ava</b>\nSee you soon");
    expect(front).toContain("Hi &lt;b&gt;Ava&lt;/b&gt;<br>See you soon");
    expect(back).toContain("&lt;b&gt;");
    expect(front).not.toContain("<b>");
  });

  test("rejects an empty message", () => {
    expect(() => buildCardHtml("  ")).toThrow(/non-empty/);
  });
});

describe("selectAdapter", () => {
  test("explicit vendors need keys", () => {
    expect(selectAdapter("lob", { lobKey: "k" })).toBeInstanceOf(LobPostcardAdapter);
    expect(selectAdapter("postgrid", { postgridKey: "k" })).toBeInstanceOf(
      PostGridPostcardAdapter,
    );
    expect(() => selectAdapter("lob", {})).toThrow(VendorError);
    expect(() => selectAdapter("postgrid", {})).toThrow(VendorError);
  });

  test("default prefers postgrid, then lob, then the stub", () => {
    expect(selectAdapter(undefined, {})).toBeInstanceOf(DryRunPostcardAdapter);
    expect(selectAdapter(undefined, { lobKey: "k" })).toBeInstanceOf(LobPostcardAdapter);
    expect(
      selectAdapter(undefined, { lobKey: "k", postgridKey: "k2" }),
    ).toBeInstanceOf(PostGridPostcardAdapter);
  });

  test("unknown vendor throws", () => {
    expect(() => selectAdapter("stannp", {})).toThrow(/unknown vendor/);
  });
});

describe("sendPostcard", () => {
  test("dry run previews without network or cost", async () => {
    resetCosts();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network must stay idle in a dry run");
    }) as unknown as typeof fetch;
    try {
      const result = await sendPostcard(SEND, { keys: {} });
      expect(result.dryRun).toBe(true);
      expect(result.receipt.adapter).toBe("dry-run");
      expect(result.receipt.trackingUrl).toContain("dry-run://");
      expect(getCostReport().dispatches).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("dry run names the vendor it would use", async () => {
    const result = await sendPostcard(SEND, { vendor: "lob", keys: { lobKey: "k" } });
    expect(result.dryRun).toBe(true);
    expect(result.receipt.adapter).toBe("lob");
  });

  test("live send without a key throws and records no cost", async () => {
    resetCosts();
    await expect(sendPostcard(SEND, { live: true, keys: {} })).rejects.toThrow(
      /vendor key/,
    );
    expect(getCostReport().dispatches).toBe(0);
  });

  test("guards block a send before any vendor call", async () => {
    const guards = createGuards({ blocklist: ["blocked-word"] });
    await expect(
      sendPostcard(
        { ...SEND, back: "this has blocked-word in it" },
        { guards, keys: {} },
      ),
    ).rejects.toThrow(GuardError);
  });

  test("a live send records one cost entry", async () => {
    resetCosts();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ id: "psc_live_1", url: "https://proof.test/1.pdf" }),
        { status: 200 },
      )) as unknown as typeof fetch;
    try {
      const result = await sendPostcard(SEND, {
        live: true,
        vendor: "lob",
        keys: { lobKey: "k" },
      });
      expect(result.dryRun).toBe(false);
      expect(result.receipt).toMatchObject({
        adapter: "lob",
        id: "psc_live_1",
        trackingUrl: "https://proof.test/1.pdf",
      });
      expect(getCostReport()).toMatchObject({ dispatches: 1, units: 1 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("verifyRecipient", () => {
  test("dry check maps the address without network", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network must stay idle in a dry check");
    }) as unknown as typeof fetch;
    try {
      const check = await verifyRecipient(SEND.to);
      expect(check).toEqual({ deliverability: "deliverable", score: 90 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("dry run carries the recipient band", async () => {
    resetCosts();
    const result = await sendPostcard(SEND, { keys: {} });
    expect(result.dryRun).toBe(true);
    expect(result.recipient).toEqual({
      deliverability: "deliverable",
      score: 90,
    });
    expect(getCostReport().dispatches).toBe(0);
  });

  test("live send with a deliverable lob check mails the card", async () => {
    resetCosts();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("us_verifications")) {
        return new Response(
          JSON.stringify({
            id: "lverify_1",
            deliverability: "deliverable",
            components: {
              primary_number: "90",
              street_name: "Canal",
              street_suffix: "St",
              city: "Boston",
              state: "MA",
              zip_code: "02114",
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ id: "psc_live_2", url: "https://proof.test/2.pdf" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    try {
      const result = await sendPostcard(SEND, {
        live: true,
        vendor: "lob",
        verifyVendor: "lob",
        keys: { lobKey: "k" },
      });
      expect(result.dryRun).toBe(false);
      expect(result.recipient.deliverability).toBe("deliverable");
      expect(result.receipt.id).toBe("psc_live_2");
      expect(getCostReport()).toMatchObject({ dispatches: 2, units: 2 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("live send to an undeliverable address is refused", async () => {
    resetCosts();
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (url: string) => {
      calls += 1;
      if (String(url).includes("us_verifications")) {
        return new Response(
          JSON.stringify({ id: "lverify_2", deliverability: "undeliverable" }),
          { status: 200 },
        );
      }
      throw new Error("refused card must not reach the vendor");
    }) as unknown as typeof fetch;
    try {
      await expect(
        sendPostcard(SEND, {
          live: true,
          vendor: "lob",
          verifyVendor: "lob",
          keys: { lobKey: "k" },
        }),
      ).rejects.toThrow(/undeliverable/);
      expect(calls).toBe(1);
      expect(getCostReport()).toMatchObject({ dispatches: 1, units: 1 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("track and cancel", () => {
  test("empty ids throw before vendor lookup", async () => {
    await expect(trackPostcard("lob", " ", {})).rejects.toThrow(/card id/);
    await expect(cancelPostcard("lob", "", undefined, {})).rejects.toThrow(/card id/);
  });
});
