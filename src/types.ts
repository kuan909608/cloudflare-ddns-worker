export interface Env {
  DDNS_DB: D1Database;
  ASSETS: Fetcher;
  DDNS_PREAUTH_RATE_LIMITER: RateLimit;
  DDNS_CLIENT_RATE_LIMITER: RateLimit;
  ADMIN_RATE_LIMITER: RateLimit;
  CLOUDFLARE_DNS_API_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ENVIRONMENT: string;
  APP_HOST: string;
  DNS_ZONE_ID: string;
  ALLOW_PRIVATE_IPS?: string;
  DETAILED_ERRORS?: string;
  ENABLE_UNIFI_COMPAT?: string;
  LOG_RETENTION_DAYS?: string;
}
