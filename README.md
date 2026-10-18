# agentic-postcard

[![npm version](https://img.shields.io/npm/v/agentic-postcard)](https://www.npmjs.com/package/agentic-postcard)
[![Monthly downloads](https://img.shields.io/npm/dm/agentic-postcard)](https://www.npmjs.com/package/agentic-postcard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/license/mit)

[Package](https://www.npmjs.com/package/agentic-postcard) · [Setup](#send-your-first-postcard-preview) · [API and commands](#runtime-surfaces) · [Comparisons](#compare) · [llms.txt](https://github.com/pooriaarab/agentic-postcard/blob/main/llms.txt)

agentic-postcard is an open-source direct-mail toolkit for developers who send postcards through Lob and PostGrid.
A TypeScript software development kit (SDK), command-line interface (CLI), and Model Context Protocol (MCP) server share one send flow.
Sends default to local previews.

## Install

```sh
npm install agentic-postcard
```

Use Node.js 18 or later. TypeScript declarations are included; the package has three direct runtime dependencies.

## Send your first postcard preview

Run this command. No environment variables or credentials are required, and no postcard is mailed.

```sh
npx agentic-postcard send --vendor dry-run --to '{"name":"Ava Lee","line1":"90 Canal St","city":"Boston","state":"MA","zip":"02114"}' --message "Thank you for visiting."
```

Expect JSON with `dryRun: true`, a `dry_` ID, and a `dry-run://agentic-postcard/` URL.
That URL is a preview marker, not a web page.

Save this SDK example as `preview.mjs`, then run `node preview.mjs`:

```js
import { buildCardHtml, sendPostcard } from 'agentic-postcard';

const result = await sendPostcard({
  to: { name: 'Ava Lee', line1: '90 Canal St', city: 'Boston', state: 'MA', zip: '02114' },
  ...buildCardHtml('Thank you for visiting.'),
}, { vendor: 'dry-run' });
console.log(result.dryRun, result.receipt.trackingUrl);
```

Expect `true` and the preview marker URL.

## How it works

```text
SDK / CLI / MCP -> address + HTML validation -> guards -> local preview
                                                     -> Lob / PostGrid -> receipt
track / cancel --------------------------------------> vendor API
```

## Why it exists

Lob and PostGrid have different address fields, size names, and authentication methods.
agentic-postcard maps a shared postcard request to both APIs and adds local previews.
It uses your vendor accounts for printing and delivery.

## Compare

Scope checked on 2026-10-14 against the [Lob API](https://docs.lob.com/) and [PostGrid Print and Mail API](https://docs.postgrid.com/).

| Aspect | agentic-postcard | Lob | PostGrid |
| --- | --- | --- | --- |
| Scope | Local postcard API wrapper | Print and mail API | Print and mail API |
| Configuration | Shared address and HTML shape | Lob request fields | PostGrid request fields |
| Execution | Code you run | Vendor service | Vendor service |

## Coverage

| Adapter | Send | Track | Cancel | Sizes |
| --- | --- | --- | --- | --- |
| Lob | ✓ | ✓ | ✓ | `4x6`, `6x9` |
| PostGrid | ✓ | ✓ | ✓ | `4x6` maps to `6x4`; `6x9` maps to `9x6` |
| Dry run | Local stub | Local stub | Local stub | Validation only |

There are two live vendor adapters and one local dry-run stub.
Tests use mocked vendor responses. This rewrite includes zero credential-checked integrations.
Check returned status and `cancelled`; a successful API response does not guarantee cancellation or postal delivery.

## Common use cases

1. Service teams: preview appointment reminders before sending postcards through Lob.
2. Store developers: generate thank-you artwork from plain messages for PostGrid.
3. Event operators: prepare HTML invitations using the Node.js SDK and a configured mail vendor.
4. Agent developers: expose postcard previews and status lookups through an MCP client.

## Features

- Shared address validation requires `line1`, `city`, `state`, and `zip`; country defaults to `US`.
- `buildCardHtml` escapes a plain message and creates front and back HTML.
- Sends support two sizes, optional sender addresses, metadata, descriptions, and send dates through the SDK.
- Vendor adapters expose status reads and cancellation requests.
- Core guards accept caps, blocklists, and quiet hours through SDK options.
- Cost reports count live send units within the current process.

## Runtime surfaces

SDK entry points include `sendPostcard`, `trackPostcard`, `cancelPostcard`, `buildCardHtml`, and the three adapter classes.
Core guard, router, logging, text-summary, and cost helpers are also re-exported.
CLI commands are `send`, `track`, `cancel`, `costs`, and `mcp`.
The default help route accepts `--help` or `-h`; version output accepts `--version` or `-V`.
`send` accepts addresses and artwork inline or through `@file` paths.
Use `--message` or both `--front` and `--back`.

Start stdio MCP with `npx agentic-postcard mcp` or `npx --package agentic-postcard agentic-postcard-mcp`.
Its four tools are `send_postcard`, `track_postcard`, `cancel_postcard`, and `get_cost_report`.
`send_postcard` needs `dryRun: false` for live mail.
The source Worker exposes `GET /health` and `POST /summarize`; it does not send postcards.

## Delivery and behavior limits

Preview before each live send. Mail only with explicit user authorization.
Live sends need `live: true` or `--live` and vendor credentials.
An explicit vendor selection requires its key even for previews; `dry-run` needs none.
Without explicit selection, PostGrid takes priority over Lob when both keys exist.

Every send verifies the recipient through agentic-address and returns
its deliverability band and score as `recipient`. The default `dry`
check runs offline and free. Pass `--verify-vendor lob` (or another
keyed vendor) to check against the vendor on a live send; a live send
to an undeliverable address is refused before it mails. Artwork is not
checked against print-safe layout rules.
The Lob adapter fixes `use_type` to `operational`; assess suitability before using it for a campaign.
Requests default to ten-second timeouts. Adapters do not implement automatic retries or idempotency keys.
Check vendor state before retrying an uncertain send.
Cancellation depends on vendor state and can fail after printing starts.

`trackingUrl` uses the vendor URL when supplied, otherwise an API endpoint that may require authentication.
It is not always a public delivery tracking page.
Reuse a guard instance to retain caps across SDK calls.
Costs count dispatch units, not monetary charges, and do not persist across separate CLI processes.

## Integration guides

Export only the key you need. The package does not load `.env` files automatically.

```sh
export LOB_API_KEY='your-key'
# After reviewing a preview and authorizing live mail:
npx agentic-postcard send --vendor lob --to @to.json --message "We miss you." --live
npx agentic-postcard track --vendor lob --id psc_abc123
npx agentic-postcard cancel --vendor lob --id psc_abc123
```

`to.json` uses the address shape from the quickstart. Vendor account requirements can require a sender address; pass `--from @from.json`.
PostGrid uses `POSTGRID_API_KEY`, with `POSTGRID_PRINT_MAIL_API_KEY` as a fallback.
Pass `--vendor postgrid` for its track and cancel commands.
PostGrid cancellation accepts `--note`; Lob ignores that note.
`--send-date` supplies a send date; SDK requests also accept `metadata`.
Read `getCostReport()` or MCP `get_cost_report` in the same process after a live send.
`npx agentic-postcard costs` prints only that CLI process's cost report.

- [Lob Print and Mail API reference](https://docs.lob.com/)
- [PostGrid postcard API reference](https://docs.postgrid.com/)

## Status

Version 0.1.0 is pre-1.0; interfaces can change.
[Report reproducible issues](https://github.com/pooriaarab/agentic-postcard/issues) without credentials or personal addresses.
Public case studies are not yet published in this repository.

## FAQ

### What is agentic-postcard?

agentic-postcard wraps Lob and PostGrid postcard requests.
It provides local previews, live sends, status reads, and cancellation requests.

### Which integrations are verified?

agentic-postcard tests two live vendor adapters with mocked responses.
This rewrite does not verify live credentials, print output, or postal delivery.

### Does agentic-postcard provide a managed mail service?

agentic-postcard runs in your environment and uses your vendor account.
Lob or PostGrid handles printing and mail delivery.

### How is agentic-postcard different from Lob?

agentic-postcard maps a shared address and HTML shape to Lob requests.
Lob provides the print and mail service behind that adapter.

### How is agentic-postcard different from PostGrid?

agentic-postcard translates postcard sizes and contact fields for PostGrid.
PostGrid provides the print and mail service behind that adapter.

### Can I preview without credentials?

agentic-postcard supports `--vendor dry-run` without credentials.
The result contains a marker URL and mails nothing.

### Which postcard sizes are supported?

agentic-postcard accepts `4x6` and `6x9`, with `4x6` as the default.
Its PostGrid adapter translates those names to the vendor's orientation.

### Is the tracking URL always public?

agentic-postcard can return a proof URL or an authenticated API endpoint.
Use `trackPostcard` to read available delivery status with your vendor credentials.

### Does cancellation always stop printing?

agentic-postcard submits the vendor cancellation request and reports its response.
Check `cancelled` and vendor state before assuming a card has stopped.

## Development

```sh
npm ci
npm run build
npm run typecheck
npm test
```

## License

MIT
