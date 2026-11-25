import {
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";

/** True for Auth failures that say nothing about the visitor's session: network errors, 409 (a
 * refresh that overlapped another one), 429 and 5xx. Callers must keep the session and ask the
 * visitor to retry, never treat these as "no session". */
export function isTemporaryAuthError(error: {
  status?: number;
  name?: string;
}): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  const status = error.status;
  if (status === undefined) return !isAuthSessionMissingError(error);
  return status === 0 || status === 409 || status === 429 || status >= 500;
}
