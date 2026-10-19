/** Allowlisted environment for delegated Pi processes. */
const CHILD_ENV_ALLOWLIST = new Set([
	"PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "NO_COLOR", "FORCE_COLOR", "CI",
	"XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
	"OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL",
	"XAI_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "COHERE_API_KEY",
	"FIREWORKS_API_KEY", "TOGETHER_API_KEY", "CEREBRAS_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
	"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION", "AZURE_OPENAI_API_VERSION", "OLLAMA_HOST", "OLLAMA_BASE_URL",
]);

/** Preserve runtime essentials and known provider configuration; never inherit arbitrary env secrets. */
export function buildSubagentEnv(
	source: Readonly<Record<string, string | undefined>>,
	depth: number,
): Record<string, string> {
	const child: Record<string, string> = {};
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined) continue;
		if (CHILD_ENV_ALLOWLIST.has(key) || key.startsWith("PI_")) child[key] = value;
	}
	child.RAP_SUBAGENT_DEPTH = String(depth);
	return child;
}
