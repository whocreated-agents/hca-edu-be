# HCA V1 — Bug Registry & Root Cause Analysis (RCA)

**Maintainer:** Senior Software Engineer (Quality Gatekeeper & Deep Bug Hunter)
**Last Updated:** 2026-10-25
**Scope:** Canonical registry for all bugs, regressions, security defects, and race conditions identified and resolved across HCA services.

---

## 1. Severity Classification Matrix

| Severity | Definition | SLA / Gate Policy |
|---|---|---|
| **P0 (Critical)** | Data loss, credential exfiltration, authentication/IDOR bypass, or service unavailability. | Blocks merge, immediate hotfix, mandatory RCA. |
| **P1 (High)** | Concurrency race condition, financial ledger inconsistency, or broken core workflow. | Blocks release, failing regression test required before fix. |
| **P2 (Medium)** | Non-critical edge case, improper error code, minor contract drift. | Remediated in current sprint with test coverage. |
| **P3 (Low)** | Performance inefficiency, minor logging omission, cosmetic issue. | Addressed during routine maintenance. |

---

## 2. Active & Resolved Defect Registry

| Bug ID | Title | Severity | Component | Status | Regression Test |
|---|---|---|---|---|---|
| **BUG-001** | Concurrent failed login attempts bypass account lockout threshold | **P1 (High)** | `@hca/api` (`AuthService`) | **RESOLVED** | `apps/api/test/auth.spec.ts` |

---

## 3. Root Cause Analysis (RCA)

### RCA-001: Race Condition in Failed Login Lockout Counter
- **Discovered In:** PR #2 Forensic Review (`who-3/contract-lock`)
- **Impacted Module:** `apps/api/src/auth/auth.service.ts` (`recordFailure`)
- **Discovered By:** Senior Software Engineer (Quality Gatekeeper)
- **Severity:** P1 (High) — Security flaw enabling brute-force attacks via parallel worker bursts

#### 1. Symptom & Failure Scenario
When an attacker dispatches 10 concurrent HTTP requests with invalid credentials against a target account (e.g. via `Promise.all` or parallel HTTP workers), all 10 requests read the initial `user.failedAttempts = 0`. Each request computes `failed = u.failedAttempts + 1` in Node memory (`0 + 1 = 1`). Consequently, none of the 10 concurrent requests satisfy `failed >= LOGIN_MAX_FAILURES`, and `lockedUntil` is never set. The account accumulates 10 failed attempts in the database but remains completely unlocked, permitting subsequent login attempts and bypassing the 15-minute lockout security policy.

#### 2. Five Whys Root Cause Analysis
1. *Why was the account not locked after 10 failed attempts?*
   `lockedUntil` was not updated because `if (failed >= LOGIN_MAX_FAILURES)` evaluated to false for all 10 concurrent requests.
2. *Why did it evaluate to false?*
   `failed` was evaluated against the pre-fetched user entity in memory (`user.failedAttempts + 1`), which was `0` for all parallel invocations.
3. *Why did all invocations see `failedAttempts = 0`?*
   The initial lookup (`findByIdentifier`) executed before any transaction or lock was acquired, creating a Classic Time-of-Check to Time-of-Use (TOCTOU) race condition.
4. *Why was the increment performed as a non-atomic update?*
   The code separated the condition check from the database state mutation instead of using PostgreSQL's atomic update return semantics.
5. *Why was this missed initially?*
   Unit/integration tests only tested sequential failed login attempts in a loop (`for (let i = 0; i < LOGIN_MAX_FAILURES; i++)`), never exercising concurrent parallel requests against the endpoint.

#### 3. Corrective Action & Implementation
- Replaced the in-memory check with an atomic database increment that selects the newly mutated value in the same atomic operation:
  ```typescript
  const updated = await this.prisma.user.update({
    where: { id: u.id },
    data: { failedAttempts: { increment: 1 } },
    select: { failedAttempts: true },
  });
  if (updated.failedAttempts >= LOGIN_MAX_FAILURES) {
    await this.prisma.user.update({
      where: { id: u.id },
      data: { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * MIN) },
    });
  }
  ```
- Authored automated regression test in `apps/api/test/auth.spec.ts`:
  `"locks the account after concurrent failed attempts without losing lockout to race conditions"`.
- Verified test fails before the fix and passes cleanly after the fix.
