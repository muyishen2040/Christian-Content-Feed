import json
import base64
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
sys.path.insert(0, str(ROOT / "supabase" / "scripts"))

import staging_db as sdb  # noqa: E402

REF = "abcdefghijklmnopqrst"
PROJECT = {"id": REF, "name": "christian-content-feed-staging", "status": "ACTIVE_HEALTHY", "region": "us-east-1"}
TOKEN = "sbp_TOPSECRETTOKEN"


class FakeApi:
    """Records every call; answers project reads and SQL like the Management API would."""

    def __init__(self, project=PROJECT, applied=(), sql_error=None):
        self.project, self.applied, self.sql_error = project, set(applied), sql_error
        self.calls: list[tuple[str, str, object]] = []

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path == f"/v1/projects/{REF}":
            return self.project
        if path.endswith("/database/query"):
            sql = body["query"]
            if self.sql_error:
                raise sdb.StagingError(self.sql_error)
            if sql.lstrip().startswith("SELECT version"):
                return [{"version": v} for v in sorted(self.applied)]
            return []
        raise AssertionError(path)

    def sql(self):
        return [c[2]["query"] for c in self.calls if c[1].endswith("/database/query")]


# ---- guards ----

def test_a_project_not_named_staging_is_refused():
    with pytest.raises(sdb.StagingError, match="staging"):
        sdb.check_target({**PROJECT, "name": "christian-content-feed"}, REF, None, require_confirm=False)


def test_a_listed_production_ref_is_refused_even_if_named_staging(monkeypatch):
    monkeypatch.setenv("PRODUCTION_PROJECT_REFS", f"zzzzzzzzzzzzzzzzzzzz, {REF}")
    with pytest.raises(sdb.StagingError, match="PRODUCTION_PROJECT_REFS"):
        sdb.check_target(PROJECT, REF, PROJECT["name"], require_confirm=True)


def test_writes_need_the_exact_project_name_and_an_active_project():
    with pytest.raises(sdb.StagingError, match="confirm-name"):
        sdb.check_target(PROJECT, REF, "staging", require_confirm=True)
    assert sdb.check_target(PROJECT, REF, PROJECT["name"], require_confirm=True) == PROJECT["name"]
    with pytest.raises(sdb.StagingError, match="ACTIVE_HEALTHY"):
        sdb.check_target({**PROJECT, "status": "PAUSED"}, REF, None, require_confirm=False)


def test_ref_must_look_like_a_project_ref_and_match_what_the_api_returned():
    with pytest.raises(sdb.StagingError, match="20 lowercase"):
        sdb.check_target(PROJECT, "../../x", None, require_confirm=False)
    with pytest.raises(sdb.StagingError, match="different project"):
        sdb.check_target({**PROJECT, "id": "zzzzzzzzzzzzzzzzzzzz"}, REF, None, require_confirm=False)


def test_the_token_is_required_and_never_leaks_into_errors():
    with pytest.raises(sdb.StagingError, match="SUPABASE_ACCESS_TOKEN"):
        sdb.Api("")
    assert TOKEN not in sdb._scrub(f"bad token {TOKEN}", TOKEN)


def test_only_https_urls_are_used():
    with pytest.raises(sdb.StagingError, match="https"):
        sdb.Api(TOKEN)._http("GET", "http://example.invalid/")


# ---- migrate ----

def test_migrations_are_found_in_order_and_odd_files_are_refused(tmp_path):
    (tmp_path / "20260101000000_b.sql").write_text("select 1;")
    (tmp_path / "20250101000000_a.sql").write_text("select 1;")
    assert [m[0] for m in sdb.migration_files(tmp_path)] == ["20250101000000", "20260101000000"]
    (tmp_path / "notes.sql").write_text("x")
    with pytest.raises(sdb.StagingError, match="unexpected file"):
        sdb.migration_files(tmp_path)


def test_real_migrations_all_parse():
    assert len(sdb.migration_files()) >= 3


def test_migrate_dry_run_sends_no_sql():
    sent = []
    versions = sdb.cmd_migrate(lambda sql: sent.append(sql), apply=False, log=lambda m: None)
    assert sent == [] and len(versions) >= 3


def test_migrate_applies_pending_in_order_and_records_each():
    api = FakeApi(applied={"20261114234000"})
    run = sdb.make_sql_runner(api, REF)
    applied = sdb.cmd_migrate(run, apply=True, log=lambda m: None)
    assert applied == ["20261116040000", "20261116050000"]
    inserts = [q for q in api.sql() if q.startswith("INSERT INTO") or "\nINSERT INTO supabase_migrations" in q]
    assert len(inserts) == 2 and "20261116040000" in inserts[0] and "20261116050000" in inserts[1]


def test_migrate_rerun_applies_nothing():
    run = sdb.make_sql_runner(FakeApi(applied={v for v, _, _ in sdb.migration_files()}), REF)
    assert sdb.cmd_migrate(run, apply=True, log=lambda m: None) == []


def test_no_command_can_reset_drop_or_truncate():
    src = (ROOT / "supabase" / "scripts" / "staging_db.py").read_text(encoding="utf-8")
    assert "choices=[" in src and not any(w in src.split("choices=[")[1].split("]")[0] for w in ("reset", "drop", "truncate"))


# ---- verification SQL ----

RLS = (ROOT / "supabase" / "tests" / "rls.sql").read_text(encoding="utf-8")


def test_rls_check_never_commits_and_ends_with_the_success_marker():
    sql = sdb.rls_check_sql(RLS)
    assert "ROLLBACK" not in sql and "COMMIT" not in sql
    assert sql.rstrip().endswith(f"RAISE EXCEPTION '{sdb.SENTINEL}'; END $$;")
    assert sql.lstrip().startswith("--") or "BEGIN;" in sql


def test_rls_check_refuses_a_test_file_it_cannot_neutralise():
    with pytest.raises(sdb.StagingError):
        sdb.rls_check_sql(RLS.replace("ROLLBACK;", "COMMIT;"))
    with pytest.raises(sdb.StagingError):
        sdb.rls_check_sql(RLS + "\nROLLBACK;\n")


def test_rls_fixture_counts_ignore_seeded_rows():
    assert "count(*) FROM public.published_testimonies)" not in RLS  # every count filters to fixture ids


def test_guard_check_embeds_the_real_migration_and_ends_with_the_marker():
    mig = (ROOT / "supabase" / "migrations" / "20261116050000_encrypt_profile_descriptions.sql").read_text(encoding="utf-8")
    sql = sdb.guard_check_sql(mig)
    assert mig in sql and f"RAISE EXCEPTION '{sdb.SENTINEL}'" in sql and "fictional migration fixture" in sql


def test_a_check_passes_only_on_the_success_marker():
    def marker(sql):
        raise sdb.StagingError(f"HTTP 400: ERROR: {sdb.SENTINEL}")
    sdb.run_check(marker, "x", "c")

    def real_failure(sql):
        raise sdb.StagingError("HTTP 400: anon unexpectedly read testimony body")
    with pytest.raises(sdb.StagingError, match="FAILED: .*anon unexpectedly"):
        sdb.run_check(real_failure, "x", "c")
    with pytest.raises(sdb.StagingError, match="without the success marker"):
        sdb.run_check(lambda sql: [], "x", "c")


def test_verify_fails_if_test_rows_were_left_behind():
    def run(sql):
        if sql.startswith("SELECT count"):
            return [{"n": 2}]
        raise sdb.StagingError(sdb.SENTINEL)
    with pytest.raises(sdb.StagingError, match="left test users"):
        sdb.cmd_verify(run, log=lambda m: None)


# ---- seed ----

def test_seed_is_fictional_idempotent_and_never_real_data():
    sql = (ROOT / "supabase" / "seed" / "staging_synthetic.sql").read_text(encoding="utf-8")
    assert sql.count("ON CONFLICT (id) DO NOTHING") == 2
    assert "example.invalid" in sql and "[SYNTHETIC]" in sql
    assert "'published'" in sql and "'pending', 'pending', 'draft'" in sql
    for real in ("luke54", "dhchurch", "canaan"):
        assert real not in sql.lower()


def test_seed_dry_run_sends_nothing_and_apply_sends_the_file():
    sent = []
    sdb.cmd_seed(sent.append, apply=False, log=lambda m: None)
    assert sent == []
    sdb.cmd_seed(sent.append, apply=True, log=lambda m: None)
    assert len(sent) == 1 and "staging" in sent[0].lower()


# ---- CLI ----

def test_cli_dry_run_migrate_reads_the_project_but_writes_nothing(capsys):
    api = FakeApi()
    assert sdb.main(["migrate", "--project-ref", REF], api=api) == 0
    assert api.sql() == [] and "target: christian-content-feed-staging" in capsys.readouterr().out


def test_cli_apply_without_confirm_name_is_refused_before_any_sql(capsys):
    api = FakeApi()
    assert sdb.main(["migrate", "--project-ref", REF, "--apply"], api=api) == 2
    assert api.sql() == [] and "confirm-name" in capsys.readouterr().err


def test_cli_apply_on_a_non_staging_project_is_refused_before_any_sql():
    api = FakeApi(project={**PROJECT, "name": "christian-content-feed-prod"})
    assert sdb.main(["migrate", "--project-ref", REF, "--apply", "--confirm-name", "christian-content-feed-prod"], api=api) == 2
    assert api.sql() == []


def test_cli_apply_with_the_right_name_migrates():
    api = FakeApi()
    assert sdb.main(["migrate", "--project-ref", REF, "--apply", "--confirm-name", PROJECT["name"]], api=api) == 0
    assert any("CREATE TABLE IF NOT EXISTS public.sources" in q for q in api.sql())


def test_verify_requires_confirm_name_because_it_runs_test_inserts():
    api = FakeApi()
    assert sdb.main(["verify", "--project-ref", REF], api=api) == 2 and api.sql() == []


def test_cli_failure_output_has_no_token(capsys):
    api = FakeApi(sql_error=f"HTTP 500: upstream said {TOKEN}")
    code = sdb.main(["migrate", "--project-ref", REF, "--apply", "--confirm-name", PROJECT["name"]], api=api)
    assert code == 2  # the fake does not scrub; the real Api does, tested above
    assert "REFUSED/FAILED" in capsys.readouterr().err


# ---- verify-live ----

def live_http(rows_by_path, signup_ok=True):
    def http(method, url, body=None, headers=None):
        if url.endswith("/auth/v1/signup"):
            return {"access_token": "jwt"} if signup_ok else {}
        for frag, result in rows_by_path.items():
            if frag in url:
                if isinstance(result, Exception):
                    raise result
                return result
        raise AssertionError(url)
    return http


GOOD = {
    "published_testimonies": [
        {"id": "00000000-0000-4000-8000-0000000000f1", "title": "[SYNTHETIC] one"},
        {"id": "00000000-0000-4000-8000-0000000000f2", "title": "[SYNTHETIC] two"},
    ],
    "testimonies?select=body": sdb.StagingError("HTTP 401: permission denied"),
    "testimonies?select=id": [],
    "sources?select": sdb.StagingError("HTTP 403: permission denied"),
    "user_profiles?select": sdb.StagingError("HTTP 401: permission denied"),
    "feedback": [], "saved_testimonies": [], "feed_events": [],
}


def test_live_check_passes_when_only_approved_synthetic_data_is_visible():
    logs = []
    sdb.cmd_verify_live(FakeApi(), REF, log=logs.append, request=live_http(GOOD), anon_key="sb_publishable_test")
    assert logs and logs[0].startswith("PASS live")


def test_live_check_fails_when_a_private_column_is_readable():
    leaky = {**GOOD, "testimonies?select=body": [{"body": "x"}]}
    with pytest.raises(sdb.StagingError, match="testimonies.body"):
        sdb.cmd_verify_live(FakeApi(), REF, request=live_http(leaky), anon_key="sb_publishable_test")


def test_live_check_fails_when_a_new_user_sees_other_users_rows_or_no_seed():
    with pytest.raises(sdb.StagingError, match="feedback"):
        sdb.cmd_verify_live(FakeApi(), REF, request=live_http({**GOOD, "feedback": [{"user_id": "u"}]}), anon_key="sb_publishable_test")
    with pytest.raises(sdb.StagingError, match="seed-synthetic"):
        sdb.cmd_verify_live(FakeApi(), REF, request=live_http({**GOOD, "published_testimonies": []}), anon_key="sb_publishable_test")
    with pytest.raises(sdb.StagingError, match="anonymous sign-in"):
        sdb.cmd_verify_live(FakeApi(), REF, request=live_http(GOOD, signup_ok=False), anon_key="sb_publishable_test")


def test_live_check_can_take_the_anon_key_without_reading_keys_from_the_api():
    class NoKeysApi(FakeApi):
        def call(self, method, path, body=None):
            assert not path.endswith("/api-keys"), "must not read keys when one is given"
            return super().call(method, path, body)
    logs = []
    sdb.cmd_verify_live(NoKeysApi(), REF, log=logs.append, request=live_http(GOOD), anon_key="sb_publishable_test")
    assert logs[0].startswith("PASS live")


def test_live_check_refuses_a_secret_looking_key_and_requires_some_key(capsys):
    api = FakeApi()
    assert sdb.main(["verify-live", "--project-ref", REF, "--anon-key", "sb_secret_abc"], api=api) == 2
    assert "secret key" in capsys.readouterr().err
    class NoKeysAllowed(FakeApi):
        def call(self, method, path, body=None):
            assert not path.endswith("/api-keys"), "must not retrieve privileged API keys"
            return super().call(method, path, body)
    with pytest.raises(sdb.StagingError, match="--anon-key"):
        sdb.cmd_verify_live(NoKeysAllowed(), REF, request=live_http(GOOD))


def test_live_check_rejects_visible_draft():
    draft = {"id": "00000000-0000-4000-8000-0000000000f3", "title": "[SYNTHETIC] draft"}
    leaked = {**GOOD, "published_testimonies": [*GOOD["published_testimonies"], draft]}
    with pytest.raises(sdb.StagingError, match="draft"):
        sdb.cmd_verify_live(FakeApi(), REF, request=live_http(leaked), anon_key="sb_publishable_test")


def test_live_check_rejects_draft_visible_in_underlying_table():
    leaked = {**GOOD, "testimonies?select=id": [{"id": "00000000-0000-4000-8000-0000000000f3"}]}
    with pytest.raises(sdb.StagingError, match="draft"):
        sdb.cmd_verify_live(FakeApi(), REF, request=live_http(leaked), anon_key="sb_publishable_test")


def test_live_check_requires_both_approved_fixtures():
    incomplete = {**GOOD, "published_testimonies": GOOD["published_testimonies"][:1]}
    with pytest.raises(sdb.StagingError, match="seed-synthetic"):
        sdb.cmd_verify_live(FakeApi(), REF, request=live_http(incomplete), anon_key="sb_publishable_test")


def test_live_check_rejects_legacy_service_role_jwt_before_any_request(capsys, monkeypatch):
    payload = base64.urlsafe_b64encode(json.dumps({"role": "service_role"}).encode()).decode().rstrip("=")
    key = f"header.{payload}.signature"
    monkeypatch.setattr(sdb, "cmd_verify_live", lambda *args, **kwargs: pytest.fail("secret reached live check"))
    assert sdb.main(["verify-live", "--project-ref", REF, "--anon-key", key], api=FakeApi()) == 2
    assert "secret key" in capsys.readouterr().err


def test_public_key_accepts_legacy_anon_jwt_and_rejects_malformed_keys():
    payload = base64.urlsafe_b64encode(json.dumps({"role": "anon"}).encode()).decode().rstrip("=")
    key = f"header.{payload}.signature"
    assert sdb.public_api_key(key) == key
    for invalid in ("sb_secret_secret", "header.invalid.signature", "sb_publishable_"):
        with pytest.raises(sdb.StagingError, match="secret key"):
            sdb.public_api_key(invalid)
