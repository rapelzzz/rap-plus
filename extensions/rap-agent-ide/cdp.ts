/**
 * Minimal Chrome DevTools Protocol (CDP) client for rap-agent-ide.
 *
 * Node's `--inspect-brk` exposes a CDP WebSocket endpoint; this client
 * connects,
 * sends commands (awaiting the matching response by id), and dispatches
 * events. Uses the global `WebSocket` (available in Node 24).
 *
 * Pure helper (parseInspectUrl) is unit-tested; the client is exercised by
 * the debugging/observability integration tests.
 */

import * as http from "node:http";

/** Pure: extract the ws:// URL from a `node --inspect` stderr banner. */
export function parseInspectUrl(stderr: string): string | null {
	const m = stderr.match(/ws:\/\/[^\s]+/);
	return m ? m[0] : null;
}

interface PendingCommand {
	resolve: (result: unknown) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
}

/**
 * Discover the CDP webSocketDebuggerUrl from the HTTP `/json` endpoint.
 * Falls back to constructing `ws://host:port` if the HTTP listing is unavailable.
 */
export function discoverCdpUrl(host: string, port: number, opts: { timeoutMs?: number } = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = http.get(
			{ hostname: host, port, path: "/json", headers: { Host: `${host}:${port}` } },
			(res) => {
				let body = "";
				res.on("data", (c: Buffer) => (body += c.toString("utf8")));
				res.on("end", () => {
					try {
						const list = JSON.parse(body) as Array<{ webSocketDebuggerUrl?: string }>;
						const target = list.find((t) => t.webSocketDebuggerUrl);
						if (target?.webSocketDebuggerUrl) {
							resolve(target.webSocketDebuggerUrl);
							return;
						}
					} catch {
						// fall through to ws:// construction
					}
					resolve(`ws://${host}:${port}`);
				});
			},
		);
		req.on("error", (err) => reject(err));
		req.setTimeout(opts.timeoutMs ?? 3000, () => {
			req.destroy();
			reject(new Error(`CDP discovery timed out at ${host}:${port}`));
		});
	});
}

export class CdpClient {
	private ws: WebSocket;
	private nextId = 1;
	private readonly pending = new Map<number, PendingCommand>();
	private readonly eventHandlers = new Map<string, Array<(params: unknown) => void>>();
	private closed = false;

	private constructor(ws: WebSocket) {
		this.ws = ws;
		ws.addEventListener("message", (ev: MessageEvent) => {
			const data = typeof ev.data === "string" ? ev.data : ev.data.toString();
			let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown };
			try {
				msg = JSON.parse(data);
			} catch {
				return;
			}
			if (typeof msg.id === "number") {
				const p = this.pending.get(msg.id);
				if (p) {
					this.pending.delete(msg.id);
					clearTimeout(p.timer);
					if (msg.error) p.reject(new Error(msg.error.message));
					else p.resolve(msg.result);
				}
			} else if (msg.method) {
				const handlers = this.eventHandlers.get(msg.method);
				if (handlers) for (const h of handlers) h(msg.params);
			}
		});
		ws.addEventListener("close", () => {
			this.closed = true;
			for (const [, p] of this.pending) {
				clearTimeout(p.timer);
				p.reject(new Error("CDP connection closed"));
			}
			this.pending.clear();
		});
		ws.addEventListener("error", (ev: Event) => {
			// Surface errors by rejecting pending commands; otherwise silent.
			const msg = "message" in ev && typeof ev.message === "string" ? ev.message : "CDP WebSocket error";
			for (const [, p] of this.pending) {
				clearTimeout(p.timer);
				p.reject(new Error(msg));
			}
		});
	}

	/** Connect to a CDP WebSocket URL. Resolves when the socket is open. */
	static connect(url: string, opts: { timeoutMs?: number } = {}): Promise<CdpClient> {
		return new Promise((resolve, reject) => {
			let ws: WebSocket;
			try {
				ws = new WebSocket(url);
			} catch (err) {
				reject(err as Error);
				return;
			}
			const timer = setTimeout(() => {
				try {
					ws.close();
				} catch {
					// ignore
				}
				reject(new Error(`CDP connect timed out: ${url}`));
			}, opts.timeoutMs ?? 5000);
			ws.addEventListener("open", () => {
				clearTimeout(timer);
				resolve(new CdpClient(ws));
			});
			ws.addEventListener("error", (ev: Event) => {
				clearTimeout(timer);
				const message = "message" in ev && typeof ev.message === "string" ? ev.message : `CDP connect failed: ${url}`;
				reject(new Error(message));
			});
		});
	}

	get isOpen(): boolean {
		return !this.closed && this.ws.readyState === WebSocket.OPEN;
	}

	/** Send a CDP command and await its response. Rejects on timeout/error. */
	send(method: string, params: object = {}, opts: { timeoutMs?: number } = {}): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("CDP connection closed"));
		const id = this.nextId++;
		const timeoutMs = opts.timeoutMs ?? 10000;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP command timed out (${timeoutMs}ms): ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	/** Subscribe to a CDP event method. Returns an unsubscribe function. */
	on(method: string, handler: (params: unknown) => void): () => void {
		let arr = this.eventHandlers.get(method);
		if (!arr) {
			arr = [];
			this.eventHandlers.set(method, arr);
		}
		arr.push(handler);
		return () => {
			const a = this.eventHandlers.get(method);
			if (a) {
				const i = a.indexOf(handler);
				if (i >= 0) a.splice(i, 1);
			}
		};
	}

	close(): void {
		this.closed = true;
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(new Error("CDP connection closed"));
		}
		this.pending.clear();
		try {
			this.ws.close();
		} catch {
			// ignore
		}
	}
}
