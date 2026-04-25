function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * API base for fetch calls.
 * - Dev: defaults to Vite base path (proxy /api to local backend)
 * - Prod: set VITE_API_BASE_URL to target backend URL
 */
export const API_BASE =
  trimTrailingSlash(import.meta.env.VITE_API_BASE_URL || "") ||
  trimTrailingSlash(import.meta.env.BASE_URL || "");

