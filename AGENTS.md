# agentic-postcard agent guide

Send postcards through print vendors from CLI, code, or MCP.

## Mental model

An address plus artwork goes in. A mailed card plus a tracked
page URL comes out. One core serves all three faces, so each
face returns the same receipt shape.

## The three faces

- SDK: `import { sendPostcard } from "agentic-postcard"`.
- CLI: `npx agentic-postcard send --to ... --message "..."`.
- MCP: `npx agentic-postcard mcp`, then call a tool below.

Keywords: postcards, direct-mail, lob, postgrid, agentic-suite, claude-code, codex, cli, mcp.

## MCP tools

| Tool | Use it for |
| --- | --- |
| send_postcard | Preview or mail a card. Dry run by default. |
| track_postcard | Read live delivery status for a card id. |
| cancel_postcard | Cancel a card before it prints. |
| get_cost_report | Read session send totals. |

## The loop

1. Discover the tools with `tools/list`.
2. Preview a card with `send_postcard` and dryRun true.
3. Read the receipt and state the tracked page URL.
4. Mail with dryRun false only when the user asks for live.
5. Track with `track_postcard` when the user asks for status.
6. Read `get_cost_report` and state the send count.

## Rules

- Preview with dry run before each live mail.
- Never mail live unless the user asks for a live send.
- Stop when a guard denies the call. State the reason.
- Never retry a denied call with changed text to dodge a guard.
- Report adapter errors as errors. Never present them as success.
- State the cost report before you claim the task is done.
