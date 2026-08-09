export interface Env {
  DDNS_DB: D1Database;
  ASSETS: Fetcher;
  CLOUDFLARE_DNS_API_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ENVIRONMENT: string;
  APP_HOST: string;
  ALLOW_PRIVATE_IPS?: string;
  DETAILED_ERRORS?: string;
  ENABLE_UNIFI_COMPAT?: string;
}
