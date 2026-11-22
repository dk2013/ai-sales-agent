// All settings come from environment variables (.env), with local defaults.
function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

export const config = {
  databaseUrl: env("DATABASE_URL", "postgres://agent:agent@localhost:5434/agent"),
  openaiApiKey: env("OPENAI_API_KEY"),
  openaiModel: env("OPENAI_MODEL", "gpt-4o-mini"),
  knowledgeUrl: env("KNOWLEDGE_URL"),
  knowledgeToken: env("KNOWLEDGE_TOKEN"), // service token accepted by the RAG assistant (skips its per-IP limit)
  appUrl: env("APP_URL", "http://localhost:3002"),
  oidcIssuer: env("OIDC_ISSUER", "http://localhost:8081/realms/routewise"),
  oidcClientId: env("OIDC_CLIENT_ID", "ai-sales-agent"),
  oidcClientSecret: env("OIDC_CLIENT_SECRET"),
  sessionSecret: env("SESSION_SECRET"),
  maxToolSteps: Number(env("MAX_TOOL_STEPS", "8")),
  timeZone: env("BUSINESS_TIME_ZONE", "America/Toronto"),
  // Public demo protection (off by default)
  demoMode: env("DEMO_MODE", "false") === "true",
  dailyRunLimit: Number(env("DAILY_RUN_LIMIT", "0")),
};
