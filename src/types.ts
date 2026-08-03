export interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DDNS_DB: D1Database;
  ASSETS: Fetcher;
  DDNS_PREAUTH_RATE_LIMITER?: RateLimitBinding;
  DDNS_RATE_LIMITER?: RateLimitBinding;
  ADMIN_RATE_LIMITER?: RateLimitBinding;
  CLOUDFLARE_DNS_API_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_ALLOWED_EMAILS: string;
  ENVIRONMENT: string;
  DDNS_HOST: string;
  ADMIN_HOST: string;
  ALLOW_PRIVATE_IPS?: string;
  DETAILED_ERRORS?: string;
  ENABLE_UNIFI_COMPAT?: string;
}
