# HCA V1 — Bug Registry & Root Cause Analysis (RCA)

**Maintainer:** Senior Software Engineer (Quality Gatekeeper & Deep Bug Hunter)  
**Last Updated:** 2026-10-26  
**Scope:** Canonical registry for all bugs, regressions, security defects, race conditions, and compliance discrepancies identified and resolved across HCA services and client applications.

---

## 1. Severity Classification Matrix

| Severity | Definition | SLA / Gate Policy |
|---|---|---|
| **P0 (Critical)** | Data loss, credential exfiltration, authentication/IDOR bypass, or service unavailability. | Blocks merge, immediate hotfix, mandatory RCA. |
| **P1 (High)** | Concurrency race condition, financial ledger inconsistency, broken core workflow, design token/year violation, or missing test suite. | Blocks release/merge, failing regression test required before fix. |
| **P2 (Medium)** | Non-critical edge case, improper error code (500 instead of 409), contract drift, silent catch blocks. | Remediated in current sprint with test coverage. |
| **P3 (Low)** | Performance inefficiency, minor logging omission, cosmetic UI issue. | Addressed during routine maintenance. |

---

## 2. Active & Resolved Defect Registry

| Bug ID | Title | Severity | Component | Status | Assigned / Author | Regression Test / Verification |
|---|---|---|---|---|---|---|
| **BUG-001** | Concurrent failed login attempts bypass account lockout threshold | **P1 (High)** | `@hca/api` (`AuthService`) | **RESOLVED** | Backend Engineer | `apps/api/test/auth.spec.ts` |
| **BUG-002** | Unhandled unique constraint violation (`P2002`) on duplicate email in `createStaff` yields HTTP 500 | **P2 (Medium)** | `@hca/api` (`AcademicService`) | **RESOLVED** | Backend Engineer | `apps/api/test/academic.spec.ts` |
| **BUG-003** | TOCTOU concurrency race during guardian user provisioning with concurrent identical phone | **P1 (High)** | `@hca/api` (`StudentsService`) | **RESOLVED** | Backend Engineer | `apps/api/test/students.spec.ts` |
| **BUG-004** | Contract-Implementation drift: Media Asset & Photo Consent routes declared but not mounted | **P2 (Medium)** | `@hca/api` (`ContentController`) | **TRIAGED (DEFERRED)** | Backend Engineer | `packages/contracts/src/admin-content.ts` |
| **BUG-005** | Widespread raw hex color styles bypassing `DESIGN-SPEC-001` tokens in UI components | **P1 (High)** | `@hca/web` (`AdminHeader`, `Footer`, etc.) | **RESOLVED (VERIFIED)** | Frontend Engineer / SSE Verified | `test/token-scanner.test.ts` (0 raw hex values) |
| **BUG-006** | Absence of automated test suite and regression tests in frontend repository | **P1 (High)** | `@hca/web` (Project Scaffold) | **RESOLVED (VERIFIED)** | Frontend Engineer / SSE Verified | Vitest suite (20/20 passing across 5 suites) |
| **BUG-007** | Hardcoded academic session and calendar years in UI fallbacks and date logic | **P1 (High)** | `@hca/web` (`admissions`, `admin`, `attendance`) | **RESOLVED (VERIFIED)** | Frontend Engineer / SSE Verified | `test/token-scanner.test.ts` (dynamic year fallbacks) |
| **BUG-008** | Missing ESLint devDependency and `lint` npm script in frontend repository | **P2 (Medium)** | `@hca/web` (`package.json`) | **RESOLVED (VERIFIED)** | Frontend Engineer / SSE Verified | `npm run lint` (0 errors, 0 warnings) |
| **BUG-009** | Offline Attendance Outbox swallows non-network 4xx HTTP rejections as queued items | **P1 (High)** | `@hca/web` (`offline-outbox.ts`) | **RESOLVED (VERIFIED)** | Frontend Engineer / SSE Verified | `test/offline-outbox.test.ts` (4xx discard & alert) |
| **BUG-010** | Silent error suppression via empty `catch {}` and hardcoded phone fallback in CMS | **P2 (Medium)** | `@hca/web` (`admin/content/page.tsx`) | **RESOLVED (VERIFIED)** | Frontend Engineer / SSE Verified | `test/token-scanner.test.ts` (error states & dynamic profile) |

---

## 3. Root Cause Analysis (RCA)

### RCA-001: Race Condition in Failed Login Lockout Counter
- **Discovered In:** PR #2 Forensic Review (`who-3/contract-lock`)
- **Impacted Module:** `apps/api/src/auth/auth.service.ts` (`recordFailure`)
- **Severity:** P1 (High) — Security flaw enabling brute-force attacks via parallel worker bursts

#### 1. Symptom & Failure Scenario
When an attacker dispatched 10 concurrent HTTP requests with invalid credentials against a target account (e.g. via `Promise.all`), all 10 requests read the initial `user.failedAttempts = 0`. Each request computed `failed = u.failedAttempts + 1` in Node memory (`0 + 1 = 1`). Consequently, none of the 10 concurrent requests satisfied `failed >= LOGIN_MAX_FAILURES`, and `lockedUntil` was never set. The account accumulated 10 failed attempts in the database but remained completely unlocked.

#### 2. Five Whys Root Cause Analysis
1. *Why was the account not locked after 10 failed attempts?* `lockedUntil` was not updated because `if (failed >= LOGIN_MAX_FAILURES)` evaluated to false for all 10 concurrent requests.
2. *Why did it evaluate to false?* `failed` was evaluated against the pre-fetched user entity in memory (`user.failedAttempts + 1`), which was `0` for all parallel invocations.
3. *Why did all invocations see `failedAttempts = 0`?* The initial lookup (`findByIdentifier`) executed before any transaction or lock was acquired (classic TOCTOU).
4. *Why was the increment performed as a non-atomic update?* The code separated the condition check from the database state mutation instead of using PostgreSQL atomic update return semantics.
5. *Why was this missed initially?* Tests only exercised sequential failed login attempts in a loop, never parallel concurrent requests.

#### 3. Corrective Action & Implementation
- Replaced the in-memory check with an atomic database increment that selects the newly mutated value in the same atomic operation (`{ data: { failedAttempts: { increment: 1 } } }`).
- Added automated regression test in `apps/api/test/auth.spec.ts` verifying concurrency resistance.

---

### RCA-002: Uncaught Unique Constraint Violation in Staff Creation on Duplicate Email
- **Discovered In:** PR #5 Forensic Review (`who-6/admission-fees-attendance-cms`)
- **Impacted Module:** `apps/api/src/academic/academic.service.ts` (`createStaff`)
- **Severity:** P2 (Medium) — Database exception leak resulting in HTTP 500 instead of HTTP 409 Conflict

#### 1. Symptom & Failure Scenario
When an administrator attempts to create a new staff member with an email address already registered to an existing user (e.g. `admin@hca.test`), the API responds with `500 Internal Server Error` and logs a raw Prisma `PrismaClientKnownRequestError: Unique constraint failed on the fields: (lower(email))`, rather than returning a clean `409 Conflict` problem response.

#### 2. Five Whys Root Cause Analysis
1. *Why did the API return a 500 error?* `ProblemFilter` caught an unhandled `PrismaClientKnownRequestError` and defaulted to `500 INTERNAL`.
2. *Why was the Prisma error unhandled?* `tx.user.create()` on line 227 of `academic.service.ts` was executed outside of any `try/catch` block.
3. *Why was `staff.create()` in a `try/catch` but not `user.create()`?* The author only anticipated unique collisions on `Staff.employeeCode`, neglecting that `User.email` also carries a unique constraint.
4. *Why did integration tests not catch this?* Tests only exercised creating staff with unique fixture emails (`new.teacher@hca.test`) and role permission gates, never asserting duplicate email rejection.
5. *Why was input validation insufficient?* Email syntax is validated by Zod, but uniqueness requires a database constraint or lookup.

#### 3. Corrective Action & Implementation
- Wrapped `tx.user.create()` in a `try/catch` block intercepting `isUniqueViolation(e)` and throwing `Problem.conflict('A user with that email already exists')`.
- Authored automated regression test in `apps/api/test/academic.spec.ts` verifying that creating staff with an existing email returns HTTP 409.

---

### RCA-003: TOCTOU Concurrency Race in Guardian User Provisioning
- **Discovered In:** PR #5 Forensic Review (`who-6/admission-fees-attendance-cms`)
- **Impacted Module:** `apps/api/src/students/students.service.ts` (`provisionGuardian`)
- **Severity:** P1 (High) — Unhandled database crash on concurrent student/guardian creation

#### 1. Symptom & Failure Scenario
When two concurrent requests attempt to provision a student with a new guardian sharing the same phone number (or two parallel guardian link operations), both requests query `db.user.findUnique({ where: { phone } })`, find no existing user, and simultaneously execute `db.user.create({ data: { role: 'PARENT', phone } })`. The second transaction fails with an unhandled `P2002` unique constraint violation on `User.phone`, returning `500 Internal Server Error`.

#### 2. Five Whys Root Cause Analysis
1. *Why did concurrent guardian creation fail with 500?* An unhandled `P2002` unique constraint error was raised by `db.user.create()`.
2. *Why was `db.user.create()` attempted if the phone exists?* Both transactions checked for existence before either committed (Time-of-Check to Time-of-Use race).
3. *Why was `db.user.create()` not guarded?* The code assumed serial execution and pre-existing user detection was sufficient.
4. *Why was advisory locking or duplicate trapping omitted?* Advisory locking was implemented for fees and attendance, but omitted on guardian provisioning.
5. *Why was this missed in testing?* Tests only verified sequential reuse of existing parent logins across siblings, not concurrent race conditions.

#### 3. Corrective Action & Implementation
- Wrapped `db.user.create()` in `provisionGuardian()` with `try/catch` checking `isUniqueViolation(e)` to throw `Problem.conflict('A user with that phone number already exists')`.
- Added regression test in `apps/api/test/students.spec.ts`.

---

### RCA-004: Undeployed Route Declarations in CMS Media/Consent Management
- **Discovered In:** PR #5 Forensic Review (`who-6/admission-fees-attendance-cms`)
- **Impacted Module:** `packages/contracts/src/admin-content.ts` vs `apps/api/src/content/content.controller.ts`
- **Severity:** P2 (Medium) — Contract-Implementation Drift

#### 1. Symptom & Failure Scenario
Seven media asset and photograph consent routes declared in `@hca/contracts` (`adminContent.media`, `uploadMedia`, `updateMedia`, `deleteMedia`, `addConsent`, `uploadConsentEvidence`, `withdrawConsent`) have no mounted controllers in `@hca/api`. To pass the route registry parity test (`every declared route has a mounted handler`), `adminContent` had to be explicitly excluded from `IMPLEMENTED` in `apps/api/test/authz.spec.ts`.

#### 2. Five Whys Root Cause Analysis
1. *Why were the routes unmounted in the API?* The Phase 4 backend scope deferred DPDP photo consent enforcement to a follow-up ticket.
2. *Why were they declared in the contracts package if not implemented?* Contract lock (WHO-3) specified the complete system surface upfront from BLUEPRINT-001.
3. *Why was the contract not split?* Media routes were bundled into `adminContentRoutes` alongside notices, profile, and facilities.
4. *Why did CI pass?* The backend engineer added a targeted bypass in `authz.spec.ts` excluding `adminContent` from the route parity assertion.
5. *What is the operational risk?* If frontend code calls any of these routes, the API returns an unexpected 404/403 rather than a defined contract response.

#### 3. Corrective Action & Implementation
- Verified that frontend (`@hca/web`) does not invoke any of the unmounted media routes in V1.
- Documented the contract gap in `BUG_REGISTRY_AND_RCA.md` and flagged a dedicated tracking issue for Phase 6 / DPDP consent workflow.

---

### RCA-005: Design Token Bypass and Hardcoded Hex Colors Across Frontend
- **Discovered In:** PR #1 Forensic Review (`who-7/frontend-pwa-web`)
- **Impacted Module:** `@hca/web` (`AdminHeader.tsx`, `Footer.tsx`, `page.tsx`, `admissions/page.tsx`, `about/page.tsx`, `layout.tsx`, `admin/parents/page.tsx`, `admin/content/page.tsx`)
- **Severity:** P1 (High) — Violation of Quality Gate Guardrails & DESIGN-SPEC-001

#### 1. Symptom & Failure Scenario
Over 25 occurrences of raw hex values (e.g. `#1E293B`, `#334155`, `#94A3B8`, `#CBD5E1`, `#93C5FD`, `#E2E8F0`, `#FFFFFF`, `#fff`, `#1E3A8A`) are hardcoded in inline style attributes throughout core UI components, completely bypassing the design token system (`DESIGN-SPEC-001.md` / `tokens.css`).

#### 2. Five Whys Root Cause Analysis
1. *Why are raw hex codes present in production code?* Inline styles were written directly during rapid layout construction without referencing CSS variables.
2. *Why was this not caught by the author?* The PR description claimed "Zero raw hex values or arbitrary pixels" based on visual appearance rather than automated static grep/lint verification.
3. *Why did automated linters miss this?* Stylelint or ESLint rules banning raw hex values in JSX style objects were not configured in `hca-edu-web`.
4. *Why is this a high-severity bug?* Violates the explicit project quality gate: *"Block the PR on any of: ... raw hex values instead of design tokens"*, and breaks theme centralization, dark mode readiness, and brand consistency.
5. *What must be done?* Replace every raw hex color with its exact corresponding CSS custom property token (e.g., `var(--hca-brand-primary-900)`, `var(--hca-neutral-800)`, `var(--hca-neutral-100)`).

#### 3. Corrective Action & Implementation
- Requested changes on PR #1 (`who-7/frontend-pwa-web`) with line-by-line diagnostics citing every violating file and exact token replacement.

---

### RCA-006: Absence of Automated Test Suite and Regression Tests in Frontend
- **Discovered In:** PR #1 Forensic Review (`who-7/frontend-pwa-web`)
- **Impacted Module:** `@hca/web` (Root configuration and tests directory)
- **Severity:** P1 (High) — Quality Gate Violation & Regression Risk

#### 1. Symptom & Failure Scenario
The frontend repository (`hca-edu-web`) contains zero test files (`*.test.ts`, `*.spec.tsx`) and does not define a `test` script in `package.json`. Critical user journeys (6-field admissions enquiry, stage-2 tokenized application, offline attendance outbox queueing, and parent multi-child portal) have zero automated verification.

#### 2. Five Whys Root Cause Analysis
1. *Why are there no frontend tests?* The frontend engineer prioritized page layout, routing, and Next.js static build generation.
2. *Why was the test harness not set up?* The initial repository scaffold only configured Next.js, React, and TypeScript.
3. *Why was this overlooked before PR submission?* The author relied solely on `next build` static page generation (23/23 pages) as proof of correctness.
4. *Why does this block the PR?* The project charter states: *"Block the PR on any of: ... missing regression tests"*.
5. *What is required?* Install Vitest/Jest with React Testing Library, configure `npm test`, and author unit tests for `offline-outbox.ts`, `api.ts`, and core form submissions.

#### 3. Corrective Action & Implementation
- **Remediated & Verified (Commit `ea3dd71`):** Configured Vitest, JSDOM, and React Testing Library (`vitest.config.mts`). Added `"test"` script in `package.json`. Authored 5 test suites covering API errors, tokens, enquiry flows, UI fallbacks, and offline outbox (20/20 tests passing).

---

### RCA-007: Stale Academic Session & Hardcoded Year Regressions in Frontend Fallbacks
- **Discovered In:** PR #1 Forensic Review (`who-7/frontend-pwa-web`)
- **Impacted Module:** `@hca/web` (`src/app/admissions/page.tsx`, `src/app/admin/page.tsx`, `src/app/portal/children/[id]/attendance/page.tsx`)
- **Severity:** P1 (High) — Architectural Invariant Violation

#### 1. Symptom & Failure Scenario
1. `src/app/admissions/page.tsx:20-21` falls back to hardcoded strings `'2026-27'` and `'2027-28'` in `getSessionData()` catch block.
2. `src/app/admin/page.tsx:51` uses `sessionData?.admissionOpen?.label ?? '2027–28'`.
3. `src/app/portal/children/[id]/attendance/page.tsx:48, 56` uses `Number(parts[0] ?? 2026)`.

#### 2. Five Whys Root Cause Analysis
1. *Why are hardcoded years present?* Developers inserted fallback defaults in case API responses were unavailable or month strings failed to split.
2. *Why does this violate system design?* BLUEPRINT-001 Section 2 explicitly mandates: *"No hardcoded years anywhere. Academic session is a database entity... The old site advertising a stale session is the root cause this design exists to prevent, so a hardcoded year is a regression even if it currently renders correctly."*
3. *What happens when the school year advances?* In failure modes, the portal would advertise a stale academic session, re-introducing the exact legacy defect that initiated this project.
4. *How should fallbacks behave?* Fallbacks must display generic labels (e.g. `'Current Session'`) or calculate dynamic calendar years via `new Date().getFullYear()`, never hardcoding calendar years.
5. *What is the corrective action?* Remove all static year strings and replace with dynamic date computations or neutral text.

#### 3. Corrective Action & Implementation
- **Remediated & Verified (Commit `ea3dd71`):** Replaced static year strings (`2026-27`, `2027-28`, `2026`) with dynamic calendar calculations (`new Date().getFullYear()`) and dynamic session metadata in `admissions/page.tsx`, `admin/page.tsx`, and `portal/children/[id]/attendance/page.tsx`. Verified via `test/token-scanner.test.ts`.

---

### RCA-008: Missing ESLint Tooling Configuration in Frontend Repository Scaffold
- **Discovered In:** PR #1 Forensic Review (`who-7/frontend-pwa-web`)
- **Impacted Module:** `@hca/web` (`package.json`, `eslint.config.mjs`)
- **Severity:** P2 (Medium) — CI Infrastructure Defect

#### 1. Symptom & Failure Scenario
`npm run lint` in `hca-edu-web` fails with `Missing script: "lint"`, and `npm run build` outputs warning: `ESLint must be installed in order to run during builds: npm install --save-dev eslint`. Although `eslint.config.mjs` was committed, `eslint` was never added to `devDependencies` or npm scripts.

#### 2. Five Whys Root Cause Analysis
1. *Why did `npm run lint` fail?* No `"lint"` script was defined in `package.json`.
2. *Why was it not defined?* During repo separation (WHO-18), the backend retained ESLint dependencies while the web workspace scaffold did not install them.
3. *Why did commit `3883a12` claim to fix lint?* The commit modified `eslint.config.mjs` rules without verifying `npm run lint` in a clean workspace.
4. *Why is this important?* Without an active linter, style violations, unused variables, and misused promises go undetected in CI.
5. *What is the fix?* Add `eslint` and `@eslint/js` to `devDependencies` and configure `"lint": "eslint ."` in `package.json`.

#### 3. Corrective Action & Implementation
- **Remediated & Verified (Commit `ea3dd71`):** Installed `eslint`, `@eslint/js`, and `typescript-eslint`. Added `"lint": "eslint ."` to `package.json`. `npm run lint` runs cleanly with 0 errors and 0 warnings.

---

### RCA-009: Offline Attendance Outbox Erroneously Swallowing 4xx HTTP Failures
- **Discovered In:** PR #1 Forensic Review (`who-7/frontend-pwa-web`)
- **Impacted Module:** `@hca/web` (`src/app/portal/attendance/page.tsx:217`, `src/lib/offline-outbox.ts:95`)
- **Severity:** P1 (High) — Fault-tolerance & Logic Flaw

#### 1. Symptom & Failure Scenario
In `handleSubmitRegister()`, a generic `catch {}` block catches all errors and unconditionally triggers:
`queueSubmission(selectedSectionId, selectedDate, submission)` with notification: *"Network offline: 1 register safely queued in local device Outbox"*. If an API call fails due to `401 Unauthenticated`, `403 Forbidden`, `409 ATTENDANCE_FINALISED`, `409 ATTENDANCE_STALE`, or `422 ATTENDANCE_ROSTER_MISMATCH`, the error is swallowed and the rejected payload is placed into `localStorage`, where the auto-sync loop retries it indefinitely upon every `online` event.

#### 2. Five Whys Root Cause Analysis
1. *Why did business errors get queued in the outbox?* The catch block made no distinction between network/fetch transport failures and HTTP 4xx client/business error responses.
2. *Why was there no check?* The implementation assumed any rejected promise from `call()` was a connectivity outage.
3. *What does `call()` throw?* `call()` throws `ApiError(res.status, problem)` for all non-2xx HTTP responses.
4. *What is the consequence?* A teacher whose login expired or who submitted an invalid roster thinks their attendance is "safely queued", while the server is actively rejecting it.
5. *What is the correct behavior?* Only network failures (`!navigator.onLine` or fetch `TypeError`) should queue into the offline outbox. All `ApiError` instances must be presented to the user with the server detail message.

#### 3. Corrective Action & Implementation
- **Remediated & Verified (Commit `ea3dd71`):** Updated `src/app/portal/attendance/page.tsx` to surface immediate error alerts on `ApiError (4xx)` rather than queueing. Updated `src/lib/offline-outbox.ts` `flushOutbox()` to permanently discard 4xx responses while retaining retry logic for network drops (TypeError) and 5xx errors. Verified via 6 tests in `test/offline-outbox.test.ts`.

---

### RCA-010: Silent Error Suppression and Hardcoded Contact Fallbacks in CMS
- **Discovered In:** PR #1 Forensic Review (`who-7/frontend-pwa-web`)
- **Impacted Module:** `@hca/web` (`src/app/admin/content/page.tsx:46, 62, 98, 127`)
- **Severity:** P2 (Medium) — Code Quality & Error Transparency

#### 1. Symptom & Failure Scenario
In `AdminContentPage`, data fetching functions (`loadNotices`, `loadProfile`, and save handlers) feature empty `catch { /* ignore */ }` blocks that swallow runtime exceptions without setting error states or displaying toast/alert notifications. Furthermore, line 58 falls back to a hardcoded phone number: `setPhone(data.phones[0] ?? '+91 94605 40956')`.

#### 2. Five Whys Root Cause Analysis
1. *Why were empty catch blocks used?* Quick authoring to prevent component crashes on initial render.
2. *Why does this violate standards?* Project operational boundaries prohibit symptom-only band-aids: *"Never suppress an error with an empty catch {}"*.
3. *What happens on API error?* The UI remains in an indeterminate state with infinite loading skeletons or silent save failures.
4. *Why is the hardcoded phone bad?* School contact details are dynamic configuration in `SchoolProfile`.
5. *What is the fix?* Bind error states to alert banners in the UI and remove hardcoded phone fallbacks.

#### 3. Corrective Action & Implementation
- **Remediated & Verified (Commit `ea3dd71`):** Removed empty `catch {}` blocks in `src/app/admin/content/page.tsx`, binding error states to alert banners. Removed hardcoded phone fallback, fetching dynamically from `SchoolProfile`. Verified via `test/token-scanner.test.ts`.
