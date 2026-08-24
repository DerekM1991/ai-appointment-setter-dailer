declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    APP_BASE_URL?: string;
    APP_OWNER_EMAIL?: string;
    APP_ENCRYPTION_KEY?: string;
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_FROM_NUMBER?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    MICROSOFT_CLIENT_ID?: string;
    MICROSOFT_CLIENT_SECRET?: string;
    MICROSOFT_TENANT_ID?: string;
  }
}
