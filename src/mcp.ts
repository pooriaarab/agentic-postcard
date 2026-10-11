import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createLogger,
  getCostReport,
  GuardError,
  VendorError,
  type Guards,
  type Logger,
} from "./core.js";
import {
  buildCardHtml,
  cancelPostcard,
  sendPostcard,
  trackPostcard,
  type AdapterKeys,
  type PostcardSend,
} from "./postcard.js";
import { DEFAULT_BRAND } from "./index.js";

export interface McpDeps {
  guards?: Guards;
  logger?: Logger;
  keys?: AdapterKeys;
}

const addressShape = {
  name: z.string().optional().describe("Recipient full name."),
  company: z.string().optional().describe("Recipient company."),
  line1: z.string().describe("Street address, first line."),
  line2: z.string().optional().describe("Street address, second line."),
  city: z.string().describe("City."),
  state: z.string().describe("State or province."),
  zip: z.string().describe("Postal or ZIP code."),
  country: z.string().optional().describe("Country code, defaults to US."),
};

const addressSchema = z.object(addressShape);

function errorResult(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

function okResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function createMcpServer(deps: McpDeps = {}): McpServer {
  const guards = deps.guards;
  const keys = deps.keys;
  const logger = deps.logger ?? createLogger({ quiet: true });
  const server = new McpServer({
    name: DEFAULT_BRAND.command,
    version: DEFAULT_BRAND.version,
  });

  server.registerTool(
    "send_postcard",
    {
      description:
        "Preview or mail a postcard. Dry run by default; pass dryRun false plus a vendor key to mail.",
      inputSchema: {
        to: addressSchema.describe("Recipient address."),
        from: addressSchema.optional().describe("Sender address."),
        front: z.string().optional().describe("Front HTML. Needs back too."),
        back: z.string().optional().describe("Back HTML. Needs front too."),
        message: z.string().optional().describe("Plain message; builds both sides."),
        size: z.enum(["4x6", "6x9"]).optional().describe("Card size, default 4x6."),
        vendor: z.string().optional().describe("lob, postgrid, or dry-run."),
        description: z.string().optional().describe("Label for the dashboard."),
        dryRun: z.boolean().optional().describe("Preview only. Default true."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, from, front, back, message, size, vendor, description, dryRun }) => {
      try {
        let art: { front: string; back: string };
        if (message !== undefined) {
          art = buildCardHtml(message);
        } else if (front !== undefined && back !== undefined) {
          art = { front, back };
        } else {
          return errorResult(
            new Error("send_postcard needs message or both front and back"),
          );
        }
        const request: PostcardSend = {
          to,
          from: from ?? undefined,
          front: art.front,
          back: art.back,
          size: size ?? undefined,
          description: description ?? undefined,
        };
        return okResult(
          await sendPostcard(request, {
            vendor,
            live: dryRun === false,
            guards,
            logger,
            keys,
          }),
        );
      } catch (error) {
        if (
          error instanceof GuardError ||
          error instanceof VendorError ||
          error instanceof Error
        ) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "track_postcard",
    {
      description: "Read live delivery status for a mailed postcard.",
      inputSchema: {
        vendor: z.string().describe("lob or postgrid."),
        id: z.string().describe("Card id from the send receipt."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ vendor, id }) => {
      try {
        return okResult(await trackPostcard(vendor, id, keys));
      } catch (error) {
        if (error instanceof GuardError || error instanceof VendorError || error instanceof Error) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "cancel_postcard",
    {
      description: "Cancel a postcard before it prints.",
      inputSchema: {
        vendor: z.string().describe("lob or postgrid."),
        id: z.string().describe("Card id from the send receipt."),
        note: z.string().optional().describe("Cancel note, postgrid only."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ vendor, id, note }) => {
      try {
        return okResult(await cancelPostcard(vendor, id, note, keys));
      } catch (error) {
        if (error instanceof GuardError || error instanceof VendorError || error instanceof Error) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "get_cost_report",
    {
      description: "Read the cost report for this session.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => okResult(getCostReport()),
  );

  return server;
}

export async function startMcp(deps: McpDeps = {}): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
