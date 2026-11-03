// Imported first by cli.ts, ahead of every provider SDK. A workflow passes an unset secret or variable as "",
// which providers read as a value: @ai-sdk/anthropic builds its default client when the module loads and throws
// on ANTHROPIC_BASE_URL="", and a blank AWS_BEARER_TOKEN_BEDROCK would replace the OIDC credentials with an
// empty key. ES modules evaluate in import order, so dropping them here runs before any SDK module does.

/** Every variable a provider reads its credentials or endpoint from. The workflow template passes each one. */
export const PROVIDER_ENV = ["STAMP_API_KEY", "STAMP_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "OPENCODE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "AI_GATEWAY_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"];

/** C0 controls and DEL: the bytes an HTTP header value cannot carry. */
const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * Drops blank variables and trims the rest, so a key pasted with its newline reaches the provider as a valid header.
 * A key holding a line break goes too, with the reason, and the missing-key path names the fix.
 */
export function dropBlankProviderEnv(): void {
  for (const k of [...PROVIDER_ENV, "CODEX_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) {
    const value = process.env[k]?.trim();

    if (value === undefined) continue;

    if (value === "") delete process.env[k];
    else if (hasControl(value)) {
      console.error(`${k} holds a line break or control character and cannot be sent as a header: ignoring it. Save the secret as one line.`);
      delete process.env[k];
    } else process.env[k] = value;
  }
}

dropBlankProviderEnv();
