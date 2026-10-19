import assert from "node:assert/strict";
import test from "node:test";
import { buildSubagentEnv } from "./subagent-env.ts";

test("child environment keeps runtime and provider variables but drops unrelated secrets", () => {
	const env = buildSubagentEnv({
		PATH: "/usr/bin",
		HOME: "/home/test",
		OPENAI_API_KEY: "provider-key",
		PI_CUSTOM_ENDPOINT: "https://pi.example",
		DATABASE_URL: "postgres://secret",
		AWS_SECRET_ACCESS_KEY: "aws-secret",
		RAP_SUBAGENT_DEPTH: "99",
	}, 2);
	assert.equal(env.PATH, "/usr/bin");
	assert.equal(env.OPENAI_API_KEY, "provider-key");
	assert.equal(env.PI_CUSTOM_ENDPOINT, "https://pi.example");
	assert.equal(env.AWS_SECRET_ACCESS_KEY, "aws-secret");
	assert.equal(env.DATABASE_URL, undefined);
	assert.equal(env.RAP_SUBAGENT_DEPTH, "2");
});
