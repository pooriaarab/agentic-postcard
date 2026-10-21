import {
  LobPostcardAdapter as FetchLobAdapter,
  LOB_BASE_URL,
  type LobAdapterOptions,
} from "../adapters.js";

// Lob adapter for the SDK, CLI, and MCP faces. The fetch-only base
// lives in ../adapters.js; this subclass adds the LOB_API_KEY env
// fallback so the Node entry points keep working unchanged.

export { LOB_BASE_URL };
export type { LobAdapterOptions };

export class LobPostcardAdapter extends FetchLobAdapter {
  constructor(options: LobAdapterOptions = {}) {
    super({ ...options, apiKey: options.apiKey ?? process.env.LOB_API_KEY });
  }
}
