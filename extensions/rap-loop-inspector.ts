/**
 * rap-loop-inspector — privacy-first Pi telemetry bridge for Agent Loop Inspector.
 *
 * Configure:
 *   RAP_LOOP_INSPECTOR_ENDPOINT=https://your-dashboard.example/api/telemetry/ingest
 *   RAP_LOOP_INSPECTOR_TOKEN=<shared secret configured on the dashboard>
 *   RAP_LOOP_INSPECTOR_GUARD=1   # optional: block an exact retry after the same tool call failed
 *
 * Content is deliberately excluded: prompts, assistant text, tool arguments/results,
 * file paths and raw provider payloads are never sent. Only metadata, token usage,
 * field names and one-way fingerprints leave the Pi process.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type JsonRecord = Record<string, unknown>;

type TelemetryEvent = {
  version: 1;
  source: "rap-plus";
  eventId: string;
  sessionId: string;
  runId: string;
  timestamp: number;
  type: string;
  data: JsonRecord;
};

type AssistantMessage = {
  role?: unknown;
  provider?: unknown;
  model?: unknown;
  api?: unknown;
  timestamp?: unknown;
  stopReason?: unknown;
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
    cost?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; total?: unknown };
  };
};

type ToolCallState = { fingerprint: string; toolName: string };

const ENDPOINT = process.env.RAP_LOOP_INSPECTOR_ENDPOINT?.trim();
const TOKEN = process.env.RAP_LOOP_INSPECTOR_TOKEN?.trim();
const GUARD_ENABLED = /^(1|true|yes)$/i.test(process.env.RAP_LOOP_INSPECTOR_GUARD ?? "");
const MAX_QUEUE = 500;
const BATCH_SIZE = 40;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function assistantMessage(value: unknown): AssistantMessage | undefined {
  const record = asRecord(value);
  return record.role === "assistant" ? record as AssistantMessage : undefined;
}

export default function rapLoopInspector(pi: ExtensionAPI): void {
  // Disabled unless both settings are supplied. No network calls or timers otherwise.
  if (!ENDPOINT || !TOKEN) return;

  let sessionId = randomUUID();
  let runId = randomUUID();
  let queue: TelemetryEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;
  let stopped = false;
  const callsById = new Map<string, ToolCallState>();
  const failedFingerprints = new Set<string>();

  const scheduleFlush = (delay = 1000) => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
    timer.unref?.();
  };

  const emit = (type: string, data: JsonRecord = {}) => {
    if (stopped) return;
    queue.push({
      version: 1,
      source: "rap-plus",
      eventId: randomUUID(),
      sessionId,
      runId,
      timestamp: Date.now(),
      type,
      data,
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (queue.length >= BATCH_SIZE) void flush();
    else scheduleFlush();
  };

  const flush = async (): Promise<void> => {
    if (flushing || stopped || queue.length === 0) return;
    flushing = true;
    const batch = queue.splice(0, BATCH_SIZE);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ version: 1, events: batch }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`telemetry HTTP ${response.status}`);
    } catch {
      // Keep bounded local metadata and retry later. Never interrupt an agent run.
      queue = [...batch, ...queue].slice(-MAX_QUEUE);
      scheduleFlush(5000);
    } finally {
      flushing = false;
      if (queue.length > 0 && !timer) scheduleFlush(1000);
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) sessionId = hash(sessionFile);
    emit("session_start", { hasSessionFile: Boolean(sessionFile) });
  });

  pi.on("agent_start", async () => {
    runId = randomUUID();
    callsById.clear();
    failedFingerprints.clear();
    emit("agent_start");
  });

  pi.on("turn_start", async (event) => {
    emit("turn_start", { turnIndex: safeNumber(asRecord(event).turnIndex) });
  });

  pi.on("message_end", async (event) => {
    const message = assistantMessage(asRecord(event).message);
    if (!message) return;
    const usage = message.usage ?? {};
    emit("assistant_message", {
      provider: typeof message.provider === "string" ? message.provider : undefined,
      model: typeof message.model === "string" ? message.model : undefined,
      api: typeof message.api === "string" ? message.api : undefined,
      stopReason: typeof message.stopReason === "string" ? message.stopReason : undefined,
      inputTokens: safeNumber(usage.input) ?? 0,
      outputTokens: safeNumber(usage.output) ?? 0,
      cacheReadTokens: safeNumber(usage.cacheRead) ?? 0,
      cacheWriteTokens: safeNumber(usage.cacheWrite) ?? 0,
      totalTokens: safeNumber(usage.totalTokens) ?? 0,
      cost: safeNumber(usage.cost?.total) ?? 0,
      timestamp: safeNumber(message.timestamp) ?? Date.now(),
    });
  });

  pi.on("tool_execution_start", async (event) => {
    const data = asRecord(event);
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : randomUUID();
    const toolName = typeof data.toolName === "string" ? data.toolName : "unknown";
    const args = asRecord(data.args);
    const fingerprint = hash(`${toolName}:${stableJson(args)}`);
    callsById.set(toolCallId, { fingerprint, toolName });
    emit("tool_start", {
      toolCallId,
      toolName,
      argsHash: fingerprint,
      argKeys: Object.keys(args).sort().slice(0, 40),
    });
  });

  pi.on("tool_call", async (event) => {
    if (!GUARD_ENABLED) return;
    const data = asRecord(event);
    const toolName = typeof data.toolName === "string" ? data.toolName : "unknown";
    const input = asRecord(data.input);
    const fingerprint = hash(`${toolName}:${stableJson(input)}`);
    if (failedFingerprints.has(fingerprint) && ["edit", "write", "bash"].includes(toolName)) {
      emit("guard_block", { toolName, argsHash: fingerprint, reason: "identical_retry_after_failure" });
      return {
        block: true,
        reason: "Loop Inspector guard: this exact tool call already failed with the same result in this run. Change the arguments or investigate the failure before retrying.",
      };
    }
  });

  pi.on("tool_execution_end", async (event) => {
    const data = asRecord(event);
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    const state = callsById.get(toolCallId);
    const isError = data.isError === true;
    const resultFingerprint = hash(stableJson({
      isError,
      // Only a one-way fingerprint is sent; raw result text never leaves this process.
      result: data.result ?? null,
    }));
    emit("tool_end", {
      toolCallId: toolCallId || undefined,
      toolName: typeof data.toolName === "string" ? data.toolName : state?.toolName,
      argsHash: state?.fingerprint,
      resultHash: resultFingerprint,
      isError,
      durationMs: safeNumber(data.durationMs),
    });
    if (GUARD_ENABLED && state && isError) failedFingerprints.add(state.fingerprint);
    if (toolCallId) callsById.delete(toolCallId);
  });

  pi.on("turn_end", async (event) => {
    const message = assistantMessage(asRecord(event).message);
    emit("turn_end", {
      stopReason: typeof message?.stopReason === "string" ? message.stopReason : undefined,
      toolResultCount: Array.isArray(asRecord(event).toolResults) ? (asRecord(event).toolResults as unknown[]).length : 0,
    });
  });

  pi.on("agent_end", async (event) => {
    const data = asRecord(event);
    emit("agent_end", {
      willRetry: data.willRetry === true,
      messageCount: Array.isArray(data.messages) ? (data.messages as unknown[]).length : 0,
    });
  });

  pi.on("agent_settled", async (event) => {
    emit("agent_settled", { aborted: asRecord(event).aborted === true });
    await flush();
  });

  pi.on("session_shutdown", async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    await flush();
  });
}
