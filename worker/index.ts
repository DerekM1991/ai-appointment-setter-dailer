/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleConversationUpgrade } from "./conversation";
import { handleTelnyxMediaUpgrade } from "./gemini-live";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  APP_BASE_URL?: string;
  APP_OWNER_EMAIL?: string;
  APP_ENCRYPTION_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_CALLS_PER_SECOND?: string;
  TWILIO_MAX_CONCURRENT_CALLS?: string;
  TELNYX_API_KEY?: string;
  TELNYX_CONNECTION_ID?: string;
  TELNYX_FROM_NUMBER?: string;
  TELNYX_PUBLIC_KEY?: string;
  TELNYX_CALLS_PER_SECOND?: string;
  TELNYX_MAX_CONCURRENT_CALLS?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  ELEVENLABS_PHONE_NUMBER_ID?: string;
  ELEVENLABS_WEBHOOK_SECRET?: string;
  ELEVENLABS_MAX_CONCURRENT_CALLS?: string;
  GEMINI_API_KEY?: string;
  GEMINI_LIVE_MODEL?: string;
  GEMINI_LIVE_VOICE?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_GROWTH?: string;
  STRIPE_PRICE_PRO?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/twilio/conversation") {
      return handleConversationUpgrade(request, env);
    }

    if (url.pathname === "/api/telnyx/media") {
      return handleTelnyxMediaUpgrade(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    return withSecurityHeaders(response);
  },
};

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("x-frame-options", "DENY");
  secured.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  secured.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  secured.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  secured.headers.set("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com");
  return secured;
}

export default worker;
