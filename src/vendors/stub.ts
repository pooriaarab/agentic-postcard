import { randomUUID } from "node:crypto";
import {
  assertSendRequest,
  type CancelResult,
  type PostcardReceipt,
  type PostcardSend,
  type PostcardVendorAdapter,
  type TrackingInfo,
} from "../postcard.js";

// Dry-run stub. Validates like a real vendor but moves no card
// and opens no network connection. The default when no vendor
// key is set, so a bare install can never spend money.

export class DryRunPostcardAdapter implements PostcardVendorAdapter {
  readonly name = "dry-run";

  async sendCard(request: PostcardSend): Promise<PostcardReceipt> {
    assertSendRequest(request);
    const id = `dry_${randomUUID()}`;
    return {
      adapter: this.name,
      id,
      status: "dry-run",
      trackingUrl: `dry-run://agentic-postcard/${id}`,
      at: new Date().toISOString(),
    };
  }

  async trackCard(id: string): Promise<TrackingInfo> {
    return {
      adapter: this.name,
      id,
      status: "dry-run",
      events: [{ name: "previewed" }],
      at: new Date().toISOString(),
    };
  }

  async cancelCard(id: string): Promise<CancelResult> {
    return {
      adapter: this.name,
      id,
      cancelled: true,
      status: "dry-run",
      at: new Date().toISOString(),
    };
  }
}
