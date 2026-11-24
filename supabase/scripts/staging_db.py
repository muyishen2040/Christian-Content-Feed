#!/usr/bin/env python3
"""Manage the hosted STAGING Supabase project through the Management API (HTTPS only).

Commands (migrate and seed-synthetic are dry runs unless --apply is given):
  status           show the target project (name, region, status). Read-only.
  migrate          apply pending files from supabase/migrations in order, recording each one.
  verify           run the access-rule checks (isolation, approved-only metadata, migration guard).
                   They run inside one request that always rolls back, so nothing is kept.
  seed-synthetic   insert the fictional seed from supabase/seed/staging_synthetic.sql (idempotent).
  verify-live      sign in anonymously and check the REST API; creates a staging user.

Safety rules:
- The access token comes only from SUPABASE_ACCESS_TOKEN. It is never printed or logged.
- The target project's name must contain "staging" and its ref must not be in PRODUCTION_PROJECT_REFS.
  Migration, seed and SQL verification also require the exact --confirm-name.
- There is no reset, drop or truncate command. `migrate` only appends unapplied migrations.
- verify-live requires a supplied public key; it never fetches keys from the Management API.

Standard library only. The token needs the permission to read the project and run database queries.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
TESTS = ROOT / "supabase" / "tests"
SEED = ROOT / "supabase" / "seed" / "staging_synthetic.sql"
API = "https://api.supabase.com"
SENTINEL = "VERIFY_OK"
_REF = re.compile(r"^[a-z]{20}$")
_MIGRATION_FILE = re.compile(r"^(\d{14})_([a-z0-9_]+)\.sql$")
_APPROVED_FIXTURES = {"00000000-0000-4000-8000-0000000000f1", "00000000-0000-4000-8000-0000000000f2"}
_DRAFT_FIXTURE = "00000000-0000-4000-8000-0000000000f3"


class StagingError(Exception):
    """A guard failed or the API refused. Messages never contain the token or response secrets."""


# ---------- transport ----------

class Api:
    """Minimal Management API client. `request` is injectable so tests never touch the network."""

    def __init__(self, token: str, request: Callable[..., object] | None = None) -> None:
        if not token:
            raise StagingError("SUPABASE_ACCESS_TOKEN is not set")
        self._token = token
        self._request = request or self._http

    def _http(self, method: str, url: str, body: dict | None = None, headers: dict | None = None):
        if not url.startswith("https://"):
            raise StagingError("only https URLs are used")
        data = json.dumps(body).encode() if body is not None else None
        h = {"Content-Type": "application/json", "User-Agent": "christian-content-feed-staging/0.1", **(headers or {})}
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (https checked above)
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise StagingError(f"HTTP {exc.code} from {url.split('?')[0]}: {_scrub(detail, self._token)[:500]}") from None
        except OSError as exc:
            raise StagingError(f"network error: {type(exc).__name__}") from None
        return json.loads(raw) if raw.strip() else None

    def call(self, method: str, path: str, body: dict | None = None):
        return self._request(method, API + path, body, {"Authorization": f"Bearer {self._token}"})


def _scrub(text: str, secret: str) -> str:
    return text.replace(secret, "[redacted]") if secret else text


def public_api_key(key: str | None) -> str:
    if not key:
        raise StagingError("no public key: pass --anon-key or set SUPABASE_ANON_KEY")
    if key.startswith("sb_publishable_") and len(key) > len("sb_publishable_"):
        return key
    try:
        _, payload, _ = key.split(".")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if isinstance(claims, dict) and claims.get("role") == "anon":
            return key
    except (ValueError, UnicodeDecodeError, binascii.Error):
        pass
    raise StagingError("invalid or secret key: provide a public publishable key or legacy anon key")


# ---------- guards ----------

def check_target(project: dict, ref: str, confirm_name: str | None, *, require_confirm: bool) -> str:
    """Return the project name, or raise. Used before every command; `require_confirm` for writes."""
    if not _REF.match(ref):
        raise StagingError("project ref must be 20 lowercase letters")
    blocked = {r.strip() for r in os.environ.get("PRODUCTION_PROJECT_REFS", "").split(",") if r.strip()}
    if ref in blocked:
        raise StagingError("this ref is listed in PRODUCTION_PROJECT_REFS; refusing")
    returned = project.get("id") or project.get("ref")
    if returned and returned != ref:
        raise StagingError("the API returned a different project than requested")
    name = str(project.get("name") or "")
    if "staging" not in name.lower():
        raise StagingError("project name does not contain 'staging'; refusing")
    if project.get("status") not in (None, "ACTIVE_HEALTHY"):
        raise StagingError(f"project status is {project.get('status')}, not ACTIVE_HEALTHY")
    if require_confirm and confirm_name != name:
        raise StagingError("--confirm-name must equal the project name exactly")
    return name


# ---------- SQL building ----------

def migration_files(directory: Path = MIGRATIONS) -> list[tuple[str, str, Path]]:
    out = []
    for p in sorted(directory.glob("*.sql")):
        m = _MIGRATION_FILE.match(p.name)
        if not m:
            raise StagingError(f"unexpected file name in migrations: {p.name}")
        out.append((m.group(1), m.group(2), p))
    return out


def _lit(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


TRACKING_SQL = (
    "CREATE SCHEMA IF NOT EXISTS supabase_migrations;\n"
    "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations "
    "(version text PRIMARY KEY, statements text[], name text);"
)


def rls_check_sql(rls_text: str) -> str:
    """The RLS integration test, made safe to run as one API request. Its own BEGIN stays (so the
    SET LOCAL ROLE statements work whether or not the API wraps the request in a transaction) and
    its final ROLLBACK is replaced by a sentinel error, so the transaction can never commit."""
    if not re.search(r"^\s*BEGIN;\s*$", rls_text, flags=re.M):
        raise StagingError("rls.sql no longer starts a transaction; update the runner")
    if re.search(r"^\s*COMMIT;", rls_text, flags=re.M):
        raise StagingError("rls.sql contains COMMIT; refusing to run it")
    body, n = re.subn(r"^\s*ROLLBACK;\s*$", f"DO $$ BEGIN RAISE EXCEPTION '{SENTINEL}'; END $$;", rls_text, flags=re.M)
    if n != 1:
        raise StagingError("rls.sql must end with exactly one ROLLBACK")
    return body


def guard_check_sql(migration_text: str) -> str:
    """Plain-SQL version of profile_migration_guard.sql: the encryption migration must refuse to run
    while a plaintext description exists, and must leave that row intact. Ends with the sentinel."""
    return f"""
DO $outer$
DECLARE msg text;
BEGIN
  ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS description text;
  INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000000c3',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
  INSERT INTO public.user_profiles (user_id, description)
  VALUES ('00000000-0000-4000-8000-0000000000c3', 'fictional migration fixture');
  BEGIN
    EXECUTE $mig${migration_text}$mig$;
    RAISE EXCEPTION 'guard did not fire' USING ERRCODE = 'XX001';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE 'Existing profile descriptions%' THEN
      RAISE EXCEPTION 'unexpected guard error' USING ERRCODE = 'XX002';
    END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles
      WHERE user_id = '00000000-0000-4000-8000-0000000000c3'
        AND description = 'fictional migration fixture') THEN
    RAISE EXCEPTION 'profile data was not preserved' USING ERRCODE = 'XX003';
  END IF;
  RAISE EXCEPTION '{SENTINEL}';
END $outer$;
"""


def run_check(run_sql: Callable[[str], object], sql: str, label: str) -> None:
    """Run a check whose success is the sentinel error. Anything else is a failure."""
    try:
        run_sql(sql)
    except StagingError as exc:
        if SENTINEL in str(exc):
            return
        raise StagingError(f"{label} FAILED: {str(exc)[:300]}") from None
    raise StagingError(f"{label}: finished without the success marker; treat as failed")


# ---------- commands ----------

def make_sql_runner(api: Api, ref: str) -> Callable[[str], object]:
    def run(sql: str):
        return api.call("POST", f"/v1/projects/{ref}/database/query", {"query": sql})
    return run


def applied_versions(run_sql: Callable[[str], object]) -> set[str]:
    run_sql(TRACKING_SQL)
    rows = run_sql("SELECT version FROM supabase_migrations.schema_migrations") or []
    return {r["version"] for r in rows}


def cmd_migrate(run_sql, apply: bool, directory: Path = MIGRATIONS, log=print) -> list[str]:
    done = applied_versions(run_sql) if apply else set()
    pending = [m for m in migration_files(directory) if m[0] not in done]
    if not apply:
        log(f"dry run: {len(pending)} migration(s) would be applied: " + ", ".join(f"{v}_{n}" for v, n, _ in pending))
        return [v for v, _, _ in pending]
    applied: list[str] = []
    for version, name, path in pending:
        text = path.read_text(encoding="utf-8")
        run_sql(text + f"\nINSERT INTO supabase_migrations.schema_migrations (version, name, statements) "
                       f"VALUES ({_lit(version)}, {_lit(name)}, ARRAY[]::text[]);")
        applied.append(version)
        log(f"applied {version}_{name}")
    if not applied:
        log("nothing to apply: every migration is already recorded")
    return applied


def cmd_verify(run_sql, log=print) -> None:
    run_check(run_sql, rls_check_sql((TESTS / "rls.sql").read_text(encoding="utf-8")), "access rules (rls.sql)")
    log("PASS access rules: isolation, approved-only metadata, revoked sources, service role")
    guard = guard_check_sql((MIGRATIONS / "20261116050000_encrypt_profile_descriptions.sql").read_text(encoding="utf-8"))
    run_check(run_sql, guard, "plaintext migration guard")
    log("PASS migration guard: refuses to drop a plaintext description and preserves it")
    left = run_sql("SELECT count(*)::int AS n FROM auth.users WHERE id IN "
                   "('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b2',"
                   "'00000000-0000-4000-8000-0000000000c3')")
    if left and left[0]["n"] != 0:
        raise StagingError("verify left test users behind: the rollback did not happen")
    log("PASS cleanup: the checks left no test rows behind")


def cmd_seed(run_sql, apply: bool, log=print) -> None:
    sql = SEED.read_text(encoding="utf-8")
    if not apply:
        log(f"dry run: would run {SEED.name} ({len(sql.splitlines())} lines, fictional data only)")
        return
    run_sql(sql)
    log("synthetic seed applied (idempotent: reruns change nothing)")


def cmd_verify_live(api: Api, ref: str, log=print, request: Callable[..., object] | None = None,
                    anon_key: str | None = None) -> None:
    """Anonymous sign-in plus REST reads with the public anon key. Never uses privileged keys.
    The public key must be passed explicitly; the all-keys endpoint is never read."""
    anon = public_api_key(anon_key)
    base = f"https://{ref}.supabase.co"
    http = request or Api(anon)._http
    h = {"apikey": anon}
    session = http("POST", base + "/auth/v1/signup", {}, h)  # anonymous sign-in (empty body)
    if not session or not session.get("access_token"):
        raise StagingError("anonymous sign-in failed; run enable-anonymous-auth in the dashboard first")
    user_h = {"apikey": anon, "Authorization": f"Bearer {session['access_token']}"}
    fixture_ids = ",".join(sorted(_APPROVED_FIXTURES | {_DRAFT_FIXTURE}))
    rows = http("GET", base + f"/rest/v1/published_testimonies?select=id&id=in.({fixture_ids})", None, user_h)
    visible = {str(r.get("id", "")) for r in rows or []}
    if _DRAFT_FIXTURE in visible:
        raise StagingError("synthetic draft is visible to an anonymous user")
    if not _APPROVED_FIXTURES.issubset(visible):
        raise StagingError("approved synthetic fixtures missing; run seed-synthetic first")
    draft = http("GET", base + f"/rest/v1/testimonies?select=id&id=eq.{_DRAFT_FIXTURE}", None, user_h)
    if not isinstance(draft, list) or draft:
        raise StagingError("synthetic draft may be visible in the testimonies table")
    for table, col in (("testimonies", "body"), ("sources", "private_import_notes"), ("user_profiles", "description_ciphertext")):
        try:
            leaked = http("GET", f"{base}/rest/v1/{table}?select={col}&limit=1", None, user_h)
        except StagingError as exc:
            if "HTTP 401" in str(exc) or "HTTP 403" in str(exc):
                continue
            raise
        raise StagingError(f"anonymous user could read {table}.{col}: {type(leaked).__name__}")
    for table in ("feedback", "saved_testimonies", "feed_events"):
        mine = http("GET", f"{base}/rest/v1/{table}?select=user_id", None, user_h)
        if mine:
            raise StagingError(f"new anonymous user sees existing rows in {table}")
    log("PASS live: approved fixtures visible, draft hidden, no private columns or existing user rows visible")


# ---------- CLI ----------

def main(argv: list[str] | None = None, api: Api | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", choices=["status", "migrate", "verify", "seed-synthetic", "verify-live"])
    ap.add_argument("--project-ref", required=True, help="20-letter project ref of the staging project")
    ap.add_argument("--confirm-name", help="exact project name; required with --apply and for verify")
    ap.add_argument("--apply", action="store_true", help="actually write (migrate, seed-synthetic)")
    ap.add_argument("--anon-key", help="the project's PUBLIC anon/publishable key, for verify-live (never a secret key)")
    args = ap.parse_args(argv)

    writes = (args.command in {"migrate", "seed-synthetic"} and args.apply) or args.command == "verify"
    try:
        api = api or Api(os.environ.get("SUPABASE_ACCESS_TOKEN", ""))
        project = api.call("GET", f"/v1/projects/{args.project_ref}") or {}
        name = check_target(project, args.project_ref, args.confirm_name, require_confirm=writes)
        print(f"target: {name} ({project.get('region', '?')}, {project.get('status', '?')})")
        run_sql = make_sql_runner(api, args.project_ref)
        if args.command == "migrate":
            cmd_migrate(run_sql, args.apply)
        elif args.command == "verify":
            cmd_verify(run_sql)
        elif args.command == "seed-synthetic":
            cmd_seed(run_sql, args.apply)
        elif args.command == "verify-live":
            anon = public_api_key(args.anon_key or os.environ.get("SUPABASE_ANON_KEY"))
            cmd_verify_live(api, args.project_ref, anon_key=anon)
    except StagingError as exc:
        print(f"REFUSED/FAILED: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
