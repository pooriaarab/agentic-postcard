import {
  PostGridPostcardAdapter as FetchPostGridAdapter,
  POSTGRID_BASE_URL,
  postgridSize,
  type PostGridAdapterOptions,
} from "../adapters.js";

// PostGrid adapter for the SDK, CLI, and MCP faces. The fetch-only
// base lives in ../adapters.js; this subclass adds the POSTGRID_API_KEY
// / POSTGRID_PRINT_MAIL_API_KEY env fallback so the Node entry points
// keep working unchanged.

export { POSTGRID_BASE_URL, postgridSize };
export type { PostGridAdapterOptions };

export class PostGridPostcardAdapter extends FetchPostGridAdapter {
  constructor(options: PostGridAdapterOptions = {}) {
    super({
      ...options,
      apiKey:
        options.apiKey ??
        process.env.POSTGRID_API_KEY ??
        process.env.POSTGRID_PRINT_MAIL_API_KEY,
    });
  }
}
