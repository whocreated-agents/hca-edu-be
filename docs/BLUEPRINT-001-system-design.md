# BLUEPRINT-001 — System design: data model, routes, API, authorisation

**Issue:** WHO-2 · **Phase:** 2 (Architecture) · **Status:** proposed
**Depends on:** `PRD-001-scope-proposal.md` v2 · `ADR-001-technology-stack.md`
**Date:** 2026-10-25

---

## 1. Design invariants

Five rules the whole system is built around. Everything below is downstream of these.

1. **No year, session, fee amount, phone number or statistic is ever hardcoded.** All of it is
   data the office owns. The old site's stale "2025–26" is the cautionary tale.
2. **Years of service is computed, never stored.** `floor(yearsSince('2003-04-15'))`, evaluated at
   render time. There is no CMS field for it, so it cannot drift.
3. **Every record reachable by a parent or student is authorised against the *relationship*, not
   just the role.** A parent holding a valid token must still be denied `/fees/:studentId` for a
   child who is not theirs. Enforced by a guard, tested by default.
4. **Sensitive data lives in one place, encrypted, written once.** The stage-3 enrolment tier is a
   separate table with its own access path and audit trail — never joined into a general student
   read.
5. **Public content is read-only to the world and authored in exactly one place.** The site has no
   second source of truth for a notice.

---

## 2. Data model

Prisma schema, grouped by concern. `→` marks a foreign key.

### 2.1 Identity and access

| Model | Key fields | Notes |
|---|---|---|
| `User` | `id`, `phone?`, `email?`, `passwordHash?`, `role`, `status`, `failedAttempts`, `lockedUntil?`, `lastLoginAt` | One table, discriminated by `role`. **Every role uses a password** (argon2id). Parents log in with phone as username, staff/admin with email |
| `Role` *(enum)* | `SUPER_ADMIN`, `OFFICE`, `ACCOUNTS`, `TEACHER`, `PARENT`, `STUDENT` | `STUDENT` provisioned but unused in V1 (PRD §3) |
| `ActivationCode` | `→User`, `codeHash`, `issuedBy`, `expiresAt`, `consumedAt?` | **Replaces `OtpChallenge`.** 10 chars, unambiguous alphabet, argon2id-hashed, 30-day TTL, **single use**. Issuing a new one revokes the user's current `passwordHash` and all refresh tokens — that is the office-mediated reset path |
| `PasswordResetToken` | `→User`, `tokenHash`, `expiresAt`, `consumedAt?` | Email path only, 1-hour TTL, single use. Requires an email on the `User` or linked `Guardian` |
| `RefreshToken` | `→User`, `tokenHash`, `expiresAt`, `revokedAt`, `userAgent` | Rotating. Reuse of a revoked token revokes the whole family |
| `AuditLog` | `→User`, `action`, `entity`, `entityId`, `before`, `after`, `ip`, `at` | Every admin mutation. Append-only |

### 2.2 Academic structure

| Model | Key fields | Notes |
|---|---|---|
| `AcademicSession` | `label` ("2027–28"), `startsOn`, `endsOn`, `state`, `isAdmissionOpen` | **F2.** `state ∈ {UPCOMING, RUNNING, CLOSED}`. Partial unique index guarantees at most one `RUNNING` and at most one `isAdmissionOpen` |
| `ClassLevel` | `name` ("Class VI"), `order`, `minAge?`, `maxAge?`, `stage` | The 14 levels, seeded. `stage ∈ {PRE_PRIMARY, PRIMARY, MIDDLE, SECONDARY}` |
| `Section` | `→ClassLevel`, `→AcademicSession`, `name` ("A"), `→classTeacher: Staff?` | Sections are per-session, so last year's roster never leaks into this year's |
| `Staff` | `→User`, `employeeCode`, `fullName`, `designation`, `phone`, `joinedOn`, `isActive` | |
| `SectionSubjectTeacher` | `→Section`, `→Staff`, `subject` | Distinguishes subject teacher from class teacher for authorisation |

### 2.3 Students and guardians

| Model | Key fields | Notes |
|---|---|---|
| `Student` | `admissionNo`, `fullName`, `dob`, `gender`, `bloodGroup?`, `photoKey?`, `status` | `status ∈ {ACTIVE, TRANSFERRED_OUT, ALUMNUS}` |
| `Enrollment` | `→Student`, `→Section`, `→AcademicSession`, `rollNo`, `state` | **One row per student per session.** Promotion creates a new row; history is preserved rather than overwritten |
| `Guardian` | `→User?`, `fullName`, `relation`, `phone`, `email?`, `occupation?` | |
| `StudentGuardian` | `→Student`, `→Guardian`, `isPrimary` | Many-to-many. This is the table invariant 3 is enforced against, and it is what makes multi-child dashboards work |
| `StudentSensitive` | `→Student` (1:1), `aadhaarEnc?`, `category?`, `medicalNotesEnc?`, `consentRecordedAt`, `consentBy` | **Stage-3 tier.** `pgcrypto`-encrypted, `OFFICE`+ only, every read audited. Monthly income is deliberately absent |

### 2.4 Admissions

| Model | Key fields | Notes |
|---|---|---|
| `Enquiry` | `childName`, `→classLevel`, `parentName`, `phone`, `email?`, `locality`, `→session`, `state` | **Stage 1.** The 6-field public CTA. No sensitive data, ever |
| `Application` | `→Enquiry`, `applicationNo`, `childDob`, `gender`, `address`, `parentDetails` (JSONB), `previousSchool` (JSONB), `siblings` (JSONB), `emergencyContact`, `status`, `decidedAt?`, `→decidedBy?` | **Stage 2.** `status ∈ {SUBMITTED, REVIEWED, APPROVED, REJECTED}` — the old site's model, kept deliberately so the office's existing vocabulary still works |
| `ApplicationDocument` | `→Application`, `kind`, `fileKey`, `mimeType`, `sizeBytes`, `uploadedAt` | `kind ∈ {PHOTO, BIRTH_CERTIFICATE, TC, OTHER}`. 2 MB cap, type-sniffed not extension-trusted |

Stage 3 is not a form at all — on `APPROVED`, the office creates the `Student` and, separately and
only where a legal need exists, a `StudentSensitive` row.

### 2.5 Fees

| Model | Key fields | Notes |
|---|---|---|
| `FeeHead` | `name` ("Tuition", "Transport"), `isRecurring` | |
| `FeeStructure` | `→ClassLevel`, `→AcademicSession`, `→FeeHead`, `amount`, `frequency`, `dueDayOfMonth?` | **Admin-entered.** No amount ships in code or seed |
| `FeeInvoice` | `→Student`, `→AcademicSession`, `periodLabel`, `amountDue`, `dueOn`, `status` | Generated from structure when the office runs a billing period |
| `FeePayment` | `→FeeInvoice`, `amount`, `paidOn`, `mode`, `reference?`, `→recordedBy`, `receiptNo` | `mode ∈ {CASH, CHEQUE, BANK_TRANSFER, UPI_MANUAL}`. **Office-recorded only.** Receipt numbers are gapless per session |

No gateway, no UPI deep link, no QR. The public fee page renders structure plus
*"Online fee payment — coming soon."*

### 2.6 Attendance

| Model | Key fields | Notes |
|---|---|---|
| `AttendanceDay` | `→Section`, `date`, `→markedBy`, `markedAt`, `isFinalised` | One row per section per day. Unique on `(sectionId, date)` — this is what makes the offline sync idempotent |
| `AttendanceEntry` | `→AttendanceDay`, `→Student`, `status`, `note?` | `status ∈ {PRESENT, ABSENT, LATE, LEAVE}` |
| `Holiday` | `date`, `label`, `→session` | Keeps "absent" from meaning "school was shut" in reports |

**Offline model.** The teacher's device writes the whole day's marks to an IndexedDB outbox and
`PUT`s the complete day as one idempotent payload keyed on `(sectionId, date)`. Replaying a stale
submission is therefore safe, and a flaky connection cannot produce a half-marked register.

### 2.7 Content (CMS)

| Model | Key fields | Notes |
|---|---|---|
| `Notice` | `title`, `body`, `tag`, `publishFrom`, `publishUntil?`, `audience`, `→targetSections[]`, `isPinned` | **`publishUntil` is the fix for 2025 notices still being on the site.** `tag ∈ {ADMISSION, EXAM, HOLIDAY, EVENT, FEE}` — the office's existing taxonomy |
| `ContentBlock` | `key` ("home.hero", "about.mission"), `data` (JSONB), `→updatedBy`, `updatedAt` | Every public string the office can edit. Keyed, versioned, audited |
| `SchoolProfile` | singleton: `name`, `addressLines`, `phones[]`, `email`, `hours`, `socials` (JSONB), `foundedOn` (2003-04-15), `board`, `registrationNo` | The §12 facts register as a row. `foundedOn` drives the computed years count; there is no `yearsOfService` column |
| `Facility`, `Stat` | `title`, `description`, `order` / `label`, `value`, `order` | The 6 facilities and the 3 remaining statistics, office-editable |

---

## 3. Route map

### Public (`hca.edu.in`) — statically rendered, ISR-revalidated on CMS write

`/` · `/about` · `/academics` · `/facilities` · `/admissions` · `/admissions/enquiry` ·
`/admissions/apply/:token` · `/notices` · `/notices/:slug` · `/fees` · `/contact` ·
`/privacy` · `/terms` · `/disclosure`

Per **D3** there is no `/coming-soon`. Unbuilt areas are absent, not advertised.

### Portal (`/portal`) — client-rendered, authenticated

| Role | Routes |
|---|---|
| Parent | `/portal` (child cards) · `/portal/child/:id` · `/child/:id/fees` · `/child/:id/attendance` · `/portal/notices` |
| Teacher | `/portal` · `/portal/attendance` *(the landing action)* · `/portal/attendance/:sectionId/:date` · `/portal/roster/:sectionId` |

### Admin (`/admin`) — client-rendered, role-gated

`/admin` · `/sessions` · `/students` · `/students/:id` · `/classes` · `/staff` ·
`/admissions` *(pipeline board)* · `/admissions/:id` · `/fees/structure` · `/fees/invoices` ·
`/fees/payments` · `/attendance/reports` · `/notices` · `/cms` · `/audit`

---

## 4. API surface

REST, versioned at `/api/v1`, OpenAPI-documented, types generated into the web client (ADR-001).

| Group | Endpoints |
|---|---|
| **Public** | `GET /public/profile` · `/public/content` · `/public/notices` · `/public/fees` · `/public/session` · `POST /public/enquiries` |
| **Auth** | `POST /auth/login` *(all roles)* · `/auth/activate` *(mobile + activation code → set password)* · `/auth/password/forgot` · `/auth/password/reset` · `/auth/password/change` · `/auth/refresh` · `/auth/logout` |
| **Parent** | `GET /me/children` · `/children/:id` · `/children/:id/fees` · `/children/:id/attendance` · `/me/notices` |
| **Staff** | `GET /staff/me/sections` · `GET /sections/:id/roster` · `GET /sections/:id/attendance/:date` · **`PUT /sections/:id/attendance/:date`** *(idempotent bulk)* |
| **Admin** | Full CRUD over sessions, students, enrollments, classes, sections, staff, fee heads/structure/invoices/payments, notices, content blocks; `GET /admin/applications` with filters + CSV; `PATCH /admin/applications/:id/status`; `GET /admin/audit` |
| **Sensitive** | `GET`/`PUT /admin/students/:id/sensitive` — `OFFICE`+ only, separate guard, every access written to `AuditLog` |

Admin additionally gets `POST /admin/users/:id/activation-code` — reissue, which revokes the current
password and every refresh token for that user, and is written to `AuditLog` like any other mutation.

**Cross-cutting:** Zod validation at every boundary · per-role rate limits, tightest on login,
activation and reset · per-account lockout (10 failures → 15 min) independent of per-IP limits ·
`X-Request-Id` on every response · PII redaction in the log serialiser · errors as RFC 7807.

---

## 5. Authorisation matrix

| Resource | Anonymous | Parent | Teacher | Office | Super-admin |
|---|---|---|---|---|---|
| Public content | read | read | read | read | write |
| Own children's fees/attendance | — | **read, relationship-checked** | — | read | read |
| Any student's record | — | — | **own sections only** | read/write | read/write |
| Mark attendance | — | — | **own sections, current session** | write | write |
| Record fee payment | — | — | — | write | write |
| `StudentSensitive` | — | — | — | read/write, audited | read/write, audited |
| Notices, CMS, sessions | — | — | — | write | write |
| Staff accounts, roles, audit log | — | — | — | read | write |

The relationship checks — *is this my child*, *is this my section*, *is this the current session* —
are guards applied by default and opted out of explicitly, rather than remembered per handler.
This is guardrail 5 (anti-IDOR) made structural.

---

## 6. Background jobs

| Job | Cadence | Purpose |
|---|---|---|
| Notice expiry sweep | hourly | Unpublishes past `publishUntil`. Why the site can never again show April 2025 |
| Session state transition | daily | `UPCOMING → RUNNING → CLOSED` on configured dates |
| Invoice generation | on demand, office-triggered | Never automatic — money should not move without a human |
| Expired activation-code, reset-token and refresh-token cleanup | hourly | |
| `pg_dump` + off-host upload | nightly | With a documented, periodically rehearsed restore |

---

## 7. Open dependencies

**Closed since the last revision.** The SMS provider and TRAI DLT registration are **no longer a
dependency at all** — the board chose office-issued activation codes, so the one item that sat on the
critical path is gone. DNS is also closed: the school has access via **ERNET India**.

Still open, all of them launch-time rather than build-time:

1. **Hosting choice and spend** — on hold by board decision. Options and costs are set out in
   `HOSTING-OPTIONS-AND-COST.md` for a decision. **Nothing has been purchased.** The build does not
   wait on this; a developer machine or a free tier runs the same Compose file.
2. **Logo and photography** — the school confirmed both exist and will send them. Exact formats
   needed are listed in `HOSTING-OPTIONS-AND-COST.md` §5 so one handoff is enough. Note that any
   photograph containing an identifiable child needs recorded guardian consent before it goes on a
   public page — a DPDP obligation, not a preference.
3. **Mandatory public disclosure content** — the page structure is in scope; the RBSE-mandated
   values must come from the school.
4. **Current hosting contract** — what the school pays today for `103.108.220.145` and its mail, and
   what must be retained for `hca.edu.in` mail to keep working after cutover. This is a question for
   the school, and it has to be answered *before* the TLS cutover, not after.

---

*Prepared by: Agentic Orchestrator · Issue WHO-2 · Phase 2*
