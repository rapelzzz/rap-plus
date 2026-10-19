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

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
/** Reject loopback/private/reserved IPs before browser navigation. */
function isPublicAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 4) {
		const p = address.split(".").map(Number);
		if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
		const [a, b, c] = p;
		return !(
			a === 0 || a === 10 || a === 127 || a >= 224 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) ||
			(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
			(a === 203 && b === 0 && c === 113)
		);
	}
	if (version === 6) {
		const a = address.toLowerCase();
		if (a === "::" || a === "::1" || a.startsWith("::ffff:") ||
			a.startsWith("fc") || a.startsWith("fd") ||
			a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb") ||
			a.startsWith("ff") || a.startsWith("2001:db8:") || a.startsWith("2002:")) return false;
		// Permit only assigned global-unicast space. Also reject the first
		// reserved 2001::/23 block, which includes Teredo and ORCHID ranges.
		const fields = a.split(":").filter(Boolean);
		const firstWord = Number.parseInt(fields[0] ?? "0", 16);
		const secondWord = Number.parseInt(fields[1] ?? "0", 16);
		return firstWord >= 0x2001 && firstWord <= 0x3fff &&
			!(firstWord === 0x2001 && secondWord <= 0x01ff);
	}
	return false;
}

/**
 * Browser navigation guard. Checks every requested URL (including redirects and
 * subresources) and fails closed if the destination cannot be resolved safely.
 * This is defense-in-depth; Pi extensions still run with the user's OS account.
 */
export async function isSafeExternalUrl(value: string): Promise<boolean> {
	let url: URL;
	try { url = new URL(value); } catch { return false; }
	if (url.protocol !== "https:" && url.protocol !== "http:") return false;
	if (url.username || url.password) return false;
	const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (!host || host === "localhost" || host.endsWith(".localhost") ||
		host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") ||
		host.endsWith(".test") || host.endsWith(".invalid") || host.endsWith(".example")) return false;
	if (isIP(host)) return isPublicAddress(host);
	try {
		const addresses = await lookup(host, { all: true, verbatim: true });
		return addresses.length > 0 && addresses.every((entry) => isPublicAddress(entry.address));
	} catch {
		return false;
	}
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
function resolveResultUrl(href: string): string {
	if (!href) return "";
	// Normalize protocol-relative URLs
	const normalized = href.startsWith("//") ? `https:${href}` : href;
	try {
		const u = new URL(normalized);
		const uddg = u.searchParams.get("uddg");
		if (uddg) {
			try {
				return decodeURIComponent(uddg);
			} catch {
				return uddg;
			}
		}
		return normalized;
	} catch {
		return normalized;
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
	const outputDirs = new Set<string>();

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
		const dirs = [...outputDirs];
		outputDirs.clear();
		await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
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
			let abortListener: (() => void) | undefined;
			try {
				// Honor abort signals from the active turn.
				abortListener = () => {
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
					extractedUrl = topUrl;
					if (!(await isSafeExternalUrl(topUrl))) {
						extractedText = "[Content extraction blocked: target is not a public HTTP(S) URL.]";
					} else {
						const contentPage = await b.newPage();
						try {
							// Re-check every request and redirect, not only the first URL.
							await contentPage.route("**/*", async (route) => {
								if (await isSafeExternalUrl(route.request().url())) await route.continue();
								else await route.abort("blockedbyclient");
							});
							await contentPage.goto(topUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
							extractedText = await extractPageText(contentPage);
						} catch (err) {
							extractedText = `[Failed to extract content from ${topUrl}: ${(err as Error).message}]`;
						} finally {
							await contentPage.close().catch(() => {});
						}
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
					outputDirs.add(tempDir);
					const tempFile = join(tempDir, "output.txt");
					await writeFile(tempFile, text, { encoding: "utf8", mode: 0o600 });

					details.truncation = truncation;
					details.fullOutputPath = tempFile;

					resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${tempFile}]`;
				}

				return {
					content: [{ type: "text", text: resultText }],
					details,
				};
			} finally {
				if (signal && abortListener) signal.removeEventListener("abort", abortListener);
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
