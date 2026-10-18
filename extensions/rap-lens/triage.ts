/**
 * Diagnostic triage store for rap-lens.
 *
 * Findings can be marked false-positive, suppressed, deferred, or
 * flagged-to-fix, and honored across surfaces. Optionally persisted to disk
 * so marks survive extension reloads. No Pi imports → unit-testable.
 */

import * as fs from "node:fs";

export type TriageMark = "falsePositive" | "suppressed" | "deferred" | "flagFix";

export interface TriageEntry {
	mark: TriageMark;
	reason: string;
	key: string;
}

/** Stable key for a diagnostic (file + line + message prefix). */
export function diagnosticKey(file: string, line: number, message: string): string {
	return `${file}:${line}:${message.slice(0, 60)}`;
}

export class TriageStore {
	private entries = new Map<string, TriageEntry>();
	private filePath: string | null = null;

	constructor(opts: { filePath?: string } = {}) {
		this.filePath = opts.filePath ?? null;
		if (this.filePath) this.restore();
	}

	mark(mark: TriageMark, key: string, reason = ""): void {
		this.entries.set(key, { mark, reason, key });
		this.persist();
	}

	get(key: string): TriageEntry | undefined {
		return this.entries.get(key);
	}

	clear(key: string): void {
		this.entries.delete(key);
		this.persist();
	}

	/** A diagnostic is "active" (should surface) unless marked false-positive or suppressed. */
	isActive(key: string): boolean {
		const e = this.entries.get(key);
		if (!e) return true;
		return e.mark === "deferred" || e.mark === "flagFix";
	}

	all(): TriageEntry[] {
		return [...this.entries.values()];
	}

	size(): number {
		return this.entries.size;
	}

	/** Persist current entries to the configured file (no-op if none). */
	persist(): void {
		if (!this.filePath) return;
		try {
			fs.writeFileSync(this.filePath, JSON.stringify(serializeTriage(this), null, 2), "utf8");
		} catch {
			/* ignore write errors (read-only fs, etc.) */
		}
	}

	/** Load entries from the configured file, replacing current entries. */
	restore(): void {
		if (!this.filePath) return;
		try {
			const raw = fs.readFileSync(this.filePath, "utf8");
			const arr = JSON.parse(raw) as TriageEntry[];
			this.entries.clear();
			for (const e of arr) this.entries.set(e.key, e);
		} catch {
			/* missing or corrupt: start empty */
		}
	}

	/** Attach a persistence file and load any existing marks from it. Idempotent:
	 * calling again with the same path does not reload. Used to wire per-project
	 * persistence from a tool handler that has the working directory. */
	attachFilePath(filePath: string): void {
		if (this.filePath === filePath) return;
		this.filePath = filePath;
		this.restore();
	}
}

/** Serialize a triage store to a plain object (for persistence). */
export function serializeTriage(store: TriageStore): TriageEntry[] {
	return store.all();
}
