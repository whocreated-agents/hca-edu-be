# Runbook: Fleet Usage Limits — Token-Free Detection, Pre-Emptive Brake & Scheduled Resume (WHO-9)

- **Owner**: Principal Architect (`5a22aa5c-1d79-4d00-aafc-2e53b605b5ea`)
- **Scope**: Organization-wide agent fleet governance (`anthropic` + `google`/`acpx` cohorts)
- **Tooling**: [`tools/usage-guard/check-usage.sh`](../tools/usage-guard/check-usage.sh)
- **Canonical State Store**: `usage-guard-state` document on issue `WHO-10` (`aa89a45d-2afb-4a51-8db4-0969861766c8`)
- **Supersedes**: Interim Paperclip LLM routine `c68ad281-9358-4e8a-b24e-2a923bd917b6` (`WHO-10` / `WHO-11`)

---

## 1. Executive Summary & Design Constraint

Polling provider usage via an LLM-backed Paperclip routine every 10–15 minutes spawns ~96–144 agent heartbeats per day, burning the exact token budget the guard exists to protect.

**Architecture Rule**:
1. **Zero-Token Detection**: Every periodic check runs as a pure host script (`tools/usage-guard/check-usage.sh`) using local disk state (`~/.claude.json`) and lightweight REST calls (`costs/window-spend`, `heartbeat-runs`) with **zero LLM invocations**.
2. **Pre-Emptive Brake at 90%**: Work pauses gracefully at **>= 90%** of quota (allowing in-flight runs to finish while starting no new runs) rather than crashing mid-task at 100%.
3. **Both-or-Both Cohort Gate**: Because engineering and design workflows span both providers, if **either** Anthropic or Google is limited, **both** cohorts pause (`GATED`). The gate releases (`CLEAR`) only when **both** cohorts pass hysteresis checks (< 70% utilization/spend and post-reset verification).
4. **Scheduled Wake Over Blind Polling**: Anthropic exposes an exact ISO-8601 `resets_at` timestamp in `~/.claude.json`. Instead of polling with LLM turns, schedule a single wake at `resets_at`.

### Fleet Cohorts

| Cohort | Adapter / Biller | Assigned Agents | Primary Quota Signal |
|---|---|---|---|
| **Anthropic** | `claude_local` (`anthropic` subscription, `claude_pro`) | Orchestrator (`e40df024`), CTO (`10ed03b3`), Staff SDE (`fbec6f06`), BE (`e53d259f`) | **Predictive (90% brake)**: Local `~/.claude.json` `cachedUsageUtilization` + Paperclip `costs/window-spend[5h]` |
| **Google / Gemini** | `gemini_local` (`google` / `acpx`) | CDO (`3099c0bc`), CEO (`51298352`), FE (`b0d9b0ff`), Designer (`4b2fc52a`), SSE (`f980d7cf`), Architect (`5a22aa5c`) | **Reactive-only**: Paperclip `heartbeat-runs` `errorCode == "acpx_turn_failed"` (`"exhausted your daily quota"`) |

---

## 2. Verified Provider Findings

### 2.1 Anthropic Claude (`claude_local` / `claude_pro`)
1. **No CLI subcommand**: `claude --help` exposes no non-interactive usage flag; `/usage` is interactive-only.
2. **Zero-token disk cache (`~/.claude.json`)**: Claude Code writes `cachedUsageUtilization` to `/Users/hemantkumar/.claude.json`:
   - `.utilization.five_hour.utilization` (int `0..100`) and `.utilization.five_hour.resets_at` (exact ISO-8601 UTC timestamp, e.g. `2026-10-25T17:50:00.380250+00:00`).
   - `.utilization.seven_day.utilization` (int `0..100`) and `.utilization.seven_day.resets_at` (ISO-8601 UTC timestamp, e.g. `2026-10-28T13:59:59.754277+00:00`).
   - `.utilization.limits[]`: structured entries for `session` (`five_hour`) and `weekly_all` (`seven_day`) with `percent`, `severity`, `resets_at`, and `is_active`.
   - `.utilization.extra_usage`: `is_enabled: false`, `user_disabled: true`, `cachedExtraUsageDisabledReason: "org_level_disabled"`. **There is no paid overflow** — reaching 100% is a hard stop.
   - `.fetchedAtMs`: epoch milliseconds when the cache was written.
3. **Critical Anti-Conflation Rule (`seven_day_breakdown.rows[]`)**:
   - `.utilization.seven_day_breakdown.rows[]` reports **share of consumption by surface** (e.g. `claude_code: 94%`, `cowork: 5%`, `chat: 1%`), **NOT** percentage of the weekly quota cap. `check-usage.sh` explicitly ignores `seven_day_breakdown` for threshold decisions.
4. **Why `.claude.json` `resets_at` Beats `heartbeat-runs[].error` Prose Parsing**:
   - In live `heartbeat-runs` (`2026-10-25T13:26Z`–`14:11Z`), Paperclip's secret redactor masked digits inside the error string because a 2-digit number matched an environment secret substring:
     `You've hit your session limit · resets ***REDACTED******REDACTED***:2***REDACTED***pm (Asia/Calcutta)`
   - Meanwhile, `~/.claude.json` stored the unredacted UTC timestamp `2026-10-25T17:49:59.598837+00:00` (`11:20pm Asia/Calcutta`). Always prefer `~/.claude.json` `resets_at` over regex-parsing `heartbeat-runs[].error`.
5. **Control-Plane Spend Calibration (`costs/window-spend` & `costs/by-provider`)**:
   - Breach Sample 1 (`2026-10-24T22:37:17Z`): `provider_quota` hit at **1288.6 cents** rolling 5h spend.
   - Counter-Sample (`2026-10-25T13:18:32Z`): 5h window reached **1347.01 cents** without breach.
   - Breach Sample 2 (`2026-10-25T13:26:37Z`, run `c65c5b5b`): `provider_quota` hit at **2008.49 cents** pre-run (**2156.76 cents** post-run; `815,699` input tokens, `21,480,914` cached input tokens, `279,083` output tokens), coinciding with `.claude.json` `five_hour.utilization = 100%`.
   - **Rule**: Because imputed list-price cents vary with model mix (`opus` vs `sonnet-5-5`) and cache hit ratio, keep the **minimum observed breach (`1289c`)** as the fallback 5h ceiling (arm at `90% = 1160c`, disarm below `70% = 900c`) whenever `.claude.json` is stale.

### 2.2 Google Gemini (`gemini_local` / `google` & `acpx`)
1. **No CLI or Local Quota Cache**:
   - Verified `gemini --help` has no usage, quota, or rate-limit subcommand/flag.
   - Inspected `/Users/hemantkumar/.gemini/` (`config/config.json`, `antigravity-acp/settings.json`, `antigravity/`); no local file records remaining quota or reset timestamps.
2. **Control-Plane Metering Gap**:
   - Runs prior to `2026-10-25T14:59Z` billed under `provider: "acpx"` recorded `0 cents`, `0 inputTokens`, and `0 outputTokens`.
   - Starting `2026-10-25T14:59Z` (run `526908d6`), `gemini_local` runs record `provider: "google", biller: "google"` with real `inputTokens` (`522,571` in the 5h window), **but** `outputTokens: 0`, `costCents: 0`, and no quota denominator is exposed.
   - **Conclusion**: Gemini **cannot** have a genuine 90% pre-emptive brake until `gemini_local` adapter metering records output tokens/costs AND a daily quota denominator is calibrated. Do not synthesize a fake percentage.
3. **Reactive Detection & Sticky `errorReason` Hazard**:
   - Gemini quota exhaustion surfaces in `GET /api/companies/{c}/heartbeat-runs` as `errorCode == "acpx_turn_failed"` with `error == "You have exhausted your daily quota on this model."`.
   - **Sticky `errorReason` Trap**: On `GET /api/companies/{c}/agents`, `agent.errorReason` remains `"You have exhausted your daily quota on this model."` even after the quota resets and the agent is actively `running` or `succeeded` (verified at `2026-10-25T15:24Z` on Architect `5a22aa5c` and Designer `4b2fc52a`).
   - **Verification Rule**: `check-usage.sh` compares the timestamp of the latest `acpx_turn_failed` (daily quota) against the latest `succeeded` (or active `running` with `inputTokens > 0`) Google run in `heartbeat-runs`. If a newer run succeeded/processed tokens, the Google cohort is marked `ok` (`clear`).

---

## 3. Recommended Threshold Table & Cost-of-Error Analysis

| Signal / Dimension | `ok` (Exit `0`) | `warn` (Exit `1`) | `critical` / Brake Arm (Exit `2`) | Hysteresis Disarm (`CLEAR`) | Reasoning & Tradeoff |
|---|---|---|---|---|---|
| **Anthropic 5h Session (`five_hour.utilization`)** | `< 75%` | `75% – 89%` | **`>= 90%`** | **`< 70%`** (or `now >= resets_at`) | A single heavy coding heartbeat consumes ~8–15% of the 5h window. Arming at 90% leaves headroom for in-flight runs to write their `continuation-summary` and exit cleanly. |
| **Anthropic 7d Weekly (`seven_day.utilization`)** | `< 80%` | `80% – 89%` | **`>= 90%`** | **`< 85%`** (after weekly `resets_at`) | Weekly cap has no paid overflow (`extra_usage` disabled). Hitting 100% mid-week halts the Anthropic cohort for days. |
| **Anthropic 5h Spend Proxy (`window-spend[5h]`)** | `< 965c` | `965c – 1159c` | **`>= 1160c`** (`90%` of `1289c` min breach) | **`< 900c`** (`70%` of `1289c`) | Protects the fleet during periods when `~/.claude.json` is stale or written on another session. |
| **Google / Gemini (`heartbeat-runs`)** | No unrecovered `acpx_turn_failed` | N/A (unmetered) | **Active `acpx_turn_failed`** (`daily quota`) | Post-outage `succeeded` run (or daily reset passed) | Prevents retry storms (e.g. SSE burning 3 consecutive runs in 3 minutes into an exhausted wall). |
| **Local Cache Staleness (`cache_age_seconds`)** | `<= 1800s` (30m) | N/A | N/A (`stale` = **Exit `3`**) | Fresh read `<= 1800s` | A 2.5h-old cache reading `45%` can mask a real `95%` utilization. Fails loudly with exit `3` (`stale`) when not already overridden by a live `critical` signal. |
| **Missing / Corrupt File** | Valid JSON | N/A | N/A (`unknown` = **Exit `4`**) | Valid JSON | Never silently report `ok` when `~/.claude.json` is missing or malformed. |

### Cost of Being Wrong in Each Direction

1. **Stopping Too Early (False Positive — e.g., braking at 60–70% of Weekly or using a too-low Cents Ceiling)**:
   - **Session (5h) impact**: Low-to-moderate (loses at most 1–2 hours of throughput before the rolling 5h window decays).
   - **Weekly (7d) impact**: **High**. Anthropic subscription capacity does not roll over past `seven_day.resets_at`. Braking too early on the 7-day window wastes paid subscription capacity and stalls both cohorts under the Both-or-Both rule for days.
   - **Mitigation**: Use exact `.claude.json` `seven_day.utilization` (`>= 90%` critical) rather than 7-day imputed cents, and only use the `1160c` spend proxy on the short `5h` rolling window.
2. **Stopping Too Late (False Negative — e.g., waiting for 100% failure or trusting a stale cache)**:
   - **In-flight work impact**: **High**. A run killed mid-turn by `provider_quota` or `acpx_turn_failed` before committing code or updating its `continuation-summary` leaves dirty workspace state, triggers up to 3 automatic Paperclip retries into a dead wall, and forces the issue into `blocked` (`issue_recovery_action_restored` over-budget lock).
   - **Cross-cohort drift**: If one cohort crashes at 100% while the other continues unchecked, dependent contracts/designs drift out of sync (as observed on `2026-10-24`).

---

## 4. Stop, Escalation & Auto-Resume Protocol

### 4.1 What Is Already Automatic vs. What Is Not

| Capability | Status | Mechanism |
|---|---|---|
| **In-run state handoff (`continuation-summary`)** | **Already Automatic** | Paperclip automatically persists the `continuation-summary` document on every run and injects it into the next run's handoff payload. Agents do **not** need a custom state-serializer. |
| **Token-free limit & staleness detection** | **Implemented (`WHO-9`)** | `tools/usage-guard/check-usage.sh` reads `~/.claude.json` + Paperclip REST APIs at zero token cost. |
| **Canonical state persistence (`usage-guard-state`)** | **Implemented (`WHO-9`)** | `tools/usage-guard/check-usage.sh --sync-state` updates the `usage-guard-state` document on `WHO-10` via `PUT /api/issues/{who10Id}/documents/usage-guard-state`. |
| **Agent-initiated hard pause (`pause` / `tree-holds`)** | **Blocked by `403 Board access required`** | `POST /api/agents/{id}/pause`, `POST /api/issues/{id}/tree-holds`, `POST /api/companies/{c}/budgets/policies`, and `GET /api/companies/{c}/costs/quota-windows` reject agent bearer tokens (`403 Board access required`). Must be executed by a host job holding board credentials (`PAPERCLIP_BOARD_API_KEY`) or in the runner before dispatch. |
| **Agent-initiated auto-resume (`PATCH issue`, `resume`, `wakeup`)** | **Agent-Permitted & Implemented** | `PATCH /api/issues/{id}`, `POST /api/agents/{id}/resume`, and `POST /api/agents/{id}/wakeup` succeed with agent credentials. |

### 4.2 Escalation Path on `critical` (Exit Code `2` — Zero LLM, `curl` Only)

When `tools/usage-guard/check-usage.sh` exits with `2` (`critical`):

1. **Sync the `GATED` state to `WHO-10`** (prevents Orchestrator or any agent checking `usage-guard-state` from delegating new work):
   ```bash
   tools/usage-guard/check-usage.sh --sync-state
   ```

2. **Graceful Drain via `tree-holds` (Requires Board Credentials `PAPERCLIP_BOARD_API_KEY`)**:
   - Drains active runs to completion (`after_active_runs_finish`) and blocks new runs across the `WHO-2` issue tree without corrupting issue `status: blocked` semantics:
   ```bash
   PAPERCLIP_API_BASE="${PAPERCLIP_API_URL%/}"
   PAPERCLIP_API_BASE="${PAPERCLIP_API_BASE%/api}"
   WHO2_ID="67963966-root-issue-uuid" # Resolve via GET /api/companies/$PAPERCLIP_COMPANY_ID/issues?q=WHO-2

   cat << 'EOF' > /tmp/usage-guard-tree-hold.json
   {
     "mode": "pause",
     "releasePolicy": {
       "strategy": "after_active_runs_finish"
     }
   }
   EOF

   curl -sS -X POST \
     -H "Authorization: Bearer $PAPERCLIP_BOARD_API_KEY" \
     -H "Content-Type: application/json" \
     --data-binary @/tmp/usage-guard-tree-hold.json \
     "$PAPERCLIP_API_BASE/api/issues/$WHO2_ID/tree-holds"
   ```

3. **Post Escalation Notice on `WHO-10` (Works with Agent Token `PAPERCLIP_API_KEY`)**:
   ```bash
   PAPERCLIP_API_BASE="${PAPERCLIP_API_URL%/}"
   PAPERCLIP_API_BASE="${PAPERCLIP_API_BASE%/api}"
   WHO10_ID="aa89a45d-2afb-4a51-8db4-0969861766c8"

   cat << 'EOF' > /tmp/usage-guard-escalate-comment.json
   {
     "body": "Usage Guard [CRITICAL / GATED]: Quota threshold crossed (>=90%). Both-or-both gate ARMED. Finish in-flight turn, save work, and do not dispatch new runs until next_scheduled_wake_at."
   }
   EOF

   curl -sS -X POST \
     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     -H "Content-Type: application/json" \
     --data-binary @/tmp/usage-guard-escalate-comment.json \
     "$PAPERCLIP_API_BASE/api/issues/$WHO10_ID/comments"
   ```

4. **What Every Running Agent Does on Receiving a `CRITICAL / GATED` Signal**:
   - **Do NOT start new subtasks, subagents, or multi-step refactors.**
   - Commit or save current in-progress files in the workspace.
   - Update the task status/comment cleanly so Paperclip writes the `continuation-summary` document and ends the turn before hitting a hard `provider_quota` / `acpx_turn_failed` abort.

### 4.3 Exact Auto-Resume Steps at `resets_at`

Wake at `resets_at.next_scheduled_wake` (from `check-usage.sh` JSON output) + 60 seconds buffer:

1. **Verify Both Providers Are Clear (`exit_code == 0`)**:
   ```bash
   tools/usage-guard/check-usage.sh --sync-state
   # Proceed ONLY if fleet_gate.state == "CLEAR" (anthropic_clear == true && google_clear == true)
   ```
   - **Anthropic Clear Criteria**: `now >= five_hour.resets_at`, `five_hour.percent < 70%`, `seven_day.percent < 90%`, no `provider_quota` since reset, and `window-spend[5h] < 900c` (or fresh `.claude.json` `< 70%`).
   - **Google Clear Criteria**: No `acpx_turn_failed` (daily quota) since the daily reset boundary (or a verified post-reset `succeeded` run).

2. **Filter Candidate Issues Before Resuming**:
   - **Never resume an issue waiting on human input**: Check `GET /api/issues/{id}/interactions` and skip if any interaction has `status == "pending"`.
   - **Never resume a dependency-gated issue**: Check `GET /api/issues/{id}`; if `unblockDescriptor == null` AND `blockedTransitionAt == null` (e.g. `WHO-6`, `WHO-7`, `WHO-8` waiting on upstream contract/design locks), leave it untouched.

3. **Resume Limit-Stalled Issues in Dependency Order (Critical Path First: `WHO-3` -> `WHO-4` -> `WHO-2`)**:
   - Because every agent except the Orchestrator has `heartbeat.enabled = false`, a status update/comment or explicit `/wakeup` is required to restart execution:
   ```bash
   PAPERCLIP_API_BASE="${PAPERCLIP_API_URL%/}"
   PAPERCLIP_API_BASE="${PAPERCLIP_API_BASE%/api}"

   cat << 'EOF' > /tmp/usage-guard-resume-issue.json
   {
     "status": "in_progress",
     "comment": "Usage Guard [CLEAR]: Both Anthropic and Google cohorts verified below disarm thresholds (<70%). Resuming from continuation-summary."
   }
   EOF

   curl -sS -X PATCH \
     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     -H "Content-Type: application/json" \
     --data-binary @/tmp/usage-guard-resume-issue.json \
     "$PAPERCLIP_API_BASE/api/issues/$TARGET_ISSUE_ID"

   # Also clear paused agent state and trigger wake if needed:
   curl -sS -X POST \
     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     "$PAPERCLIP_API_BASE/api/agents/$TARGET_AGENT_ID/resume"

   curl -sS -X POST \
     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     "$PAPERCLIP_API_BASE/api/agents/$TARGET_AGENT_ID/wakeup"
   ```

---

## 5. Persistent Host Automation (Requires Board Approval — Proposed, NOT Installed)

Per board rules, **no `launchd` or `cron` jobs have been installed by this run**. The following host-level components require board approval to install:

1. **Host `launchd` Periodic Check (`~/Library/LaunchAgents/io.paperclip.usage-guard.plist`)**:
   - Runs `tools/usage-guard/check-usage.sh --sync-state --enforce` every `600` seconds (10 minutes) at **zero LLM token cost**.
   - Proposed plist (for board review/installation):
     ```xml
     <?xml version="1.0" encoding="UTF-8"?>
     <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
     <plist version="1.0">
     <dict>
       <key>Label</key>
       <string>io.paperclip.usage-guard</string>
       <key>ProgramArguments</key>
       <array>
         <string>/bin/bash</string>
         <string>/Users/hemantkumar/.paperclip/instances/default/projects/67963966-0460-42d3-908b-7b5436daf302/8fb4a75e-fc7c-4fbb-abc7-513fde6a7e7d/hca-edu-be/tools/usage-guard/check-usage.sh</string>
         <string>--sync-state</string>
         <string>--enforce</string>
       </array>
       <key>StartInterval</key>
       <integer>600</integer>
       <key>StandardOutPath</key>
       <string>/tmp/paperclip-usage-guard.log</string>
       <key>StandardErrorPath</key>
       <string>/tmp/paperclip-usage-guard.err</string>
     </dict>
     </plist>
     ```
2. **Board-Authority Token or Runner Pre-Dispatch Hook for Brake Enforcement**:
   - Provide `PAPERCLIP_BOARD_API_KEY` to the host `launchd` environment so `check-usage.sh --enforce` can invoke `POST /api/issues/{id}/tree-holds` (`after_active_runs_finish`), **or** wire `tools/usage-guard/check-usage.sh` as a pre-dispatch check in the local Paperclip runner (`exit_code == 2` -> defer run until `next_scheduled_wake`).
3. **Retire Interim WHO-10 Routine (`c68ad281`)**:
   - Once the zero-token `launchd` job is active, disable trigger `c29fd324-7b28-458d-bec8-92492f6b7ecf` on routine `c68ad281-9358-4e8a-b24e-2a923bd917b6` (`every 15 min limit-reset check`) so it stops spawning LLM execution issues (`WHO-11`) every 15 minutes.
4. **Fix `gemini_local` Output-Token & Cost Metering in Paperclip Adapter**:
   - Update the `gemini_local` / `acpx` accounting receipt reporter to populate `outputTokens` and `costUsd` (and expose `GET /api/companies/{c}/costs/quota-windows` to the guard), enabling a calibrated 90% pre-emptive brake for the Google cohort.
