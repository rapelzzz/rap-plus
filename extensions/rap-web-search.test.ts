import assert from "node:assert/strict";
import test from "node:test";
import { resolveResultUrl } from "./rap-web-search.ts";

test("web search result URL resolver rejects non-HTTP schemes", () => {
	assert.equal(resolveResultUrl("file:///etc/passwd"), "");
	assert.equal(resolveResultUrl("javascript:alert(1)"), "");
	assert.equal(
		resolveResultUrl("https://duckduckgo.com/l/?uddg=file%3A%2F%2F%2Fetc%2Fpasswd"),
		"",
	);
	assert.equal(resolveResultUrl("https://example.com/path"), "https://example.com/path");
});
