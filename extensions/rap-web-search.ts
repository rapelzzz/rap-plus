/**
 * rap-web-search Extension
 *
 * Browser-automation web search tool using Playwright + DuckDuckGo (HTML).
 *
 * - Registers a `web_search` tool callable by the model.
 * - Launches a headless Chromium browser lazily (reused across calls in a session).
 * - Queries DuckDuckGo's HTML endpoint, extracts result list (title/url/snippet).
 * - Optionally extracts the text content of the top result page.
 * - Truncates large output and writes the full output to a temp file when needed.
 * - Cleans up the browser on session shutdown (idempotent).
 *
 * Approach #2 (browser automation), headless only, DuckDuckGo only.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { tmpdir } from "os";
import { join } from "path";
import { Type } from "typebox";
import type { Browser } from "playwright";
import { normalizeHttpUrl } from "./_shared/url-safety.ts";

/** A single DuckDuckGo search result. */
interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

/** Structured details persisted in the tool result (for forking/rendering). */
interface WebSearchDetails {
	query: string;
	resultCount: number;
	results: SearchResult[];
	extractedUrl?: string;
	extractedContentChars?: number;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

const WebSearchParams = Type.Object({
	query: Type.String({ description: "The search query string" }),
	maxResults: Type.Optional(
		Type.Number({
			description: "Maximum number of results to return (default: 5, max: 10)",
		}),
	),
	extractContent: Type.Optional(
		Type.Boolean({
			description:
				"If true (default), extract the full text content of the top result page in addition to the result list.",
		}),
	),
});

/**
 * Decode a DuckDuckGo redirect href into the real target URL.
 * DuckDuckGo HTML wraps result links as "//duckduckgo.com/l/?uddg=<encoded>&rut=..."
 * Some links may already be direct URLs.
 */
export function resolveResultUrl(href: string): string {
	if (!href) return "";
	const normalized = href.startsWith("//") ? `https:${href}` : href;
	try {
		const wrapper = new URL(normalized);
		const target = wrapper.searchParams.get("uddg") ?? normalized;
		return normalizeHttpUrl(target);
	} catch {
		return "";
	}
}

/** Strip common non-content elements and return readable text from a page. */
async function extractPageText(page: import("playwright").Page): Promise<string> {
	return page.evaluate(() => {
		const removeSelectors = [
			"script",
			"style",
			"noscript",
			"nav",
			"footer",
			"header",
			"aside",
			"iframe",
			"form",
			"svg",
		];
		for (const sel of removeSelectors) {
			document.querySelectorAll(sel).forEach((el) => el.remove());
		}
		const main =
			document.querySelector("main") ||
			document.querySelector("article") ||
			document.querySelector("#content") ||
			document.body;
		return (main?.textContent || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	});
}

export default function (pi: ExtensionAPI) {
	// Lazily-created, session-scoped browser. Do NOT launch in the factory.
	let browserPromise: Promise<Browser> | null = null;
	let browser: Browser | null = null;

	const launchBrowser = async (): Promise<Browser> => {
		if (browser) return browser;
		if (browserPromise) return browserPromise;
		// Dynamic import so the factory doesn't touch playwright before it's needed.
		const { chromium } = await import("playwright");
		browserPromise = chromium.launch({ headless: true });
		browser = await browserPromise;
		return browser;
	};

	// Idempotent cleanup.
	const closeBrowser = async () => {
		const b = browser;
		browser = null;
		browserPromise = null;
		if (b) {
			try {
				await b.close();
			} catch {
				/* ignore — already closed */
			}
		}
	};

	pi.on("session_shutdown", async () => {
		await closeBrowser();
	});

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: `Search the web using DuckDuckGo via a headless browser (Playwright). Returns a list of results (title, URL, snippet) and, by default, the full text content of the top result page. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; full output is saved to a temp file when truncated. Use this when you need real-time or up-to-date information from the web.`,
		parameters: WebSearchParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const query = params.query.trim();
			if (!query) {
				throw new Error("query is required");
			}
			const maxResults = Math.min(Math.max(params.maxResults ?? 5, 1), 10);
			const wantContent = params.extractContent ?? true;

			const b = await launchBrowser();
			const page = await b.newPage();
			try {
				// Honor abort signals from the active turn.
				const abortListener = () => {
					void page.close().catch(() => {});
				};
				if (signal) {
					if (signal.aborted) throw new Error("aborted before search");
					signal.addEventListener("abort", abortListener, { once: true });
				}

				const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
				await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

				// Extract the result list from the DOM.
				const rawResults = await page.evaluate(() => {
					const items = Array.from(document.querySelectorAll(".result, .web-result"));
					return items
						.map((el) => {
							const a =
								el.querySelector(".result__a") ||
								el.querySelector("a.result__url") ||
								el.querySelector("h2 a");
							const snippet =
								el.querySelector(".result__snippet") || el.querySelector(".result-snippet");
							const href = a?.getAttribute("href") || "";
							return {
								title: (a?.textContent || "").trim(),
								href,
								snippet: (snippet?.textContent || "").trim(),
							};
						})
						.filter((r) => r.title || r.href);
				});

				const results: SearchResult[] = rawResults
					.slice(0, maxResults)
					.map((r) => ({
						title: r.title,
						url: resolveResultUrl(r.href),
						snippet: r.snippet,
					}));

				// Optionally extract content from the top result.
				let extractedUrl: string | undefined;
				let extractedText = "";
				if (wantContent && results.length > 0 && results[0].url) {
					const topUrl = results[0].url;
					const contentPage = await b.newPage();
					try {
						await contentPage.goto(topUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
						extractedText = await extractPageText(contentPage);
						extractedUrl = topUrl;
					} catch (err) {
						extractedText = `[Failed to extract content from ${topUrl}: ${(err as Error).message}]`;
						extractedUrl = topUrl;
					} finally {
						await contentPage.close().catch(() => {});
					}
				}

				// Build the model-facing text.
				let text = `Search results for "${query}" (${results.length}):\n\n`;
				for (let i = 0; i < results.length; i++) {
					const r = results[i];
					text += `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}\n\n`;
				}
				if (extractedUrl) {
					const preview = extractedText.slice(0, 8000);
					text += `\n--- Content of top result: ${extractedUrl} ---\n${preview}`;
					if (extractedText.length > 8000) {
						text += `\n\n[page content truncated inline; full output saved below]`;
					}
				}

				const details: WebSearchDetails = {
					query,
					resultCount: results.length,
					results,
					extractedUrl,
					extractedContentChars: extractedText.length,
				};

				// Apply pi's built-in truncation.
				const truncation = truncateHead(text, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let resultText = truncation.content;
				if (truncation.truncated) {
					const tempDir = await mkdtemp(join(tmpdir(), "pi-web-search-"));
					const tempFile = join(tempDir, "output.txt");
					await writeFile(tempFile, text, "utf8");

					details.truncation = truncation;
					details.fullOutputPath = tempFile;

					resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${tempFile}]`;
				}

				return {
					content: [{ type: "text", text: resultText }],
					details,
				};
			} finally {
				if (signal) {
					signal.removeEventListener("abort", () => {});
				}
				await page.close().catch(() => {});
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("web_search "));
			text += theme.fg("accent", `"${args.query}"`);
			if (args.maxResults !== undefined) text += theme.fg("dim", ` max=${args.maxResults}`);
			if (args.extractContent === false) text += theme.fg("dim", " no-content");
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Searching the web..."), 0, 0);
			}
			const details = result.details as WebSearchDetails | undefined;
			if (!details || details.resultCount === 0) {
				return new Text(theme.fg("dim", "No results found"), 0, 0);
			}

			let text = theme.fg("success", `${details.resultCount} results`);
			if (details.extractedUrl) {
				text += theme.fg("muted", ` + content extracted`);
			}
			if (details.truncation?.truncated) {
				text += theme.fg("warning", " (truncated)");
			}

			if (expanded) {
				const show = details.results.slice(0, 5);
				for (const r of show) {
					text += `\n${theme.fg("accent", r.title)}`;
					text += `\n${theme.fg("dim", r.url)}`;
				}
				if (details.results.length > 5) {
					text += `\n${theme.fg("muted", `... ${details.results.length - 5} more`)}`;
				}
				if (details.fullOutputPath) {
					text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});
}
