/**
 * Diagnostic triage store for rap-lens.
 *
 * Behavioral target: `pi-lens` `lens_diagnostic_mark` — findings can be marked
 * false-positive, suppressed, deferred, or flagged-to-fix, and honored across
 * surfaces. Pure (no Pi imports) → unit-testable.
 */

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

	mark(mark: TriageMark, key: string, reason = ""): void {
		this.entries.set(key, { mark, reason, key });
	}

	get(key: string): TriageEntry | undefined {
		return this.entries.get(key);
	}

	clear(key: string): void {
		this.entries.delete(key);
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
}

/** Serialize a triage store to a plain object (for persistence). */
export function serializeTriage(store: TriageStore): TriageEntry[] {
	return store.all();
}
