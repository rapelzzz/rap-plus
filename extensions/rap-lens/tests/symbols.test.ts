/**
 * rap-lens symbols.ts — symbol_search / module_report / read_symbol tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TsLanguageService } from "../lsp.ts";
import {
	symbolSearch,
	formatSymbolHits,
	moduleReport,
	readSymbol,
} from "../symbols.ts";

function makeProject(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-sym-"));
	fs.writeFileSync(
		path.join(dir, "items.ts"),
		[
			"export interface Item { id: number; name: string }",
			"export class Cart { items: Item[] = [] }",
			"export function addItem(cart: Cart, item: Item) { cart.items.push(item) }",
		].join("\n") + "\n",
	);
	return dir;
}

test("symbolSearch finds symbols by name across the project", () => {
	const dir = makeProject();
	try {
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		const hits = symbolSearch(svc, "Item", dir);
		assert.ok(hits.length >= 1, "should find Item symbols");
		const names = hits.map((h) => h.name);
		assert.ok(names.some((n) => n.includes("Item")));
		assert.equal(formatSymbolHits([], dir), "No symbols found.");
		assert.match(formatSymbolHits(hits, dir), /items\.ts:/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("symbolSearch empty query returns no hits", () => {
	const dir = makeProject();
	try {
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		assert.deepEqual(symbolSearch(svc, "", dir), []);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("moduleReport produces an outline for a file", () => {
	const dir = makeProject();
	try {
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		const report = moduleReport(svc, "items.ts", dir);
		assert.match(report, /Module outline/);
		assert.match(report, /Cart/);
		assert.match(report, /addItem/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("readSymbol returns name/type/source for a symbol", () => {
	const dir = makeProject();
	try {
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		// items.ts line 2: 'export class Cart { items: Item[] = [] }' — 'Cart' at col 13
		const sym = readSymbol(svc, "items.ts", 2, 13, dir);
		assert.ok(sym, "expected a symbol at Cart");
		if (sym) {
			assert.match(sym.type, /class/);
			assert.match(sym.name, /Cart/);
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("regex fallback works when no LanguageService is provided", () => {
	const dir = makeProject();
	try {
		const hits = symbolSearch(null, "Cart", dir);
		assert.ok(hits.length >= 1, "regex fallback should find Cart");
		assert.equal(hits[0].kind, "symbol");
		const report = moduleReport(null, "items.ts", dir);
		assert.match(report, /Module outline/);
		assert.match(report, /Cart/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("moduleReport and readSymbol refuse files outside the project root", () => {
	const dir = makeProject();
	const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-outside-"));
	const outsideFile = path.join(outsideDir, "secret.ts");
	fs.writeFileSync(outsideFile, "export const secret = 'not for project reads';\n");
	try {
		const svc = TsLanguageService.create(dir);
		assert.match(moduleReport(svc, outsideFile, dir), /refusing: path escapes project root/i);
		assert.equal(readSymbol(svc, outsideFile, 1, 14, dir), undefined);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(outsideDir, { recursive: true, force: true });
	}
});
