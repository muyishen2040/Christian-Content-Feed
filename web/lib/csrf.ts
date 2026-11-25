/** Same-origin check for cookie-authenticated mutations (POST, PUT, DELETE).
 * SameSite cookies are not relied on alone (docs/api-contracts.md). A request is trusted only if
 * its Origin header equals the origin the request was sent to; with no Origin header, only a
 * browser that states Sec-Fetch-Site: same-origin is accepted. Everything else is rejected. */
export function isTrustedMutation(request: Request): boolean {
  const target = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === target;
  return request.headers.get("sec-fetch-site") === "same-origin";
}
