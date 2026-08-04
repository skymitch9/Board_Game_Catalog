import type { AppUser } from '@bgc/core';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  APP_VERSION: string;
  ENVIRONMENT: string;

  /** Comma-separated emails seeded as `owner` on first sign-in. */
  OWNER_EMAILS: string;

  /** e.g. "yourteam.cloudflareaccess.com" */
  CF_ACCESS_TEAM_DOMAIN: string;
  /** The Access application's AUD tag. */
  CF_ACCESS_AUD: string;

  /**
   * BoardGameGeek application token. BGG began requiring registration and
   * bearer tokens on its XML API in July 2025, so lookup is unavailable until
   * this is set. Stored as a secret (`wrangler secret put BGG_API_TOKEN`),
   * never in wrangler.toml.
   */
  BGG_API_TOKEN?: string;

  /**
   * Local development only. Ignored unless ENVIRONMENT is "development", so a
   * stray value in production vars can never bypass Access.
   */
  DEV_EMAIL?: string;
}

/** Values attached to the request context by middleware. */
export interface Variables {
  user: AppUser;
}

export type AppBindings = { Bindings: Env; Variables: Variables };

export function parseOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
