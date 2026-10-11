# Agentic postcard

Send postcards through print vendors from CLI, code, or MCP.

The pack mails cards through Lob or PostGrid. Each send returns
one tracked page URL. Dry run is the default, so a bare install
mails nothing and spends nothing.

## Install

```sh
npm install agentic-postcard
```

The pack needs Node 18 or later.

## Quick start

Preview a card. This call mails nothing.

```sh
npx agentic-postcard send --to '{"name":"Ava Lee","line1":"90 Canal St","city":"Boston","state":"MA","zip":"02114"}' --message "Thank you for visiting."
```

The pack prints a receipt with a tracked page URL.

## Three uses

- Mail a thank-you card after a visit.
- Mail an appointment reminder before a booking.
- Mail an event invite to a guest list.

Each use follows the same loop: preview, then mail, then track.

## Live sends

Set one vendor key first.

```sh
export LOB_API_KEY="test_key_here"
export POSTGRID_API_KEY="test_key_here"
```

Set only the key you use. The pack picks PostGrid when both
keys exist. Pick one with `--vendor lob` or `--vendor postgrid`.

Mail a card with `--live`.

```sh
npx agentic-postcard send --to @to.json --message "We miss you." --live
```

`@to.json` reads the address from a file. `--front` and `--back`
take full HTML or `@file` paths when you own the artwork.

## Track and cancel

```sh
npx agentic-postcard track --vendor lob --id psc_abc123
npx agentic-postcard cancel --vendor postgrid --id postcard_abc123
```

Track prints live delivery status. Cancel stops a card that
has not printed yet.

## Use the library

```js
import { sendPostcard } from "agentic-postcard";

const preview = await sendPostcard({
  to: { name: "Ava Lee", line1: "90 Canal St", city: "Boston", state: "MA", zip: "02114" },
  front: "<html>front</html>",
  back: "<html>back</html>",
});
console.log(preview.receipt.trackingUrl);
```

Pass `{ live: true, vendor: "lob" }` to mail for real. The call
throws `VendorError` when the vendor fails or no key exists.

## Use the MCP server

Add the pack to your MCP client.

```json
{
  "mcpServers": {
    "agentic-postcard": {
      "command": "npx",
      "args": ["-y", "agentic-postcard", "mcp"]
    }
  }
}
```

Tools: `send_postcard`, `track_postcard`, `cancel_postcard`,
`get_cost_report`. Sends preview by default. Pass `dryRun: false`
to mail, with a vendor key in the environment.

## Costs

```sh
npx agentic-postcard costs
```

The report counts live sends in this session. Dry runs add
no entries. Vendor charges apply per card mailed.

## Development

```sh
npm install
npm run build
npm run typecheck
npm test
```

## License

MIT
