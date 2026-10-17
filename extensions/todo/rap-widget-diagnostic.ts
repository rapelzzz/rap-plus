/**
 * Diagnostic test: simulate pi's actual rendering flow.
 *
 * Reproduces exactly how tool-execution.js calls renderers:
 *   - renderCall(args, theme, context) → Component
 *   - renderResult({content, details}, {expanded, isPartial}, theme, context) → Component
 *
 * Key insight from tool-execution.js line 237:
 *   resultRenderer({ content: this.result.content, details: this.result.details }, ...)
 *
 * The first arg is {content, details} ONLY — no isError, no structuredContent.
 * isError lives in context.isError, durationMs in context.durationMs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerRapToolWidgetRenderer } from "./ui/rap-tool-widget-renderer.ts";

// ─── Mock ExtensionAPI that captures registerToolRenderer calls ────────────

function createMockPi() {
  const resolvers: Array<(toolName: string, next: () => unknown) => unknown> = [];
  const pi: any = {
    registerToolRenderer(resolver: (toolName: string, next: () => unknown) => unknown) {
      resolvers.push(resolver);
    },
    on() {},
    registerTool() {},
    registerCommand() {},
    ui: {
      setWidget: () => {},
      notify: () => {},
      confirm: async () => true,
      custom: () => ({ dispose: () => {} }),
    },
  };
  return { pi, resolvers };
}

// ─── Simulate resolveToolRenderers chain ───────────────────────────────────

function resolveChain(
  resolvers: Array<(toolName: string, next: () => unknown) => unknown>,
  toolName: string,
  base: () => unknown,
): unknown {
  const resolve = (index: number): unknown =>
    index < resolvers.length
      ? resolvers[index](toolName, () => resolve(index + 1))
      : base();
  return resolve(0);
}

// ─── Mock theme (matches pi's Theme interface enough for rendering) ────────

function createMockTheme(): any {
  return {
    fg: (_role: string, text: string) => text,
    bg: (_role: string, text: string) => text,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  };
}

// ─── Mock ToolRenderContext (matches what tool-execution.js creates) ───────

function createMockContext(overrides: Record<string, unknown> = {}): any {
  return {
    args: {},
    toolCallId: "test-id",
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: "/root",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
    durationMs: 1500,
    outputPad: 1,
    ...overrides,
  };
}

describe("RAP widget renderer — runtime simulation", () => {
  const { pi, resolvers } = createMockPi();
  registerRapToolWidgetRenderer(pi);

  it("should register at least 2 resolvers (bash + file tools)", () => {
    assert.ok(resolvers.length >= 2, `Expected >= 2 resolvers, got ${resolvers.length}`);
  });

  // Test each tool the renderer claims to handle
  const tools = ["bash", "write", "edit", "read", "grep", "find", "ls"] as const;

  for (const toolName of tools) {
    describe(`tool: ${toolName}`, () => {
      it("resolver should return a ToolRenderers object with renderShell='self'", () => {
        const result = resolveChain(resolvers, toolName, () => undefined);
        assert.ok(result, `Resolver returned undefined for ${toolName}`);
        assert.ok(typeof result === "object", `Expected object, got ${typeof result}`);
        const r = result as any;
        assert.equal(r.renderShell, "self", `${toolName} should use renderShell: "self"`);
        assert.ok(r.renderCall, `No renderCall on ${toolName}`);
        assert.ok(r.renderResult, `No renderResult on ${toolName}`);
      });

      it("renderCall should not throw and return a Component", () => {
        const result = resolveChain(resolvers, toolName, () => undefined) as any;

        const args: Record<string, unknown> =
          toolName === "bash" ? { command: "echo hello" } :
          toolName === "write" ? { file_path: "/tmp/test.txt", content: "hello" } :
          toolName === "edit" ? { file_path: "/tmp/test.txt" } :
          toolName === "read" ? { file_path: "/tmp/test.txt" } :
          toolName === "grep" ? { pattern: "test", path: "." } :
          toolName === "find" ? { pattern: "*.ts", path: "." } :
          toolName === "ls" ? { path: "." } : {};

        const theme = createMockTheme();
        const context = createMockContext({ args });

        let component: unknown;
        assert.doesNotThrow(() => {
          component = result.renderCall(args, theme, context);
        }, `renderCall threw for ${toolName}`);

        assert.ok(component, `renderCall returned falsy for ${toolName}`);
      });

      it("renderResult (success) should not throw and return a Component", () => {
        const result = resolveChain(resolvers, toolName, () => undefined) as any;

        // CRITICAL: pi passes {content, details} — NOT the full result with isError
        const piResult = {
          content: [{ type: "text", text: "sample output line 1\nline 2" }],
          details: toolName === "bash" ? { truncation: { truncated: false } } : undefined,
        };

        const theme = createMockTheme();
        const context = createMockContext({ isError: false });

        let component: unknown;
        assert.doesNotThrow(() => {
          component = result.renderResult(piResult, { expanded: false, isPartial: false }, theme, context);
        }, `renderResult threw for ${toolName}`);

        assert.ok(component, `renderResult returned falsy for ${toolName}`);
      });

      it("renderResult (error) should not throw and return a Component", () => {
        const result = resolveChain(resolvers, toolName, () => undefined) as any;

        // pi passes {content, details} — isError is in context, NOT in result
        const piResult = {
          content: [{ type: "text", text: "error: something failed" }],
          details: undefined,
        };

        const theme = createMockTheme();
        const context = createMockContext({ isError: true });

        let component: unknown;
        assert.doesNotThrow(() => {
          component = result.renderResult(piResult, { expanded: false, isPartial: false }, theme, context);
        }, `renderResult threw for ${toolName} when isError=true in context`);

        assert.ok(component, `renderResult returned falsy for ${toolName} error case`);
      });

      it("renderResult (expanded) should not throw and return a Component", () => {
        const result = resolveChain(resolvers, toolName, () => undefined) as any;

        const piResult = {
          content: [{ type: "text", text: "line 1\nline 2\nline 3\nline 4\nline 5" }],
          details: undefined,
        };

        const theme = createMockTheme();
        const context = createMockContext({ isError: false });

        let component: unknown;
        assert.doesNotThrow(() => {
          component = result.renderResult(piResult, { expanded: true, isPartial: false }, theme, context);
        }, `renderResult threw for ${toolName} when expanded=true`);

        assert.ok(component, `renderResult returned falsy for ${toolName} expanded case`);
      });

      it("renderResult (partial/streaming) should not throw", () => {
        const result = resolveChain(resolvers, toolName, () => undefined) as any;

        const piResult = {
          content: [{ type: "text", text: "partial output..." }],
          details: undefined,
        };

        const theme = createMockTheme();
        const context = createMockContext({ isError: false, isPartial: true });

        assert.doesNotThrow(() => {
          result.renderResult(piResult, { expanded: false, isPartial: true }, theme, context);
        }, `renderResult threw for ${toolName} when isPartial=true`);
      });

      it("renderResult (empty output) should not throw", () => {
        const result = resolveChain(resolvers, toolName, () => undefined) as any;

        const piResult = {
          content: [{ type: "text", text: "" }],
          details: undefined,
        };

        const theme = createMockTheme();
        const context = createMockContext({ isError: false });

        let component: unknown;
        assert.doesNotThrow(() => {
          component = result.renderResult(piResult, { expanded: false, isPartial: false }, theme, context);
        }, `renderResult threw for ${toolName} when output is empty`);

        assert.ok(component, `renderResult returned falsy for ${toolName} empty case`);
      });
    });
  }

  describe("unsupported tool fallback", () => {
    it("resolver should return undefined (call next) for unknown tools", () => {
      const result = resolveChain(resolvers, "unknown_tool", () => undefined);
      assert.equal(result, undefined, "Unknown tool should fall through to next()");
    });
  });

  describe("bash exit code resolution", () => {
    it("should resolve exit code from output text", () => {
      const result = resolveChain(resolvers, "bash", () => undefined) as any;
      const theme = createMockTheme();
      const context = createMockContext({ isError: true });

      const piResult = {
        content: [{ type: "text", text: "some output\nCommand exited with code 127" }],
        details: undefined,
      };

      let component: unknown;
      assert.doesNotThrow(() => {
        component = result.renderResult(piResult, { expanded: false, isPartial: false }, theme, context);
      });
      assert.ok(component);
    });
  });
});
