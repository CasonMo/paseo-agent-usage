import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codebuddyRoots, scanCodebuddyFile } from "../server/scan/codebuddy";
import { emptyState, type ScanState } from "../server/scan/state";

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

/** One finished Codebuddy request row, in the observed array-of-details form. */
function usageRow(options: {
  messageId: string;
  timestamp: unknown;
  model?: string;
  sessionId?: string;
  cwd?: string;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  objectDetails?: boolean;
}): unknown {
  const inputTokensDetails = options.objectDetails ? { cached_tokens: options.cached } : [{ cached_tokens: options.cached }];
  const outputTokensDetails = options.objectDetails ? { reasoning_tokens: options.reasoning } : [{ reasoning_tokens: options.reasoning }];
  return {
    type: "function_call",
    timestamp: options.timestamp,
    sessionId: options.sessionId ?? "sess-1",
    cwd: options.cwd ?? "/example/project",
    providerData: {
      messageId: options.messageId,
      model: options.model ?? "cb-test-model",
      usage: {
        requests: 1,
        inputTokens: options.input,
        outputTokens: options.output,
        inputTokensDetails,
        outputTokensDetails,
      },
    },
  };
}

function totals(state: ScanState): { r: number; i: number; o: number; cr: number; cw: number; rz: number } {
  const sum = { r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0 };
  for (const [key, bucket] of Object.entries(state.buckets)) {
    if (!key.includes("\u0001codebuddy\u0001")) continue;
    sum.r += bucket.r;
    sum.i += bucket.i;
    sum.o += bucket.o;
    sum.cr += bucket.cr;
    sum.cw += bucket.cw;
    sum.rz += bucket.rz;
  }
  return sum;
}

async function check(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agent-usage-codebuddy-"));
  try {
    assert.ok(codebuddyRoots({ CODEBUDDY_CONFIG_DIR: root }).includes(join(root, "projects")));

    const dir = join(root, "projects", "encoded-cwd");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "sess-1.jsonl");
    await writeFile(
      file,
      jsonl([
        // Machine-injected title prompt first: it must NOT become the label.
        { type: "message", role: "user", content: [{ type: "input_text", text: "Generate a title and a git branch name for a coding agent" }] },
        // Real first user prompt: becomes the session label.
        { type: "message", role: "user", content: [{ type: "input_text", text: "Hello world" }] },
        // A: milliseconds timestamp, array details. input 1000, cached 400 -> input 600, cacheRead 400.
        usageRow({ messageId: "msg-a", timestamp: 1_700_000_000_000, input: 1000, cached: 400, output: 100, reasoning: 20 }),
        // Non-usage row sharing an id: must be ignored.
        { type: "function_call_result", timestamp: 1_700_000_000_000, sessionId: "sess-1", cwd: "/example/project", providerData: { messageId: "msg-a" }, output: "ok" },
        // B: seconds timestamp as a numeric string, object details, cached > input -> clamp to input (500), input 0.
        usageRow({ messageId: "msg-b", timestamp: "1700000000", input: 500, cached: 700, output: 50, reasoning: 0, objectDetails: true }),
      ]),
    );

    const state = emptyState();
    await scanCodebuddyFile(state, file);

    assert.deepEqual(
      state.recent.codebuddy?.map(({ m, i, o, cr, cw, rz }) => ({ m, i, o, cr, cw, rz })),
      [
        { m: "cb-test-model", i: 600, o: 100, cr: 400, cw: 0, rz: 20 },
        { m: "cb-test-model", i: 0, o: 50, cr: 500, cw: 0, rz: 0 },
      ],
    );
    // Seconds timestamps were normalized to milliseconds (year 2027, not 1970).
    assert.ok((state.recent.codebuddy ?? []).every((call) => call.t > 1e12));
    assert.deepEqual(totals(state), { r: 2, i: 600, o: 150, cr: 900, cw: 0, rz: 20 });

    // Session label is the real prompt, not the injected title prompt.
    const session = state.sessions["codebuddy\u0001sess-1"];
    assert.equal(session?.title, "Hello world");
    assert.equal(session?.r, 2);

    // Incremental rescan of an unchanged file must not double count.
    const snapshot = JSON.stringify(state);
    await scanCodebuddyFile(state, file);
    assert.equal(JSON.stringify(state), snapshot);

    // Appending a new request counts only the new row.
    await writeFile(file, jsonl([usageRow({ messageId: "msg-c", timestamp: 1_700_000_100_000, input: 10, cached: 0, output: 5, reasoning: 0 })]), { flag: "a" });
    await scanCodebuddyFile(state, file);
    assert.deepEqual(totals(state), { r: 3, i: 610, o: 155, cr: 900, cw: 0, rz: 20 });

    // A fresh file with a nested `message.role` user turn still yields a title.
    const nested = join(dir, "sess-2.jsonl");
    await writeFile(
      nested,
      jsonl([
        { type: "message", message: { role: "user", content: [{ type: "input_text", text: "Nested prompt" }] } },
        usageRow({ messageId: "msg-d", timestamp: 1_700_000_000_000, sessionId: "sess-2", input: 5, cached: 0, output: 1, reasoning: 0 }),
      ]),
    );
    await scanCodebuddyFile(state, nested);
    assert.equal(state.sessions["codebuddy\u0001sess-2"]?.title, "Nested prompt");

    console.log("codebuddy scan checks passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void check().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
