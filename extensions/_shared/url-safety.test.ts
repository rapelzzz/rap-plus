import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHttpUrl } from "./url-safety.ts";

test("allows only absolute HTTP and HTTPS URLs", () => {
	assert.equal(normalizeHttpUrl("https://example.com/a"), "https://example.com/a");
	assert.equal(normalizeHttpUrl("http://example.com"), "http://example.com/");
	assert.equal(normalizeHttpUrl("file:///etc/passwd"), "");
	assert.equal(normalizeHttpUrl("javascript:alert(1)"), "");
	assert.equal(normalizeHttpUrl("not a URL"), "");
});
