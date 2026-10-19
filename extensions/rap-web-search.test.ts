import test from "node:test";
import assert from "node:assert/strict";
import { isSafeExternalUrl } from "./rap-web-search.ts";

test("web content extraction rejects private, local, and non-HTTP URLs", async () => {
	for (const value of [
		"file:///etc/passwd",
		"ftp://example.com/file",
		"http://localhost/",
		"http://service.local/",
		"http://192.168.1.20/",
		"http://10.2.3.4/",
		"http://127.0.0.1/",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/",
		"http://[2002::1]/",
		"http://[2001:0::1]/",
		"http://user:pass@example.com/",
	]) {
		assert.equal(await isSafeExternalUrl(value), false, value);
	}
});
