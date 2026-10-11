import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createMcpServer } from "./mcp.js";

const TO = {
  name: "Ava Lee",
  line1: "90 Canal St",
  city: "Boston",
  state: "MA",
  zip: "02114",
};

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0].text;
}

async function linkedClient(deps: Parameters<typeof createMcpServer>[0] = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
  await server.connect(serverTransport);
  const client = new Client({ name: "probe", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

describe("mcp server", () => {
  test("serves four tools over a client link", async () => {
    const { client, server } = await linkedClient({ keys: {} });
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        "cancel_postcard",
        "get_cost_report",
        "send_postcard",
        "track_postcard",
      ]);

      const preview = await client.callTool({
        name: "send_postcard",
        arguments: { to: TO, message: "hello" },
      });
      const parsed = JSON.parse(textOf(preview)) as {
        dryRun: boolean;
        receipt: { trackingUrl: string };
      };
      expect(parsed.dryRun).toBe(true);
      expect(parsed.receipt.trackingUrl).toContain("dry-run://");

      const report = await client.callTool({ name: "get_cost_report", arguments: {} });
      expect(JSON.parse(textOf(report))).toHaveProperty("dispatches");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("send without art returns a tool error, not a crash", async () => {
    const { client, server } = await linkedClient({ keys: {} });
    try {
      const result = await client.callTool({
        name: "send_postcard",
        arguments: { to: TO },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("front and back");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("a blocked send returns a tool error, not a crash", async () => {
    const { createGuards } = await import("./core.js");
    const { client, server } = await linkedClient({
      guards: createGuards({ blocklist: ["nope"] }),
      keys: {},
    });
    try {
      const result = await client.callTool({
        name: "send_postcard",
        arguments: { to: TO, message: "nope" },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("blocklisted");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("a live send without a key returns a tool error", async () => {
    const { client, server } = await linkedClient({
      keys: { lobKey: "", postgridKey: "" },
    });
    try {
      const result = await client.callTool({
        name: "send_postcard",
        arguments: { to: TO, message: "hello", dryRun: false },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("vendor key");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
