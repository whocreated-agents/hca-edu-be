#!/usr/bin/env bash
# =============================================================================
# tools/usage-guard/check-usage.sh
# Zero-token dual-provider fleet usage guard (Anthropic Claude + Google Gemini)
#
# Purpose:
#   1. Reads local Claude Code usage cache (~/.claude.json -> cachedUsageUtilization)
#      at zero LLM token cost, stripping all account/OAuth identifiers.
#   2. Queries Paperclip control-plane telemetry (window-spend, heartbeat-runs)
#      when PAPERCLIP_API_URL + PAPERCLIP_API_KEY are set (unless --offline).
#   3. Evaluates pre-emptive 90% brake + 70% hysteresis disarm + Both-or-Both
#      fleet gate rule across Anthropic and Google cohorts.
#   4. Emits machine-readable JSON and distinct exit codes per verdict:
#        0 = ok       (both providers clear, cache fresh, below warn thresholds)
#        1 = warn     (approaching limit: session >= 75% or weekly >= 80%)
#        2 = critical (GATED: >= 90% limit, >= 1160c 5h spend, or active quota error)
#        3 = stale    (local cache older than MAX_CACHE_AGE_SECONDS without live override)
#        4 = unknown  (missing/malformed cache file or unreadable state)
#
# Usage:
#   tools/usage-guard/check-usage.sh [options]
#
# Options:
#   --claude-json <path>      Path to .claude.json (default: ~/.claude.json)
#   --max-age <seconds>       Staleness threshold in seconds (default: 1800)
#   --warn-session <pct>      Session warn threshold % (default: 75)
#   --crit-session <pct>      Session critical/arm threshold % (default: 90)
#   --warn-weekly <pct>       Weekly warn threshold % (default: 80)
#   --crit-weekly <pct>       Weekly critical/arm threshold % (default: 90)
#   --disarm-pct <pct>        Hysteresis disarm threshold % (default: 70)
#   --ceiling-5h-cents <c>    Calibrated Anthropic 5h ceiling cents (default: 1289)
#   --offline                 Skip Paperclip API queries (local disk check only)
#   --sync-state              Write updated state to WHO-10 usage-guard-state doc
#   --enforce                 Execute zero-LLM escalation/brake or scheduled resume
#   --help                    Show this help message
# =============================================================================

set -euo pipefail

CLAUDE_JSON_PATH="${CLAUDE_CONFIG_PATH:-${HOME}/.claude.json}"
MAX_CACHE_AGE_SECONDS="${MAX_CACHE_AGE_SECONDS:-1800}"
WARN_SESSION_PCT="${WARN_SESSION_PCT:-75}"
CRIT_SESSION_PCT="${CRIT_SESSION_PCT:-90}"
WARN_WEEKLY_PCT="${WARN_WEEKLY_PCT:-80}"
CRIT_WEEKLY_PCT="${CRIT_WEEKLY_PCT:-90}"
DISARM_PCT="${DISARM_PCT:-70}"
CEILING_5H_CENTS="${CEILING_5H_CENTS:-1289}"
OFFLINE_MODE="false"
SYNC_STATE="false"
ENFORCE_MODE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --claude-json)
      CLAUDE_JSON_PATH="${2:-}"
      shift 2
      ;;
    --max-age)
      MAX_CACHE_AGE_SECONDS="${2:-1800}"
      shift 2
      ;;
    --warn-session)
      WARN_SESSION_PCT="${2:-75}"
      shift 2
      ;;
    --crit-session)
      CRIT_SESSION_PCT="${2:-90}"
      shift 2
      ;;
    --warn-weekly)
      WARN_WEEKLY_PCT="${2:-80}"
      shift 2
      ;;
    --crit-weekly)
      CRIT_WEEKLY_PCT="${2:-90}"
      shift 2
      ;;
    --disarm-pct)
      DISARM_PCT="${2:-70}"
      shift 2
      ;;
    --ceiling-5h-cents)
      CEILING_5H_CENTS="${2:-1289}"
      shift 2
      ;;
    --offline)
      OFFLINE_MODE="true"
      shift
      ;;
    --sync-state)
      SYNC_STATE="true"
      shift
      ;;
    --enforce)
      ENFORCE_MODE="true"
      shift
      ;;
    -h|--help)
      sed -n '2,38p' "$0"
      exit 0
      ;;
    *)
      echo "{\"verdict\":\"unknown\",\"exit_code\":4,\"error\":\"Unknown argument: $1\"}"
      exit 4
      ;;
  esac
done

export CLAUDE_JSON_PATH
export MAX_CACHE_AGE_SECONDS
export WARN_SESSION_PCT
export CRIT_SESSION_PCT
export WARN_WEEKLY_PCT
export CRIT_WEEKLY_PCT
export DISARM_PCT
export CEILING_5H_CENTS
export OFFLINE_MODE
export SYNC_STATE
export ENFORCE_MODE

python3 - <<'PYEOF'
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

EXIT_OK = 0
EXIT_WARN = 1
EXIT_CRITICAL = 2
EXIT_STALE = 3
EXIT_UNKNOWN = 4

claude_json_path = os.environ.get("CLAUDE_JSON_PATH", os.path.expanduser("~/.claude.json"))
try:
    max_age_sec = int(os.environ.get("MAX_CACHE_AGE_SECONDS", "1800"))
    warn_session_pct = float(os.environ.get("WARN_SESSION_PCT", "75"))
    crit_session_pct = float(os.environ.get("CRIT_SESSION_PCT", "90"))
    warn_weekly_pct = float(os.environ.get("WARN_WEEKLY_PCT", "80"))
    crit_weekly_pct = float(os.environ.get("CRIT_WEEKLY_PCT", "90"))
    disarm_pct = float(os.environ.get("DISARM_PCT", "70"))
    ceiling_5h_cents = float(os.environ.get("CEILING_5H_CENTS", "1289"))
except ValueError as exc:
    print(json.dumps({
        "verdict": "unknown",
        "exit_code": EXIT_UNKNOWN,
        "error": f"Invalid numeric threshold configuration: {exc}"
    }, indent=2))
    sys.exit(EXIT_UNKNOWN)

offline_mode = os.environ.get("OFFLINE_MODE", "false").lower() == "true"
sync_state = os.environ.get("SYNC_STATE", "false").lower() == "true"
enforce_mode = os.environ.get("ENFORCE_MODE", "false").lower() == "true"

now_ts = time.time()
now_iso = datetime.fromtimestamp(now_ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

arm_at_cents = round(ceiling_5h_cents * (crit_session_pct / 100.0))
disarm_below_cents = round(ceiling_5h_cents * (disarm_pct / 100.0))

def parse_iso(ts_str):
    if not ts_str or not isinstance(ts_str, str):
        return None
    try:
        cleaned = ts_str.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned).timestamp()
    except Exception:
        return None

def api_request(method, path, payload=None, token_override=None):
    base_url = os.environ.get("PAPERCLIP_API_URL", "").rstrip("/")
    if base_url.endswith("/api"):
        base_url = base_url[:-4]
    api_key = token_override or os.environ.get("PAPERCLIP_API_KEY", "")
    if not base_url or not api_key:
        return None, "missing_api_credentials"
    url = f"{base_url}{path}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    run_id = os.environ.get("PAPERCLIP_RUN_ID", "")
    if run_id:
        headers["X-Paperclip-Run-Id"] = run_id
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            return (json.loads(body) if body else {}), None
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8")
        except Exception:
            pass
        return None, f"http_{e.code}:{err_body[:200]}"
    except Exception as e:
        return None, str(e)

# ---------------------------------------------------------------------------
# 1. Read local Claude Code usage cache (~/.claude.json)
#    SECURITY RULE: Never read, store, or output oauthAccount, accountUuid,
#    email, tokens, or any PII. Extract ONLY utilization & limit fields.
# ---------------------------------------------------------------------------
local_claude = {
    "source_file": claude_json_path,
    "available": False,
    "cache_age_seconds": None,
    "fetched_at_iso": None,
    "is_stale": True,
    "max_cache_age_seconds": max_age_sec,
    "five_hour": None,
    "seven_day": None,
    "active_limits": [],
    "extra_usage": None,
    "extra_usage_disabled_reason": None,
    "surface_consumption_share_note": (
        "seven_day_breakdown.rows represents share-of-usage across surfaces "
        "(e.g. claude_code vs chat), NOT share-of-limit, and is excluded from cap calculations."
    ),
    "error": None,
}

if not os.path.isfile(claude_json_path):
    local_claude["error"] = f"File not found: {claude_json_path}"
else:
    try:
        with open(claude_json_path, "r", encoding="utf-8") as fh:
            raw_doc = json.load(fh)
        if not isinstance(raw_doc, dict):
            raise ValueError("Root JSON value is not an object")
        cu = raw_doc.get("cachedUsageUtilization")
        if not isinstance(cu, dict):
            raise ValueError("Missing or invalid 'cachedUsageUtilization' object")
        fetched_ms = cu.get("fetchedAtMs")
        if not isinstance(fetched_ms, (int, float)) or fetched_ms <= 0:
            raise ValueError("Missing or invalid 'fetchedAtMs'")
        util = cu.get("utilization")
        if not isinstance(util, dict):
            raise ValueError("Missing or invalid 'utilization' object")

        fetched_sec = fetched_ms / 1000.0
        cache_age_sec = max(0, int(round(now_ts - fetched_sec)))
        fetched_iso = datetime.fromtimestamp(fetched_sec, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        fh_obj = util.get("five_hour") or {}
        sd_obj = util.get("seven_day") or {}
        if not isinstance(fh_obj.get("utilization"), (int, float)) or not isinstance(sd_obj.get("utilization"), (int, float)):
            raise ValueError("Missing numeric five_hour.utilization or seven_day.utilization")

        limits_clean = []
        for lim in (util.get("limits") or []):
            if isinstance(lim, dict):
                limits_clean.append({
                    "kind": lim.get("kind"),
                    "group": lim.get("group"),
                    "percent": lim.get("percent"),
                    "severity": lim.get("severity"),
                    "resets_at": lim.get("resets_at"),
                    "is_active": bool(lim.get("is_active")),
                })

        extra_obj = util.get("extra_usage") or {}
        local_claude.update({
            "available": True,
            "cache_age_seconds": cache_age_sec,
            "fetched_at_iso": fetched_iso,
            "is_stale": cache_age_sec > max_age_sec,
            "five_hour": {
                "percent": fh_obj.get("utilization"),
                "resets_at": fh_obj.get("resets_at"),
            },
            "seven_day": {
                "percent": sd_obj.get("utilization"),
                "resets_at": sd_obj.get("resets_at"),
            },
            "active_limits": limits_clean,
            "extra_usage": {
                "is_enabled": bool(extra_obj.get("is_enabled")),
                "user_disabled": bool(extra_obj.get("user_disabled")),
                "spend_limit_reached": bool(extra_obj.get("spend_limit_reached")),
            },
            "extra_usage_disabled_reason": raw_doc.get("cachedExtraUsageDisabledReason"),
        })
    except Exception as exc:
        local_claude["error"] = f"Malformed .claude.json usage cache: {exc}"

# ---------------------------------------------------------------------------
# 2. Query Paperclip Control Plane (if credentials present and not --offline)
# ---------------------------------------------------------------------------
company_id = os.environ.get("PAPERCLIP_COMPANY_ID", "")
control_plane = {
    "queried": False,
    "anthropic_5h_cents": None,
    "anthropic_24h_cents": None,
    "anthropic_7d_cents": None,
    "anthropic_5h_tokens": None,
    "google_5h_input_tokens": None,
    "google_5h_output_tokens": None,
    "google_5h_cents": None,
    "anthropic_last_quota_failure_at": None,
    "google_last_quota_failure_at": None,
    "google_last_success_or_running_at": None,
    "error": None,
}

if not offline_mode and company_id and os.environ.get("PAPERCLIP_API_URL") and os.environ.get("PAPERCLIP_API_KEY"):
    control_plane["queried"] = True
    ws_data, ws_err = api_request("GET", f"/api/companies/{company_id}/costs/window-spend")
    if isinstance(ws_data, list):
        g_in_5h = 0
        g_out_5h = 0
        g_cents_5h = 0.0
        for row in ws_data:
            prov = row.get("provider")
            win = row.get("window")
            if prov == "anthropic" and win == "5h":
                control_plane["anthropic_5h_cents"] = round(float(row.get("costCents", 0.0)), 2)
                control_plane["anthropic_5h_tokens"] = {
                    "input": row.get("inputTokens", 0),
                    "cached_input": row.get("cachedInputTokens", 0),
                    "output": row.get("outputTokens", 0),
                }
            elif prov == "anthropic" and win == "24h":
                control_plane["anthropic_24h_cents"] = round(float(row.get("costCents", 0.0)), 2)
            elif prov == "anthropic" and win == "7d":
                control_plane["anthropic_7d_cents"] = round(float(row.get("costCents", 0.0)), 2)
            elif prov in ("acpx", "google") and win == "5h":
                g_in_5h += int(row.get("inputTokens", 0) or 0)
                g_out_5h += int(row.get("outputTokens", 0) or 0)
                g_cents_5h += float(row.get("costCents", 0.0) or 0.0)
        control_plane["google_5h_input_tokens"] = g_in_5h
        control_plane["google_5h_output_tokens"] = g_out_5h
        control_plane["google_5h_cents"] = round(g_cents_5h, 2)
    else:
        control_plane["error"] = f"window-spend query failed: {ws_err}"

    runs_data, runs_err = api_request("GET", f"/api/companies/{company_id}/heartbeat-runs?limit=50")
    if isinstance(runs_data, list):
        for r in runs_data:
            status = r.get("status")
            err_code = r.get("errorCode")
            err_txt = r.get("error") or ""
            uj = r.get("usageJson") or {}
            prov = uj.get("provider")
            ts = r.get("finishedAt") or r.get("startedAt")
            if err_code == "provider_quota":
                if not control_plane["anthropic_last_quota_failure_at"] or (ts and ts > control_plane["anthropic_last_quota_failure_at"]):
                    control_plane["anthropic_last_quota_failure_at"] = ts
            elif err_code == "acpx_turn_failed" and "exhausted your daily quota" in err_txt.lower():
                if not control_plane["google_last_quota_failure_at"] or (ts and ts > control_plane["google_last_quota_failure_at"]):
                    control_plane["google_last_quota_failure_at"] = ts
            elif prov in ("google", "acpx") and status in ("succeeded", "running"):
                in_tok = int(uj.get("inputTokens", 0) or 0)
                if status == "succeeded" or in_tok > 0:
                    if not control_plane["google_last_success_or_running_at"] or (ts and ts > control_plane["google_last_success_or_running_at"]):
                        control_plane["google_last_success_or_running_at"] = ts

# ---------------------------------------------------------------------------
# 3. Evaluate Anthropic Provider Verdict & State
# ---------------------------------------------------------------------------
if not local_claude["available"]:
    out = {
        "timestamp": now_iso,
        "provider": "dual (anthropic + google)",
        "verdict": "unknown",
        "exit_code": EXIT_UNKNOWN,
        "error": local_claude["error"],
        "anthropic": local_claude,
        "control_plane": control_plane,
    }
    print(json.dumps(out, indent=2))
    sys.exit(EXIT_UNKNOWN)

fh_pct = float(local_claude["five_hour"]["percent"])
fh_resets_at = local_claude["five_hour"]["resets_at"]
fh_resets_ts = parse_iso(fh_resets_at)

sd_pct = float(local_claude["seven_day"]["percent"])
sd_resets_at = local_claude["seven_day"]["resets_at"]
sd_resets_ts = parse_iso(sd_resets_at)

fh_reset_passed = (fh_resets_ts is not None and now_ts >= fh_resets_ts)

anth_reasons = []
anth_verdict = "ok"

if not fh_reset_passed and fh_pct >= crit_session_pct:
    anth_verdict = "critical"
    anth_reasons.append(f"session (five_hour) utilization {fh_pct:.0f}% >= {crit_session_pct:.0f}% (resets_at {fh_resets_at})")

if sd_pct >= crit_weekly_pct:
    anth_verdict = "critical"
    anth_reasons.append(f"weekly (seven_day) utilization {sd_pct:.0f}% >= {crit_weekly_pct:.0f}% (resets_at {sd_resets_at})")

cp_5h = control_plane.get("anthropic_5h_cents")
if cp_5h is not None and cp_5h >= arm_at_cents:
    if local_claude["is_stale"] or not fh_reset_passed or fh_pct >= disarm_pct:
        anth_verdict = "critical"
        anth_reasons.append(
            f"control-plane 5h spend {cp_5h:.2f}c >= {arm_at_cents}c (90% of {ceiling_5h_cents:.0f}c calibrated ceiling)"
        )

if anth_verdict != "critical":
    if not fh_reset_passed and fh_pct >= warn_session_pct:
        anth_verdict = "warn"
        anth_reasons.append(f"session (five_hour) utilization {fh_pct:.0f}% >= {warn_session_pct:.0f}% warn threshold")
    if sd_pct >= warn_weekly_pct:
        anth_verdict = "warn"
        anth_reasons.append(f"weekly (seven_day) utilization {sd_pct:.0f}% >= {warn_weekly_pct:.0f}% warn threshold")

anth_can_disarm = (
    (fh_reset_passed or fh_pct < disarm_pct)
    and sd_pct < crit_weekly_pct
    and (cp_5h is None or cp_5h < disarm_below_cents or (not local_claude["is_stale"] and fh_pct < disarm_pct))
)

# ---------------------------------------------------------------------------
# 4. Evaluate Google / Gemini Provider Verdict & State
# ---------------------------------------------------------------------------
google_verdict = "ok"
google_reasons = []
g_fail_ts = parse_iso(control_plane.get("google_last_quota_failure_at"))
g_succ_ts = parse_iso(control_plane.get("google_last_success_or_running_at"))

if g_fail_ts is not None:
    if g_succ_ts is None or g_fail_ts > g_succ_ts:
        google_verdict = "critical"
        google_reasons.append(
            f"reactive daily quota exhaustion (acpx_turn_failed at {control_plane['google_last_quota_failure_at']}) with no subsequent successful run"
        )
    else:
        google_reasons.append(
            f"recovered from earlier quota exhaustion ({control_plane['google_last_quota_failure_at']}); verified active/succeeded run at {control_plane['google_last_success_or_running_at']}"
        )
else:
    google_reasons.append("no recent acpx_turn_failed quota errors in heartbeat-runs")

google_status = {
    "cohort": ["CDO", "CEO", "FE", "Designer", "SSE", "Architect"],
    "detection_mode": "reactive_only",
    "metered_cost": False,
    "metering_gap": (
        "gemini_local runs report costCents=0 and outputTokens=0 in window-spend "
        "(inputTokens are recorded under provider='google' as of 2026-10-25T14:59Z, "
        "but no quota denominator or output token count exists for a 90% pre-emptive brake)."
    ),
    "verdict": google_verdict,
    "reasons": google_reasons,
    "last_quota_failure_at": control_plane.get("google_last_quota_failure_at"),
    "last_active_or_succeeded_at": control_plane.get("google_last_success_or_running_at"),
    "window_5h_input_tokens": control_plane.get("google_5h_input_tokens"),
}

# ---------------------------------------------------------------------------
# 5. Combine into Overall Verdict + Both-or-Both Fleet Gate
# ---------------------------------------------------------------------------
both_or_both_gated = (anth_verdict == "critical") or (google_verdict == "critical")

if both_or_both_gated:
    overall_verdict = "critical"
    exit_code = EXIT_CRITICAL
elif local_claude["is_stale"]:
    overall_verdict = "stale"
    exit_code = EXIT_STALE
elif anth_verdict == "warn" or google_verdict == "warn":
    overall_verdict = "warn"
    exit_code = EXIT_WARN
else:
    overall_verdict = "ok"
    exit_code = EXIT_OK

next_wake_at = None
if anth_verdict == "critical":
    if sd_pct >= crit_weekly_pct and sd_resets_at:
        next_wake_at = sd_resets_at
    elif fh_resets_at:
        next_wake_at = fh_resets_at

enforcement_actions = []

# Optional --sync-state: update WHO-10 usage-guard-state document if API available
if (sync_state or enforce_mode) and control_plane["queried"]:
    issues_res, _ = api_request("GET", f"/api/companies/{company_id}/issues?q=WHO-10")
    who10_id = None
    if isinstance(issues_res, list):
        for iss in issues_res:
            if iss.get("identifier") == "WHO-10":
                who10_id = iss.get("id")
                break
    if who10_id:
        doc_cur, doc_err = api_request("GET", f"/api/issues/{who10_id}/documents/usage-guard-state")
        base_rev = doc_cur.get("latestRevisionId") if isinstance(doc_cur, dict) else None
        state_json_block = {
            "gateState": "GATED" if both_or_both_gated else "CLEAR",
            "gatedReason": "; ".join(anth_reasons + google_reasons),
            "updatedAt": now_iso,
            "updatedByTool": "tools/usage-guard/check-usage.sh (WHO-9)",
            "armPercent": int(crit_session_pct),
            "disarmPercent": int(disarm_pct),
            "nextScheduledWakeAt": next_wake_at,
            "providers": {
                "anthropic": {
                    "cohort": ["Orchestrator", "CTO", "Staff SDE", "BE"],
                    "signal": "local ~/.claude.json cachedUsageUtilization + costs/window-spend[5h]",
                    "metered": True,
                    "localFiveHourPercent": fh_pct,
                    "localFiveHourResetsAt": fh_resets_at,
                    "localSevenDayPercent": sd_pct,
                    "localSevenDayResetsAt": sd_resets_at,
                    "localCacheAgeSeconds": local_claude["cache_age_seconds"],
                    "ceiling5hCents": int(ceiling_5h_cents),
                    "armAtCents": arm_at_cents,
                    "disarmBelowCents": disarm_below_cents,
                    "observed5hCents": cp_5h,
                    "observed24hCents": control_plane.get("anthropic_24h_cents"),
                    "state": "armed_critical" if anth_verdict == "critical" else anth_verdict,
                    "lastLimitAt": control_plane.get("anthropic_last_quota_failure_at") or "2026-10-25T14:11:34Z",
                    "lastLimitErrorCode": "provider_quota",
                    "ceilingSamples": [
                        {"at": "2026-10-24T22:37:17Z", "window5hCents": 1288.6, "kind": "breach"},
                        {"at": "2026-10-25T13:18:32Z", "window5hCents": 1347.01, "kind": "no_breach_counter_sample"},
                        {"at": "2026-10-25T13:26:37Z", "window5hCents": 2156.76, "kind": "breach", "localFiveHourPercent": 100, "resetsAt": fh_resets_at}
                    ]
                },
                "google": {
                    "cohort": ["CDO", "CEO", "FE", "Designer", "SSE", "Architect"],
                    "billedAsProvider": "google (formerly acpx)",
                    "signal": "heartbeat-runs errorCode=acpx_turn_failed + inputTokens activity check",
                    "metered": False,
                    "window5hInputTokens": control_plane.get("google_5h_input_tokens"),
                    "state": "clear" if google_verdict == "ok" else "limited",
                    "lastFailureAt": control_plane.get("google_last_quota_failure_at"),
                    "lastActiveOrSucceededAt": control_plane.get("google_last_success_or_running_at"),
                    "successfulRunSinceOutage": (google_verdict == "ok")
                }
            }
        }
        md_body = (
            "# Usage-guard state\n\n"
            "Machine-readable state maintained by `tools/usage-guard/check-usage.sh --sync-state` (WHO-9) and routine `c68ad281` (WHO-10).\n\n"
            f"**Current state: `{'GATED' if both_or_both_gated else 'CLEAR'}`** (Updated `{now_iso}`)\n\n"
            "```json\n"
            + json.dumps(state_json_block, indent=2)
            + "\n```\n"
        )
        put_payload = {"title": "Usage-guard state", "format": "markdown", "body": md_body}
        if base_rev:
            put_payload["baseRevisionId"] = base_rev
        put_res, put_err = api_request("PUT", f"/api/issues/{who10_id}/documents/usage-guard-state", payload=put_payload)
        enforcement_actions.append(f"sync_state_who10:{'ok' if put_res else put_err}")

if enforce_mode and control_plane["queried"]:
    board_token = os.environ.get("PAPERCLIP_BOARD_API_KEY", "")
    if both_or_both_gated and board_token:
        who2_res, _ = api_request("GET", f"/api/companies/{company_id}/issues?q=WHO-2")
        who2_id = next((i.get("id") for i in (who2_res or []) if i.get("identifier") == "WHO-2"), None)
        if who2_id:
            th_res, th_err = api_request(
                "POST",
                f"/api/issues/{who2_id}/tree-holds",
                payload={"mode": "pause", "releasePolicy": {"strategy": "after_active_runs_finish"}},
                token_override=board_token,
            )
            enforcement_actions.append(f"tree_hold_pause:{'ok' if th_res else th_err}")
    elif both_or_both_gated:
        enforcement_actions.append(
            "agent_token_cannot_pause:403_board_access_required (gate=GATED recorded; withhold new dispatches until next_scheduled_wake_at)"
        )
    else:
        # Both providers verified CLEAR -> safe to auto-resume limit-stalled issues in dependency order
        enforcement_actions.append("both_providers_clear:ready_for_dependency_ordered_resume")

result = {
    "timestamp": now_iso,
    "provider": "anthropic+google",
    "verdict": overall_verdict,
    "exit_code": exit_code,
    "cache_age_seconds": local_claude["cache_age_seconds"],
    "cache_is_stale": local_claude["is_stale"],
    "max_cache_age_seconds": max_age_sec,
    "active_limits": local_claude["active_limits"],
    "resets_at": {
        "five_hour": fh_resets_at,
        "seven_day": sd_resets_at,
        "next_scheduled_wake": next_wake_at,
    },
    "fleet_gate": {
        "policy": "both_or_both",
        "state": "GATED" if both_or_both_gated else "CLEAR",
        "arm_percent": crit_session_pct,
        "disarm_percent": disarm_pct,
        "anthropic_clear": (anth_verdict != "critical" and anth_can_disarm),
        "google_clear": (google_verdict != "critical"),
        "next_scheduled_wake_at": next_wake_at,
        "reasons": anth_reasons + google_reasons,
    },
    "anthropic": {
        "cohort": ["Orchestrator", "CTO", "Staff SDE", "BE"],
        "verdict": anth_verdict,
        "reasons": anth_reasons,
        "five_hour": local_claude["five_hour"],
        "seven_day": local_claude["seven_day"],
        "extra_usage": local_claude["extra_usage"],
        "extra_usage_disabled_reason": local_claude["extra_usage_disabled_reason"],
        "calibrated_5h_ceiling_cents": ceiling_5h_cents,
        "arm_at_5h_cents": arm_at_cents,
        "disarm_below_5h_cents": disarm_below_cents,
        "observed_5h_cents": cp_5h,
        "observed_24h_cents": control_plane.get("anthropic_24h_cents"),
    },
    "google": google_status,
    "enforcement_actions": enforcement_actions,
}

print(json.dumps(result, indent=2))
sys.exit(exit_code)
PYEOF
