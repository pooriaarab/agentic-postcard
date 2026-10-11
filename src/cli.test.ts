import { describe, expect, test } from "vitest";
import { parseArgs, runCli, UsageError, type CliIo } from "./cli.js";

const TO = JSON.stringify({
  name: "Ava Lee",
  line1: "90 Canal St",
  city: "Boston",
  state: "MA",
  zip: "02114",
});

function testIo(overrides: Partial<CliIo> = {}): CliIo & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
    readFile: (path) => `file:${path}`,
    ...overrides,
  };
}

describe("parseArgs", () => {
  test("empty args print help", () => {
    expect(parseArgs([]).command).toBe("help");
  });

  test("--version selects version", () => {
    expect(parseArgs(["--version"]).command).toBe("version");
  });

  test("send takes to, message, and vendor", () => {
    const request = parseArgs([
      "send",
      "--to",
      TO,
      "--message",
      "hello",
      "--vendor",
      "lob",
      "--size",
      "6x9",
    ]);
    expect(request).toMatchObject({
      command: "send",
      to: TO,
      message: "hello",
      vendor: "lob",
      size: "6x9",
      live: false,
    });
  });

  test("send needs a recipient", () => {
    expect(() => parseArgs(["send", "--message", "hi"])).toThrow(/--to/);
  });

  test("send needs art or a message", () => {
    expect(() => parseArgs(["send", "--to", TO])).toThrow(/--message/);
    expect(() => parseArgs(["send", "--to", TO, "--front", "<h>"])).toThrow(/--message/);
  });

  test("live and dry run conflict", () => {
    expect(() =>
      parseArgs(["send", "--to", TO, "--message", "hi", "--live", "--dry-run"]),
    ).toThrow(/not both/);
  });

  test("bad size throws", () => {
    expect(() =>
      parseArgs(["send", "--to", TO, "--message", "hi", "--size", "5x7"]),
    ).toThrow(/--size/);
  });

  test("track needs vendor and id", () => {
    expect(() => parseArgs(["track", "--id", "x"])).toThrow(/--vendor/);
    expect(() => parseArgs(["track", "--vendor", "lob"])).toThrow(/--id/);
    expect(() => parseArgs(["track", "--vendor", "other", "--id", "x"])).toThrow(
      /--vendor/,
    );
  });

  test("unknown command throws UsageError", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow(UsageError);
  });
});

describe("runCli", () => {
  test("send dry run prints a preview receipt", async () => {
    const io = testIo();
    const code = await runCli(["send", "--to", TO, "--message", "hello"], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.outLines[0]) as {
      dryRun: boolean;
      receipt: { trackingUrl: string };
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.receipt.trackingUrl).toContain("dry-run://");
  });

  test("send with front and back files reads both", async () => {
    const io = testIo({ readFile: () => "<html>art</html>" });
    const code = await runCli(
      ["send", "--to", TO, "--front", "@front.html", "--back", "@back.html"],
      io,
    );
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toMatchObject({ dryRun: true });
  });

  test("send rejects bad address JSON", async () => {
    const io = testIo();
    const code = await runCli(["send", "--to", "nope", "--message", "hi"], io);
    expect(code).toBe(1);
    expect(io.errLines[0]).toContain("UsageError");
  });

  test("live send without a key fails clean", async () => {
    const saved = {
      lob: process.env.LOB_API_KEY,
      pg: process.env.POSTGRID_API_KEY,
      pgMail: process.env.POSTGRID_PRINT_MAIL_API_KEY,
    };
    delete process.env.LOB_API_KEY;
    delete process.env.POSTGRID_API_KEY;
    delete process.env.POSTGRID_PRINT_MAIL_API_KEY;
    try {
      const io = testIo();
      const code = await runCli(["send", "--to", TO, "--message", "hi", "--live"], io);
      expect(code).toBe(1);
      expect(io.errLines[0]).toContain("VendorError");
    } finally {
      if (saved.lob !== undefined) process.env.LOB_API_KEY = saved.lob;
      if (saved.pg !== undefined) process.env.POSTGRID_API_KEY = saved.pg;
      if (saved.pgMail !== undefined) process.env.POSTGRID_PRINT_MAIL_API_KEY = saved.pgMail;
    }
  });

  test("bad usage exits 2", async () => {
    const io = testIo();
    const code = await runCli(["bogus"], io);
    expect(code).toBe(2);
    expect(io.errLines.length).toBeGreaterThan(0);
  });

  test("version prints a version string", async () => {
    const io = testIo();
    const code = await runCli(["--version"], io);
    expect(code).toBe(0);
    expect(io.outLines[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
