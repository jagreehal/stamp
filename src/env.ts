// Imported first by cli.ts, ahead of every provider SDK. A workflow passes an unset secret or variable as "",
// which providers read as a value: @ai-sdk/anthropic builds its default client when the module loads and throws
// on ANTHROPIC_BASE_URL="", and a blank AWS_BEARER_TOKEN_BEDROCK would replace the OIDC credentials with an
// empty key. ES modules evaluate in import order, so dropping them here runs before any SDK module does.

/** Every variable a provider reads its credentials or endpoint from. The workflow template passes each one. */
export const PROVIDER_ENV = ["STAMP_API_KEY", "STAMP_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "OPENCODE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "AI_GATEWAY_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"];

export function dropBlankProviderEnv(): void {
  for (const k of PROVIDER_ENV) if (process.env[k] === "") delete process.env[k];
}

dropBlankProviderEnv();
