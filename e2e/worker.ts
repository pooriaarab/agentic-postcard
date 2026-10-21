import {
  addressInputOf,
  PostGridPostcardAdapter,
  sendVerifiedPostcard,
  type RecipientCheck,
} from "../src/adapters.js";

// Bundling proof for the /adapters entry point: this worker imports
// only the fetch-only subpath surface, so `wrangler deploy --dry-run`
// shows it packs for Cloudflare Workers. Keys arrive as env arguments
// to the caller, never read inside the package.

export interface WorkerEnv {
  POSTGRID_API_KEY?: string;
  POSTGRID_API_BASE?: string;
  ADDRESS_API_BASE?: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/send") {
      if (!env.POSTGRID_API_KEY) {
        return json({ error: "POSTGRID_API_KEY not set" }, 503);
      }
      const body = (await request.json().catch(() => null)) as {
        to?: {
          line1: string;
          line2?: string;
          city: string;
          state: string;
          zip: string;
          country?: string;
        };
        front?: string;
        back?: string;
      } | null;
      if (!body?.to || !body.front || !body.back) {
        return json({ error: "need to, front, back" }, 400);
      }
      const adapter = new PostGridPostcardAdapter({
        apiKey: env.POSTGRID_API_KEY,
        baseUrl: env.POSTGRID_API_BASE,
      });
      // In the CRM this verifier is agentic-address' verifyAddress; a
      // dry local check keeps this proof worker offline.
      const verify = (): Promise<RecipientCheck> =>
        Promise.resolve({ deliverability: "deliverable", score: 90 });
      const sent = await sendVerifiedPostcard(
        { to: body.to, front: body.front, back: body.back },
        { adapter, verify },
      );
      return json({ sent, checked: addressInputOf(body.to) });
    }
    return json({ error: "not found" }, 404);
  },
};
