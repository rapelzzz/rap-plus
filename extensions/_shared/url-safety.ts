/** Normalize a URL only when it uses HTTP(S); empty string means reject. */
export function normalizeHttpUrl(value: string): string {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
	} catch {
		return "";
	}
}
