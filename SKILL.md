---
name: agentic-postcard
description: Send postcards through print vendors from CLI, code, or MCP. Keywords: postcards, direct-mail, lob, postgrid, agentic-suite, claude-code, codex, cli, mcp.
---

# agentic-postcard

Send postcards through print vendors from CLI, code, or MCP.

## Use the SDK

```js
import { sendPostcard, trackPostcard } from "agentic-postcard";

const preview = await sendPostcard({
  to: { line1: "90 Canal St", city: "Boston", state: "MA", zip: "02114" },
  front: "<html>front</html>",
  back: "<html>back</html>",
});
await trackPostcard("lob", preview.receipt.id);
```

## Use the CLI

```sh
agentic-postcard send --to @to.json --message "Thank you."
agentic-postcard send --to @to.json --message "Thank you." --live
agentic-postcard track --vendor lob --id psc_abc123
```

## Use the MCP server

Start the server with `agentic-postcard mcp`. Call `send_postcard`
to preview or mail, `track_postcard` for status, `cancel_postcard`
to stop a card, `get_cost_report` for send totals.

## Rules

- Preview each send with dry run first.
- Mail live only when the user asks for it.
- Report guard denials and adapter errors as failures.
- Read the cost report at the end.
