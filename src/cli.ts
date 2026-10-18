#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  buildCardHtml,
  cancelPostcard,
  sendPostcard,
  trackPostcard,
  type PostcardAddress,
  type PostcardSize,
  type VerifyVendor,
} from "./postcard.js";
import { getCostReport, GuardError, VendorError } from "./core.js";
import { DEFAULT_BRAND } from "./index.js";
import { VERSION } from "./version.js";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type CliCommand =
  | "send"
  | "track"
  | "cancel"
  | "costs"
  | "mcp"
  | "help"
  | "version";

export interface CliRequest {
  command: CliCommand;
  to?: string;
  from?: string;
  front?: string;
  back?: string;
  message?: string;
  size?: string;
  vendor?: string;
  verifyVendor?: string;
  description?: string;
  sendDate?: string;
  id?: string;
  note?: string;
  live: boolean;
  dryRun: boolean;
}

function isFlag(value: string | undefined): boolean {
  return value === undefined || value.startsWith("--");
}

export function parseArgs(argv: string[]): CliRequest {
  const request: CliRequest = { command: "help", live: false, dryRun: false };
  const args = [...argv];
  const first = args.shift();
  if (first === undefined || first === "--help" || first === "-h") {
    return request;
  }
  if (first === "--version" || first === "-V") {
    request.command = "version";
    return request;
  }
  if (
    first !== "send" &&
    first !== "track" &&
    first !== "cancel" &&
    first !== "costs" &&
    first !== "mcp"
  ) {
    throw new UsageError(`unknown command "${first}"`);
  }
  request.command = first;
  const takeValue = (flag: string): string => {
    const value = args.shift();
    if (isFlag(value)) {
      throw new UsageError(`${flag} needs a value`);
    }
    return value as string;
  };
  while (args.length > 0) {
    const flag = args.shift() as string;
    switch (flag) {
      case "--live":
        request.live = true;
        break;
      case "--dry-run":
        request.dryRun = true;
        break;
      case "--to":
        request.to = takeValue(flag);
        break;
      case "--from":
        request.from = takeValue(flag);
        break;
      case "--front":
        request.front = takeValue(flag);
        break;
      case "--back":
        request.back = takeValue(flag);
        break;
      case "--message":
        request.message = takeValue(flag);
        break;
      case "--size":
        request.size = takeValue(flag);
        break;
      case "--vendor":
        request.vendor = takeValue(flag);
        break;
      case "--verify-vendor":
        request.verifyVendor = takeValue(flag);
        break;
      case "--description":
        request.description = takeValue(flag);
        break;
      case "--send-date":
        request.sendDate = takeValue(flag);
        break;
      case "--id":
        request.id = takeValue(flag);
        break;
      case "--note":
        request.note = takeValue(flag);
        break;
      default:
        throw new UsageError(`unknown flag "${flag}" for "${request.command}"`);
    }
  }
  if (request.command === "send") {
    if (request.to === undefined) {
      throw new UsageError('send needs --to with a JSON address or @file');
    }
    if (
      request.message === undefined &&
      (request.front === undefined || request.back === undefined)
    ) {
      throw new UsageError("send needs --message or both --front and --back");
    }
    if (request.live && request.dryRun) {
      throw new UsageError("use --live or --dry-run, not both");
    }
    if (
      request.size !== undefined &&
      request.size !== "4x6" &&
      request.size !== "6x9"
    ) {
      throw new UsageError(`--size must be "4x6" or "6x9", got "${request.size}"`);
    }
  }
  if (request.command === "track" || request.command === "cancel") {
    if (request.vendor === undefined) {
      throw new UsageError(`${request.command} needs --vendor lob or postgrid`);
    }
    if (request.vendor !== "lob" && request.vendor !== "postgrid") {
      throw new UsageError(`${request.command} needs --vendor lob or postgrid`);
    }
    if (request.id === undefined) {
      throw new UsageError(`${request.command} needs --id with a card id`);
    }
  }
  return request;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readFile(path: string): string;
}

function defaultIo(): CliIo {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readFile: (path) => readFileSync(path, "utf8"),
  };
}

function helpText(): string {
  const command = DEFAULT_BRAND.command;
  return [
    `${DEFAULT_BRAND.name} ${VERSION}`,
    `${DEFAULT_BRAND.description}`,
    "",
    `Usage: ${command} <command> [flags]`,
    "",
    "Commands:",
    "  send --to <json|@file> [--message <t>] [--front <h|@f> --back <h|@f>]",
    "       [--from <json|@file>] [--size 4x6|6x9] [--vendor lob|postgrid]",
    "       [--description <t>] [--send-date <iso>] [--live|--dry-run]",
    "       [--verify-vendor dry|local|lob|postgrid|smartystreets|osm]",
    "       Preview a card send, or mail it with --live. Prints the receipt.",
    "       Every send verifies the recipient through agentic-address first.",
    "  track --vendor <lob|postgrid> --id <card>  Print live delivery status.",
    "  cancel --vendor <lob|postgrid> --id <card> [--note <t>]  Cancel a card.",
    "  costs                                      Print the cost report as JSON.",
    "  mcp                                        Start the MCP server on stdio.",
    "",
    "Flags:",
    "  --help, -h       Print this help.",
    "  --version, -V    Print the version.",
    "",
    "Keys: LOB_API_KEY for lob, POSTGRID_API_KEY for postgrid.",
    "Without --live every send is a dry run and mails nothing.",
  ].join("\n");
}

function resolveInput(value: string, io: CliIo): string {
  if (value.startsWith("@")) {
    return io.readFile(value.slice(1));
  }
  return value;
}

function parseAddress(raw: string, io: CliIo, label: string): PostcardAddress {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resolveInput(raw, io));
  } catch {
    throw new UsageError(`${label} must be JSON or @file with JSON`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new UsageError(`${label} must be JSON or @file with JSON`);
  }
  return parsed as PostcardAddress;
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  let request: CliRequest;
  try {
    request = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(`Run "${DEFAULT_BRAND.command} --help" for usage.`);
    return 2;
  }
  try {
    switch (request.command) {
      case "help":
        io.out(helpText());
        return 0;
      case "version":
        io.out(VERSION);
        return 0;
      case "send": {
        const to = parseAddress(request.to as string, io, "--to");
        const from =
          request.from === undefined
            ? undefined
            : parseAddress(request.from, io, "--from");
        const art =
          request.message !== undefined
            ? buildCardHtml(request.message)
            : {
                front: resolveInput(request.front as string, io),
                back: resolveInput(request.back as string, io),
              };
        const result = await sendPostcard(
          {
            to,
            from,
            front: art.front,
            back: art.back,
            size: request.size as PostcardSize | undefined,
            description: request.description,
            sendDate: request.sendDate,
          },
          {
            vendor: request.vendor,
            live: request.live,
            verifyVendor: request.verifyVendor as VerifyVendor | undefined,
          },
        );
        io.out(JSON.stringify(result));
        return 0;
      }
      case "track": {
        const info = await trackPostcard(
          request.vendor as string,
          request.id as string,
        );
        io.out(JSON.stringify(info));
        return 0;
      }
      case "cancel": {
        const result = await cancelPostcard(
          request.vendor as string,
          request.id as string,
          request.note,
        );
        io.out(JSON.stringify(result));
        return 0;
      }
      case "costs":
        io.out(JSON.stringify(getCostReport()));
        return 0;
      case "mcp": {
        const { startMcp } = await import("./mcp.js");
        await startMcp();
        return 0;
      }
    }
  } catch (error) {
    if (
      error instanceof GuardError ||
      error instanceof VendorError ||
      error instanceof UsageError
    ) {
      io.err(`${error.name}: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      io.err("file not found");
      return 1;
    }
    throw error;
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (typeof invoked !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      // Exit nonzero at once. On zero, fall off the end so a running
      // server (mcp) keeps its stdio handles open. Plain commands
      // hold no handles and exit 0 on their own.
      if (code !== 0) process.exit(code);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
