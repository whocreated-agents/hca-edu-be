# NFR-001 — Security, privacy and DPDP baseline

**Issue:** WHO-5 · **Phase:** 3 · **Owner:** CTO · **Status:** proposed — needs board decisions in §0.3
**Depends on:** `PRD-001` v2 · `ADR-001` · `BLUEPRINT-001` · `PHOTO-CONSENT-REQUIREMENTS` · `DNS-AND-EMAIL-CUTOVER` · `HOSTING-OPTIONS-AND-COST`
**Date:** 2026-10-25

> **Legal-reading caveat.** I am an engineer, not counsel. Statutory references (DPDP Act 2023, the
> DPDP Rules 2025, the Aadhaar Act, CERT-In Directions 2022) are my engineering reading of what the
> system must do. My understanding is that the Rules' substantive duties (notice, security
> safeguards, children's data, breach intimation) commence in phases, with most about 18 months after
> notification, i.e. roughly mid-2027. **We build to them from day one** because the data is
> collected now and retrofitting is dearer. Counsel must confirm the commencement dates, the
> retention periods marked *(confirm)*, and the privacy notice text before launch (LB-4).

---

## 0. Summary

### 0.1 What is different about this system

It holds, for **minors**: names, photographs, attendance patterns, fee standing, medical details,
category, and (on the legacy form) Aadhaar of the child and both parents plus family income. The
legacy form collects all of it in public, before any seat is offered. The risk is therefore not
"someone hacks the server"; it is, in order of likelihood:

1. a logged-in parent or teacher reaching records they should not (authorisation failure);
2. our own code collecting or leaking more than it should (minimisation and logging failure);
3. an account taken over through the weakest recovery path (email, now load-bearing);
4. a lost backup, lost phone or departed insider.

Perimeter hardening matters, but the controls below are weighted to those four.

### 0.2 Launch-blocking controls

You asked for plain statements. Each is a gate: the launch does not happen, or the named feature
stays switched off, until it is met. Detail is in the section referenced.

| # | Blocker | Why it blocks | §|
|---|---|---|---|
| **LB-1** | **Central default-deny authorisation, with the two-family IDOR suite and the route-inventory test green and required in CI.** | The system's whole confidentiality promise to parents. A single unscoped endpoint breaks it. | 1 |
| **LB-2** | **The public tiers (enquiry, application) cannot accept sensitive fields**, enforced by strict schemas, a DB `CHECK`, an Aadhaar-pattern rejector and a CI test, not by form design alone. | The board's three-stage split is only real if the code refuses the data. | 2.4 |
| **LB-3** | **Board decision on Aadhaar.** My recommendation is *do not store the number* (§2.3). If the board wants it stored, that is blocked on a documented legal basis, app-layer encryption, and India-resident hosting. | Highest-harm field; no demonstrated need. | 2.3 |
| **LB-4** | **Privacy notice live at `/privacy`, a named Grievance Officer, consent wording on the enquiry/application forms, counsel review.** School inputs listed in Appendix B. | The Act requires notice before collection. Already board-accepted as launch-blocking. | 8 |
| **LB-5** | **Email is verified before it can reset a password, SMTP verifies certificates, and SPF/DKIM for the new sender are published in the same change as the A records.** | A reset to a typo'd or hostile address is a takeover; an unverifiable SMTP cert tempts the team to disable TLS checks. | 4.5, 5.2 |
| **LB-6** | **Off-host, client-side-encrypted backups and one *timed, successful full restore drill* before launch.** | One VPS. A backup that has never been restored is a hope. | 7 |
| **LB-7** | **Valid certificate on `hca.edu.in` and `www` verified after cutover; HSTS staged; no `includeSubDomains`.** | Closes today's warning; `includeSubDomains` would break webmail on `mail.hca.edu.in`. | 5.1 |
| **LB-8** | **Secret scanning gate, fail-fast secret validation at boot, and the canary redaction test.** | Zero hardcoded secrets and no PII in logs/errors, proven rather than promised. | 3 |
| **LB-9** | **TOTP second factor for `SUPER_ADMIN`, `OFFICE`, `ACCOUNTS`; no email self-reset for any staff role.** *Fallback if the board defers this: launch with stage-3 (`StudentSensitive`) and CSV export switched off.* | `OFFICE` can read the most sensitive tier. Their mailbox is on a cPanel host with DMARC `p=none`. | 4.6 |
| **LB-10** | **Upload pipeline controls** (type, size, content sniff, image re-encode, attachment-only serving, private storage). | Untrusted files from the public internet. | 5.4 |
| **LB-11** | **Legacy data disposition.** The old site's database, with historic Aadhaar/caste/income, stays on the old host after cutover (that host stays paid for mail). It must be inventoried, exported if the school needs it, and deleted from the web-reachable host. | We would otherwise launch a compliant system next to a non-compliant live data store. | 2.7 |
| **LB-12** | **Breach-response runbook with named humans, tested once as a table-top.** | Notification duty runs from awareness, not from convenience. | 8.4 |
| **LB-13** | **Host baseline verified on whichever host is bought:** DB not reachable from the internet, firewall default-deny, SSH key-only, KVM virtualisation. | Docker publishes ports around host firewalls by default. | 5.3, App. E |

### 0.3 Decisions I need from the board

1. **Aadhaar:** do not store (recommended) / store last-4 + "sighted" record only / store the full
   number (only with a cited legal requirement). §2.3.
2. **TOTP for office roles at launch** (LB-9), or launch with stage 3 off.
3. **Data residency:** I **agree** with the Indian-region recommendation, with one condition that
   makes it less decisive than it sounds. §5.6.
4. **Backup target region** (India object storage vs a cheaper foreign one with client-side
   encryption and disclosure). §7.3.
5. **Immediate, no-spend action on the live site:** the legacy form is still collecting Aadhaar,
   caste, income and medical data from minors *today*, over a certificate browsers reject. The school
   should switch off those fields now (or replace the form with "call the office"), not wait for
   cutover. §2.7.

### 0.4 Threat model (STRIDE, condensed)

| # | Threat | Likelihood | Impact | Controls |
|---|---|---|---|---|
| T1 | Parent edits an id (path, query, **or body**) and reads/writes another family's child | High | Severe | §1 |
| T2 | Guessing/stuffing logins; phone number is a guessable username | High | Moderate (one family) | §4.1–4.3 |
| T3 | Account takeover via unverified or hijacked email reset | Medium | Moderate; Severe for staff | §4.5, 4.6 |
| T4 | Malicious upload to the public application form | Medium | High | §5.4 |
| T5 | Insider (office) bulk-reads or exports sensitive data | Low–Med | Severe | §2.2, 2.5 |
| T6 | Teacher's phone lost with offline roster on it | High | Low–Moderate | §5.5 |
| T7 | VPS compromise | Low | Severe | §5.3, §3, §7 |
| T8 | Backup stolen or leaked | Low | Severe | §7.3 |
| T9 | Public-form spam / enumeration / resource exhaustion | High | Low | §5.4 |
| T10 | PII leaks via error messages, logs or the error tracker | **High (default behaviour of our own stack)** | Severe | §3 |
| T11 | Legacy data left reachable | Certain today | Severe | §2.7 |
| T12 | Email outage = parent lockout | Medium | Moderate | §4.5, §5.2, §7 |

---

## 1. Authorisation — resource-level anti-IDOR as a testable rule

### 1.1 The rule

> **R1.** No handler may read or write a record unless the *actor's relationship to that exact
> record* has been established by the central policy layer in the same request. Role is necessary,
> never sufficient.
>
> **R2.** The rule applies to **every identifier the client supplies**: path, query, headers and
> **request body**. Identifiers in a body (the `studentId`s inside an attendance payload) are an
> IDOR vector exactly like `:id` in a URL.
>
> **R3.** "Not yours" and "does not exist" are indistinguishable: the same status (**404**), the same
> RFC 7807 body, no resource-specific text. 403 is reserved for *role* mismatch (a parent calling an
> admin route), which reveals nothing about any record.
>
> **R4.** Parent and teacher endpoints never accept an actor identifier. "My children" is derived
> from the token's `sub`, never from a `userId`/`guardianId` parameter.
>
> **R5.** Authorisation is evaluated against the database on **every request**, not baked into the
> JWT. The token carries `sub` and `role` only: no child ids, no section ids. Unlinking a guardian,
> suspending a user or reassigning a section takes effect on the next request, not at token expiry.
> At 500 families an indexed `EXISTS` per request is free.
>
> UUIDv4 identifiers are *not* a control. They defeat casual enumeration only. The tests below assume
> the attacker already knows the victim's UUID.

### 1.2 Enforced once, centrally

Four layers in NestJS; the first two are the control, the second two are defence in depth.

1. **Default-deny global guard stack.** Registered as `APP_GUARD`, in order: `JwtAuthGuard` (denies
   unless `@Public()`), `RolesGuard` (requires `@Roles(...)`), `ResourcePolicyGuard`. There is no way
   to add a route that skips them; opting out is an explicit, greppable `@Public()`.
2. **Declarative resource policy.** Every handler that takes an identifier declares what it is:
   ```ts
   @Get('children/:id/fees')
   @Roles(Role.PARENT, Role.OFFICE, Role.ACCOUNTS)
   @Policy({ resource: 'student', param: 'id', action: 'read:fees' })
   ```
   `ResourcePolicyGuard` hands `(actor, resource, id, action)` to one `PolicyRegistry`. Each
   resource type has **one** policy class and one SQL predicate:
   - `student`, parent: `EXISTS (Guardian g JOIN StudentGuardian sg … WHERE g.userId = :actor AND sg.studentId = :id)`
   - `section` / `attendance`, teacher: class teacher (write) or subject teacher (read) of that section **in the RUNNING session**
   - `application`, stage-2 token holder: token hash resolves to exactly that application
   - `document`, `media`: resolved *through* their parent (`ApplicationDocument → Application`), never by a free-standing id

   Body-borne ids are validated by the same registry via a `@PolicyBody(...)` declaration: every
   `studentId` in an attendance `PUT` must belong to an `Enrollment` of the target section in the
   target session, or the whole request is rejected and **nothing is written**.
3. **Scoped data access.** Parent- and teacher-reachable services receive a `ScopedPrisma` (a Prisma
   client extension that injects the actor's relationship filter into every query on `Student`,
   `FeeInvoice`, `FeePayment`, `AttendanceEntry`, `Enrollment`), **never the raw client**. An ESLint
   `no-restricted-imports` rule forbids importing the raw `PrismaService` outside admin modules; a
   CODEOWNERS entry makes the CTO a required reviewer for any exception.
4. **Postgres Row-Level Security** is *not* required for V1. It needs `SET LOCAL` per request through
   Prisma transactions and adds operational cost disproportionate to ~500 families. Revisit if the
   system gains a second frontend or direct SQL access.

**Boot-time fail-closed check.** At bootstrap a `PolicyCoverageService` walks every route via
`DiscoveryService`. If a handler has neither `@Public()` nor `@Roles()`, **or** has an identifier
parameter or body field named in the id-registry without a matching `@Policy`/`@PolicyBody`, the
application **refuses to start**. A forgotten check is a crash in CI, not a vulnerability in prod.

**Rules for specific cases**

| Case | Rule |
|---|---|
| Teacher marking attendance | Class teacher of the section only, current session only, **date window `[today−3d, today]`** (covers offline sync lag). Older or `isFinalised` days are `OFFICE`-only. Matrix says "own sections"; the schema comment says "class teacher". Adopted: **read** = class or subject teacher, **write** = class teacher |
| Absent class teacher | Office marks on their behalf (audited). *This is a security feature:* without a sanctioned path teachers will share passwords. A delegate-for-a-day mechanism is a reasonable V1.1 |
| Sensitive tier | Separate `SensitiveGuard`, `OFFICE`+ only; never in a general `Student` response (response-shape test, §1.3 T4) |
| Documents and photos | Private storage, served only through an authorised endpoint or a short-lived signed URL (≤ 5 min, bound to the actor) |
| List endpoints | Scoped by construction (`/me/children`); admin lists paginated, max 100 per page; bulk export only via an audited endpoint |
| Parent with multiple children, shared guardians, separated parents | Access follows `StudentGuardian` rows only. Removing a row cuts access on the next request (R5). The office needs a documented procedure for custody disputes: suspend the link, never delete history |

### 1.3 The tests that prove it

All run on every PR against a real Postgres (the project's Compose stack), as **required checks**.

| Id | Test | Fails the build when |
|---|---|---|
| **T1** Route inventory | Boot the app; enumerate every route; assert each is `@Public()` or carries `@Roles` + (where an id is present) a `@Policy`. Snapshot the list of public routes; the snapshot file has CODEOWNERS = CTO | a route lacks a declaration, or a new public route appears without a reviewed snapshot change |
| **T2** Two-family matrix | Fixture: Family A (parent A1, children s1, s2), Family B (parent B1, child s3); Teachers T1 (section S1), T2 (S2); Office. **Generated from the OpenAPI document + policy metadata**, so new endpoints are included automatically. For every id-bearing route, call as A1 with B's ids (path, query *and* body variants) | response ≠ 404, body differs from the response for a random non-existent UUID (oracle check), response contains any B canary string, or the DB changed |
| **T3** Teacher/body-id | T1 `PUT`s attendance for S1 containing a student of S2; T1 writes to S2; T1 writes for `today−10d`; T1 writes after `isFinalised` | any row written |
| **T4** Sensitive tier | A general student read contains none of `aadhaar*`, `category`, `medical*`; every `GET /admin/students/:id/sensitive` writes exactly one `AuditLog` row; parent and teacher tokens get 404/403 | shape or audit row missing |
| **T5** Liveness of access changes | Delete A1's `StudentGuardian` row, then call with the **same unexpired token**; suspend the user and repeat | any 200 |
| **T6** Guard-bypass tripwire | A test-only controller with no declaration must make `PolicyCoverageService` throw at boot | boot succeeds |

Additional gates: OWASP ZAP baseline against the Compose stack weekly; an authenticated ZAP/manual
pass with two accounts before launch (attackers' view, not just our assertions).

---

## 2. Data classification and retention

The Act has no statutory "sensitive" tier. **Our tiers are risk tiers**, and all of them are
children's data, which is where the Act's strictest rules (verifiable parental consent, no tracking,
no behavioural monitoring or targeted advertising of children) apply regardless of tier.

### 2.1 Classes

| Class | Examples | Controls |
|---|---|---|
| **C0 Public** | notices, content blocks, consented public photos, fee structure | published read-only |
| **C1 Internal** | staff directory, section lists | authenticated |
| **C2 Personal** | child name, DOB, gender, address, parent name/phone/email, attendance, fees, enquiry/application data, student photo | relationship-scoped (§1), TLS, backups encrypted, logs redacted |
| **C3 Restricted** | medical details (stage 3), category/caste, disability status, Aadhaar (if ever stored), birth certificate / TC scans, password hashes, activation/reset/refresh token hashes, TOTP secrets | app-layer encrypted or hashed, separate access path, audited reads, never in logs or errors |

Two fields in the current schema are C3 in practice but sit in C2 tables: **`Student.bloodGroup`**
(health data) and **`AttendanceEntry.note`** (free text; "fever", "hospital" accumulate in it). Change
requests in Appendix C: `bloodGroup` readable by `OFFICE` and the child's class teacher only;
`note` becomes a short coded reason, or is free text restricted to `OFFICE`.

### 2.2 Who may read what

| Data | Anonymous | Parent (own child) | Teacher | Accounts | Office | Super-admin |
|---|---|---|---|---|---|---|
| Public content (C0) | read | read | read | read | read | write |
| Child core (name, DOB, section, photo) | — | read | own sections | read | read/write | read/write |
| Attendance | — | read | own sections; write as class teacher | — | read/write | read/write |
| Fees | — | read | — | read/write | read | read |
| Guardian contact details | — | own only | class teacher: primary guardian phone | read | read/write | read/write |
| Enquiry / application | — | — | — | — | read/write | read/write |
| Application documents | — | — | — | — | read | read |
| `StudentSensitive` (C3) | — | **never** | — | — | read/write, audited | read/write, audited |
| Medical *alert* (see below) | — | read | class teacher | — | read/write | read/write |
| AuditLog | — | — | — | — | read | read |

**Safety vs privacy gap.** A teacher cannot see a child's severe allergy if medical data is
`OFFICE`-only, and in an emergency that is the wrong trade. Recommend a separate, deliberately
minimal `medicalAlert` (≤ 80 chars, e.g. "severe peanut allergy"), visible to the class teacher. Full
medical notes stay in stage 3. This needs a product decision from the school; flagged, not assumed.

**Insider controls.** Every read of `StudentSensitive`, every document download, every CSV export and
every activation-code issue is an `AuditLog` row with actor, entity, IP and time. `OFFICE` bulk
export is rate-limited (e.g. 5/day) and surfaced in a weekly audit digest to the `SUPER_ADMIN`.

### 2.3 Aadhaar — its own answer

**Recommendation: do not store the Aadhaar number. Default OFF.**

Reasoning:

- The PRD's own test is "only where a legal need exists". A legal need must be *nameable*. Nobody
  has named one. Admission to a private school cannot lawfully be conditioned on Aadhaar, and the
  Aadhaar Act restricts private-entity collection and any public display.
- **Parents' Aadhaar is dropped entirely.** The schema already carries only the child's; the
  legacy form's parent Aadhaar fields do not come across. The school has no purpose for them.
- **"Verify-and-discard" does not exist for us.** We are not a UIDAI requesting entity and cannot
  authenticate against UIDAI. The offline paperless e-KYC route yields a signed document with the
  number *masked*, which proves nothing we need. The achievable form of the idea is:
  **store only `aadhaarLast4` and `aadhaarSightedOn` / `aadhaarSightedBy`**. Staff look at the card,
  key any number into the government portal that actually requires it, and our database never holds
  it. This answers "did we check it" without becoming a target.

Decision ladder, in order of preference:

| Option | We store | When |
|---|---|---|
| **A. None** *(recommended default)* | nothing | no named statutory requirement |
| **B. Sighted record** | last 4 digits, who, when | the school wants an audit trail of having checked |
| **C. Full number** | encrypted number | **only** if the school gives a cited rule (act/circular/portal requirement) that obliges *this school* to hold the number. The citation is recorded in config and shown in the notice |

If **C** is chosen, all of the following hold, and the field stays behind a feature flag
(`AADHAAR_FULL_ENABLED=false`) until they are demonstrated:

- **Encryption at rest, in the application, not in SQL.** The blueprint says `pgcrypto`. I would
  change that: `pgp_sym_encrypt(value, key)` sends the key as a query parameter, which is exactly
  what ends up in `pg_stat_statements`, slow-query logs and a replayed WAL. Use **AES-256-GCM in the
  API process**, per-record random nonce, key from the secret store, a key id prefix on the
  ciphertext (so keys rotate without re-encrypting everything at once). The columns are already
  `Bytes`, so no schema change is needed. Same for `medicalNotesEnc`, and for the TOTP secret.
- **Key custody.** The data-encryption key is held in the secret store *and* in offline escrow with
  two named people. Lose it and the data is gone; leak it with a DB dump and the encryption was
  decorative. It is never in the same backup as the data.
- **Display masked** (`XXXX XXXX 1234`) everywhere; the full number is revealed only by an explicit
  "reveal" action, which writes its own `AuditLog` row and is rate-limited per actor.
- **Never** in logs, errors, exports, `AuditLog.before/after`, search, or any email.
- **India-resident hosting and backups** become a launch blocker rather than a preference.
- Deleted when the student leaves (§2.5) unless the cited rule says otherwise.

**Aadhaar leakage in free text.** Staff and parents paste Aadhaar into "address" and "notes". The API
runs a detector (12 digits, optional spaces, **Verhoeff checksum valid**, which keeps false positives
down) on every free-text field of the **public** endpoints and **rejects** with "please don't enter
an Aadhaar number here". The same detector sits in the log redactor (§3.2).

### 2.4 Making the three stages stick in code (LB-2)

The public form is where the legacy system failed. Four independent layers, so a mistake in one
does not reopen the hole:

1. **Strict schemas.** `Enquiry`/`Application` bodies are Zod `.strict()`. `parentDetails`,
   `previousSchool`, `siblings` and `emergencyContact` are JSONB, i.e. a place where *anything* fits.
   Each gets an explicit schema with an allowlist of keys (`occupation`, `designation`,
   `previousSchoolName`, …); unknown keys are a **400**, not silently stored.
2. **Database backstop.** A `CHECK` on each JSONB column rejecting forbidden keys:
   `CHECK (NOT ("parentDetails" ?| ARRAY['aadhaar','uid','income','caste','category','religion','medical','disability']))`.
   It also catches a future migration or admin script that tries.
3. **Forbidden-field CI test.** Walk the Prisma DMMF and the OpenAPI request schemas for every
   `@Public()` write route and for `Enquiry`/`Application`/`ApplicationDocument`; fail if any field
   name matches `/aadhaar|uid|income|caste|categ|relig|medical|disab|health|blood/i`.
   Adding a sensitive field to a public form then needs a deliberate edit to the test's allowlist,
   which is CODEOWNERS-protected.
4. **Aadhaar-pattern rejector** on public free text (§2.3) and **a document-kind rule:**
   `ApplicationDocument.kind = OTHER` is accepted but the UI states "do not upload Aadhaar or
   medical documents"; staff have a documented delete-on-sight procedure for any that arrive.

**Stage-3 enablement is explicit:** the office creates `StudentSensitive` only after `APPROVED`,
through the sensitive endpoint, recording `consentRecordedAt` and `consentBy` (a guardian,
not a staff member). Requires: the parental-consent record (§8.2), and for each field a stated purpose.

### 2.5 Retention

Periods are proposals. Those marked *(confirm)* depend on education-department and tax rules the
school or its auditor must confirm. I will not invent a statutory number.

| Data | Proposed retention | End of retention |
|---|---|---|
| **Enquiry** (not converted) | 12 months from the intake session's close | hard delete |
| **Application + documents, rejected / withdrawn** | 6 months from decision (grievance window) | hard delete, incl. files |
| **Application + documents, approved** | birth certificate and TC copies become part of the student file | follow student file |
| **Student core record** (name, DOB, admission no., class history, TC particulars) | permanent: this is the school's admission register *(confirm)* | kept; see "lawful deletion" below |
| **`StudentSensitive`** (medical, category, Aadhaar if any) | until the student leaves + 30 days, unless a cited rule says longer | **hard delete**, row and ciphertext |
| **Attendance entries** | 3 years after session close *(confirm)* | aggregate to counts per student-session, then delete rows |
| **Fee invoices and payments** | 8 years *(confirm with the school's auditor)* | pseudonymise: keep amounts and receipt numbers, drop name linkage where permitted |
| **Parent `User` account** | until the last linked child leaves + 90 days | deactivate, then delete; `Guardian` contact details follow the student file |
| **Student photos (portal)** | while enrolled | delete at exit |
| **Public photos** | until consent withdrawn, or 3 years, whichever first | unpublish + delete; renew consent to extend |
| **`MediaConsent` evidence slips** | life of the consent + 1 year (proof we had it) | delete |
| **Activation / reset / refresh tokens** | until expiry + hourly sweep (BLUEPRINT §6) | hard delete |
| **`AuditLog`** | 3 years | delete; rows contain no C3 values (§3.2) |
| **Application logs, Caddy logs** | 1 year, India-hosted | rotate/delete |
| **Backups** | **max 35 days**; declared in the notice | expire |

*Logs: the Rules, as I read them, expect security logs to be kept for a year so a breach can be
investigated, and the CERT-In Directions expect ICT logs for 180 days within India. A one-year,
India-hosted log with redaction (§3.2) satisfies both and does not turn the log into a PII store.*

### 2.6 Withdrawal of consent and lawful deletion

**What withdrawal does.** The Act lets a parent withdraw consent, and withdrawal must be as easy as
giving it. The school's duty is to stop processing and delete the data unless a law requires keeping it.

| What is withdrawn | Effect | By when |
|---|---|---|
| Photo consent | Asset to `UNPUBLISHED`, public pages revalidated (already built, `PHOTO-CONSENT` §5) | immediate |
| Stage-3 data | `StudentSensitive` fields hard-deleted; row kept as a tombstone with `consentWithdrawnAt` | 7 days |
| Enquiry or application (child not enrolled) | hard delete of rows and files | 30 days |
| Portal account | `User.status = SUSPENDED`, refresh tokens revoked, then deleted; the child's school record is **not** deleted | immediate / 30 days |
| Consent to the *school record itself* | **cannot** be withdrawn while the child is enrolled; the school holds it by legal obligation, not consent, and the notice says so | n/a |

**What a lawful deletion actually removes.** "Delete the child" is not one operation. Saying so in the
notice is more honest than promising total erasure:

| Layer | Treatment |
|---|---|
| Rows (`Enquiry`, `Application`, `StudentSensitive`, tokens, consents) | hard delete, in one transaction, inside an `ErasureLedger` row (§below) |
| Files (documents, photos, consent slips) | delete from storage, verify absence; the key goes with the row |
| Derived artefacts | ISR/CDN pages revalidated; any cached signed URL expires in ≤ 5 min; offline copies on teachers' devices clear on the next sync |
| Student core record | **retained** where the admission register is a legal record *(confirm)*; for ex-students past retention, reduce to `admissionNo`, class history |
| Fee/payment records | retained for the accounting period; name linkage dropped where permitted |
| `AuditLog` | retained (3 years); holds ids, not values |
| App/Caddy logs | already redacted; expire at 1 year |
| **Backups** | **cannot be edited.** They expire within 35 days; the notice says so |

**The restore trap.** Restoring last week's backup *resurrects* data already lawfully erased.
So deletions append to an **`ErasureLedger`** (`entity`, `entityId`, `erasedAt`; no PII), which is also
written to the off-host bucket outside the backup rotation. **The restore runbook's step 6 is "replay
the ledger"** (§7.5). Without this, every disaster recovery quietly breaks a deletion promise.

### 2.7 Legacy data (LB-11)

The live site's admission form holds historic submissions with Aadhaar (child and both parents),
caste, income and medical data. After cutover, the old cPanel account stays alive for mail, **so that
database does too**. I have not seen the database, only the form (`DISCOVERY`, legacy admission form section); access is a school
action. Required:

1. **Now, no spend:** disable the sensitive fields on the live form (or replace it with a
   "contact the office" notice). It is collecting minors' Aadhaar over a certificate that browsers
   reject. Aside from legality, that means in-transit identity is unauthenticated.
2. **Before cutover:** inventory the legacy tables (row counts and field names; not the contents
   passed through chat or email).
3. **Decide what survives.** Enrolled students' core data is migrated into the new schema. Rejected
   or old applicants, parents' Aadhaar and income are not migrated.
4. **Delete** the remainder from the web-reachable host, and delete the legacy public form so it
   cannot continue collecting after the DNS change. Keep the mail only.
5. Record the disposition in the retention log. This is part of the DPDP evidence pack.

---

## 3. Secrets and logging

### 3.1 Secrets

| Rule | Mechanism |
|---|---|
| Zero secrets in the repo, image, build args or Compose file | `gitleaks` in pre-commit **and** as a required CI check (full history scan on first run); `.env.example` holds names, never values |
| Secrets reach the process as files, not environment strings | Compose `secrets:` mounted at `/run/secrets/*`, read via `*_FILE`; host files `0600`, owned by the deploy user. (`docker inspect` and crash dumps expose env vars; they do not expose a file on tmpfs the same way) |
| Fail fast | A Zod schema validates config at boot. A missing, empty, placeholder (`changeme`, `secret`) or too-short (< 32 bytes for keys) value **aborts startup**. The test boots with an empty env and asserts non-zero exit |
| One value per environment | dev, staging and prod never share a signing key, DB password or encryption key |
| Rotation is a procedure, not a hope | Documented per secret: JWT signing key (`kid` header; two keys valid during rotation), DB password, SMTP credential, field-encryption key (key-id prefix, background re-encrypt), backup repo password. Rotated on any staff departure and at least annually |
| Least privilege | **Three Postgres roles:** `migrator` (DDL; used only in deploy), `app` (DML; no DDL), `audit_writer`-style grant so `AuditLog` is **INSERT-only** for `app` (no `UPDATE`/`DELETE`), which makes "append-only" a database fact |
| Inventory | Signing key, DB passwords, field-encryption key, SMTP credential, backup repo password, backup-bucket credential (**write-only** from the VPS: see §7.3), TOTP encryption key |
| Backup/escrow | The backup password and field-encryption key live in the school's password manager with **two named holders**. They are never stored only on the VPS |

### 3.2 Logging and error handling (T10)

The default behaviour of our own stack leaks. **Prisma validation errors print the entire query,
including the data.** NestJS's default exception filter, an `error.message` interpolated into a
response, and an error tracker's default request capture all exfiltrate PII into places we do not
control. So:

1. **Structured JSON logs** (pino) with an explicit **redact list**: `req.headers.authorization`,
   `cookie`, `set-cookie`, `body.password`, `body.code`, `body.token`, `*.aadhaar*`, `*.dob`,
   `*.phone`, `*.email`, `*.address`, `*.note*`, `*.medical*`, plus the Aadhaar detector (§2.3) as a
   catch-all on every string value.
2. **No bodies.** Request and response bodies are not logged. URLs are logged **without query string**,
   and path tokens are replaced (`/admissions/apply/:token`, `/auth/password/reset/:token` →
   `[redacted]`). Caddy's access log is configured the same way (App. D), since a 256-bit link token in
   an access log is a credential in a file.
3. **People are `userId` (UUID) in logs.** Phones and emails, where they must appear, are masked
   (`98XXXXXX56`, `p***@gmail.com`).
4. **Error messages are static.** A global exception filter maps every error to an RFC 7807 body with a
   fixed `type`, a generic `title`, the `X-Request-Id`, and **no interpolated entity data**: never a
   student name, an amount, a date, an attendance status, a SQL fragment or a Prisma `meta`. Zod
   errors return field paths and rule codes, **not the received value**. The full error goes to the
   (redacted) log only.
5. **Attendance and fee data specifically** never appear in: error text, 4xx bodies, log lines,
   the error tracker, notification emails beyond what the parent already sees in-app, or the
   `AuditLog.before/after` JSON. For C3 entities `AuditLog` records **which fields changed**
   (`["aadhaarLast4"]`), not their values. Money and attendance mutations record ids and the
   changed-field list; the values live in the table itself.
6. **Error tracker** (GlitchTip): `sendDefaultPii: false`, a `beforeSend` scrubber with the same redact
   list, and request bodies dropped. Host it on the **staging box, not the production VPS**, partly for
   RAM (GlitchTip plus its dependencies is ~1 GB, a quarter of a 4 GB host) and partly so
   production has no inbound dependency on it.
7. Swagger UI/OpenAPI explorer, `/metrics` and debug routes are **off or authenticated** in production.

**Proof: the canary test.** The fixture student is named `CANARY-NAME-7731`, with a fee of ₹98765.43
and an attendance note `CANARY-NOTE`. A test drives 400, 401, 403, 404, 409, 422 and a forced 500
through every sensitive endpoint, captures the HTTP body, the log stream and the tracker payload, and
fails if any canary appears. It runs in CI.

---

## 4. Authentication hardening

### 4.1 Passwords (all roles)

Follows NIST SP 800-63B: length over composition rules.

| Control | Value |
|---|---|
| Minimum length | **10** characters (parents type on phones; length beats symbols). Maximum 128 |
| Composition rules | **None**. No forced symbols or digits, no forced rotation |
| Blocklist | Offline list of the ~100k most common passwords **shipped in the repo** (no call to a third-party service at login); also reject the user's phone number, email local-part, child's name, school name, and `hca`/`pilani` + digits |
| Hashing | **argon2id**, m = 19 MiB, t = 2, p = 1 (OWASP floor). Re-hash on login if parameters rise |
| Concurrency | Hash/verify runs behind a semaphore (≤ 4 concurrent). 30 teachers logging in at 08:00 must not exhaust a 4 GB box |
| Timing | An unknown username still performs a dummy argon2 verify; same response body and status as a bad password |
| Change | Requires the current password; revokes every other session |

### 4.2 Activation codes

Per ADR-001: 10 characters, 32-symbol alphabet (~50 bits), argon2id-hashed, single use. At 10 attempts
per 15 minutes per account that is ~29,000 guesses in the full 30-day window against a 10¹⁵ space,
so online guessing is infeasible; the code's real risks are paper-based. Therefore:

- **Shown once** to the office at issue time; never stored in plaintext, never logged, **never in
  `AuditLog.after`** (only "issued", expiry and issuer).
- **TTL: keep 30 days for admission-time slips; 7 days for office reissues** (a reissue is a
  reset and is usually handed over in person within a day). Amendment to BLUEPRINT §2.1.
- Issuing a new code revokes the password and all refresh tokens (as designed) and **voids any
  unconsumed earlier code** for that user.
- Activation is `phone + code`; an unknown phone or wrong code returns an identical response,
  with a dummy hash, and counts toward the per-account counter and the per-IP limit.
- Once consumed or expired it is deleted by the hourly sweep.

### 4.3 Rate limits, lockout

Two independent layers, because phone numbers are guessable and a school sits behind shared IPs.

| Endpoint | Per-IP | Per-account / per-target |
|---|---|---|
| `POST /auth/login` | 30 **failures** / 15 min | **10 failures → lock 15 min** (BLUEPRINT); successful login resets |
| `POST /auth/activate` | 10 failures / 15 min | shares the 10-failure counter |
| `POST /auth/password/forgot` | 10 / hour | **3 / hour per account**, always responds `202` with the same body and timing |
| `POST /auth/password/reset` | 10 failures / hour | token is single-use |
| `POST /auth/refresh` | 60 / 15 min | reuse of a revoked token revokes the family |
| `POST /public/enquiries` | 5 / hour | proof-of-work (below) |
| Stage-2 token routes | 60 / 15 min | per-token cap on uploads |
| Everything else authenticated | 300 / min per user | |

Design points that are easy to get wrong here:

- **Count failures, not requests.** At 08:00 thirty teachers log in from **one NAT'd school IP**;
  a naive per-IP cap locks the school out of attendance at the busiest minute of the day. Successful
  logins are not counted against the per-IP budget.
- **Mobile carriers also NAT** many parents behind one address, so per-IP limits are deliberately
  generous. The per-account lockout is the real brute-force control.
- **Trusted proxy.** Nest trusts exactly one hop (the Caddy container). Caddy overwrites a
  client-supplied `X-Forwarded-For` (it trusts no upstream proxies unless configured). Misconfiguring
  this keys every limit on Caddy's own IP, or on a header the attacker chooses.
- **Lockout is a DoS lever** (anyone can lock a parent out by typing a wrong password 10 times).
  Accepted: the lock is 15 minutes, parents recover by waiting or by email reset, and the alternative
  is no lockout. The lock response is the same generic 401, so it does not confirm the account exists.
  Limits live in `@nestjs/throttler` (in-process: single instance; no Redis is added to the stack);
  lockout state lives in the database so a restart does not reset it.
- **No CAPTCHA vendor.** Google reCAPTCHA is a third-party tracker on a children's service. The
  public enquiry form uses a self-hosted proof-of-work challenge (**Altcha**, MIT) plus a honeypot.

### 4.4 Sessions and refresh

| Control | Value |
|---|---|
| Access token | JWT, **15 min**, held in memory (not `localStorage`), `Authorization: Bearer`. Algorithm pinned (EdDSA or HS256 ≥ 256-bit), `none` and algorithm-confusion rejected, `kid` for rotation, `iss`/`aud` checked |
| Refresh token | Opaque 256-bit random, stored as SHA-256 hash (high entropy, so a fast hash is right), rotated on every use, **family revoked on reuse** (as designed) |
| Transport | `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie. The refresh/logout endpoints are the only cookie-authenticated ones, so CSRF reaches only them: `SameSite=Strict` plus an `Origin` check |
| Parent lifetime | 90-day "remember this device" (ADR-001): explicit tick-box on login; otherwise session cookie |
| **Staff lifetime** | **12 h absolute, 60 min idle**; no remember-me. `SUPER_ADMIN`/`OFFICE`/`ACCOUNTS`: 8 h absolute, 30 min idle |
| Re-authentication | Password required to change password, change email, or reveal masked C3 data |
| Revocation | Password change/reset, activation-code reissue, suspension, and an admin "sign out everywhere" (the **lost-phone** action) each revoke all families |
| Authenticated responses | `Cache-Control: no-store`; the service worker must not cache them (§5.5) |

### 4.5 Email as a security property

The board's no-SMS decision made **email the account-recovery channel for parents.** That has three
consequences, and each needs a control, not a note.

**(a) An unverified email is not an identity.** `Guardian.email` is typed by office staff at admission
and `User.email` can be added by a parent. A typo, a stale address, or an attacker-added address
turns "forgot password" into "attacker resets password". Therefore:

- **Reset mails go only to `User.email` where `emailVerifiedAt IS NOT NULL`.** The schema has no such
  column; it is added (Appendix C). `Guardian.email` is never a reset target.
- Adding or changing an email sends a verification link (single-use, 24 h) to the **new** address and a
  notice to the **old** one; the change needs the current password.
- Every reset, successful or not, sends "your password was changed" to the verified address.

**(b) The reset token.** 256-bit random, SHA-256-hashed at rest, **1 h TTL**, single use, **issuing
a new one voids the old**, completion revokes all refresh tokens. The link host comes from **config,
never from the `Host` header** (host-header poisoning is how reset links get pointed at an attacker).
The reset page sends `Referrer-Policy: no-referrer`, and the token is exchanged for a one-time form
immediately so it does not remain in the address bar.

**(c) Availability is security.** If SMTP is down, parents cannot recover accounts; if reset mail
lands in spam, the effect is the same. So:

- **SMTP is a monitored dependency:** a synthetic "send test mail to a school mailbox" every
  15 minutes, alerting on failure. The mail path has its own Uptime Kuma check.
- **SPF, DKIM, DMARC for the new sender go live in the same sitting as the A-record change**
  (`DNS-AND-EMAIL-CUTOVER` §3). Move DMARC `p=none → quarantine` after DKIM is confirmed.
- **Prefer the school's existing authenticated SMTP relay** over sending direct from a fresh VPS
  IP with no reputation (`DNS-AND-EMAIL-CUTOVER` §3).
- **SMTP TLS is verified, no exceptions.** The mail host's certificate is today issued for
  `mail.hcapilani.in`, not `mail.hca.edu.in`. A developer will meet a certificate error and reach for
  `rejectUnauthorized: false`. **That is prohibited** and a lint rule bans it. The real fixes are to
  enable AutoSSL for `mail.hca.edu.in` on the old host, or relay through a provider with a valid
  certificate. STARTTLS is required, with no plaintext fallback.
- **Fallback exists:** the office-reissue path (§4.2) works with no email at all.
- **Cutover change control.** No MX, `mail.` A, SPF or DMARC record is edited except per the
  cutover document, by a named person, with TTLs lowered 24 h before and the old values written down.

### 4.6 Privileged accounts

`OFFICE`, `ACCOUNTS` and `SUPER_ADMIN` can read the most sensitive tier and export data. They are the
attractive targets, and their mailboxes sit on a shared cPanel host with DMARC `p=none`.

- **No email self-service reset for any staff role.** Email reset is **PARENT-only.** Staff resets
  are admin reissues; the `SUPER_ADMIN`'s is a documented break-glass (two named people, offline
  recovery codes). Teachers are on-site; an admin reissue costs minutes.
- **TOTP (RFC 6238) is mandatory for `SUPER_ADMIN`, `OFFICE`, `ACCOUNTS`** (LB-9), with 10 single-use
  recovery codes. No SMS involved (so no TRAI dependency). `otplib` is MIT. TOTP secrets are
  encrypted with the field-encryption key. Teachers: optional at launch.
- **Role changes and `SUPER_ADMIN` grants** are audited and require the actor to re-authenticate.
- Super-admin count is kept to two.

---

## 5. Transport and infrastructure

### 5.1 TLS (LB-7)

**Does our config close the certificate warning? Yes, by construction, with caveats that I want on
the record.** Caddy obtains and renews a Let's Encrypt certificate for exactly the names in the site
block, so the mismatch is structurally impossible *once DNS points at the host and 80/443 are
reachable*. I cannot prove it today because nothing is deployed; the proof is a post-deploy check,
below. Caveats:

1. **Chicken and egg at cutover.** HTTP-01 validation needs the A record to already point at the new
   host. Between "A record switches" and "Caddy gets its certificate" there is a short window
   (seconds to a few minutes) of the wrong certificate. Mitigations: TTL lowered to 300 s a day ahead
   (already planned), Caddy started *before* the switch so it is ready, and a rehearsal on a real
   subdomain (`staging.hca.edu.in`) against **Let's Encrypt's staging CA first**. Let's Encrypt limits
   failed validations (≈ 5/hour/hostname), so repeated blind retries during DNS propagation are
   self-inflicted lock-out.
2. **Persist Caddy's data volume** (`/data`). Lose it and you re-issue; re-issue too often and you
   hit Let's Encrypt's duplicate-certificate limit during a disaster restore. It is part of the backup set (§7).
3. **Renewal depends on port 80 staying reachable** and DNS staying correct. A certificate-expiry monitor
   (alert at < 14 days) is mandatory.
4. **`hcapilani.in`** (the second domain): if its A record is pointed at the new host to serve a 301,
   its `mail.` and MX records stay put for the same reason as in the cutover doc. It needs its own certificate name.

**Post-deploy assertion** (runs in the deploy script and weekly in Uptime Kuma): TLS 1.2+ only; the
served certificate's SAN contains `hca.edu.in` and `www.hca.edu.in`; chain valid; > 14 days to expiry;
`http://` redirects to `https://` with a single 301; `www → apex`. `testssl.sh` or `openssl s_client -verify_hostname`.

**Policy:** TLS 1.2 and 1.3 (Caddy's defaults, which are already sound); no cipher tuning. HTTP/3 is
fine, in which case publish `443/udp` too. **HSTS is staged**: `max-age=300` at launch, `86400`
after a week, then `31536000`. **No `includeSubDomains` and no preload.** The `mail.` host runs on the
old server with a mismatched certificate; `includeSubDomains` would make webmail unreachable.

### 5.2 Headers

| Header | Value | Note |
|---|---|---|
| `Strict-Transport-Security` | staged, see above | no `includeSubDomains` |
| `Content-Security-Policy` | see below | **report-only for two weeks pre-launch, then enforced** (launch gate) |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin`; **`no-referrer`** on `/admissions/apply/*` and reset pages | path tokens must not leave |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()` | the upload uses the OS picker, not `getUserMedia` |
| `Cross-Origin-Opener-Policy` | `same-origin` | |
| `X-Frame-Options` | `DENY` | legacy twin of `frame-ancestors 'none'` |
| `Cache-Control` | `no-store` on `/api/*` authenticated and portal/admin pages | shared phones, back button |
| `Server` / `X-Powered-By` | removed | |

**CSP, honestly.** Next.js strict **nonce** CSP forces dynamic rendering, which would give up the
static/ISR performance the public site is chosen for. So two policies by path (Next middleware):

- **Portal and admin (dynamic):** nonce-based, `script-src 'self' 'nonce-…' 'strict-dynamic'`,
  `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`, `connect-src 'self'`, `img-src 'self' data: blob:`.
- **Public static pages:** same, but `script-src 'self' 'unsafe-inline'` for Next's inline bootstrap.
  This is weaker, and is acceptable only because public pages render **no user-supplied HTML.**
  Therefore **CMS notice bodies are Markdown rendered without raw HTML or sanitised with an
  allowlist (`sanitize-html`)**, never `dangerouslySetInnerHTML` on office input.

**No third parties on a children's service.** No Google Analytics, no Google Fonts CDN (self-host the
fonts), no embedded Maps/YouTube iframes (link out, or a static map image), no reCAPTCHA. This is both
the Act's no-tracking rule for children and a privacy-notice simplifier ("no cookies except the
essential login cookie"). Optional visitor statistics: self-hosted, cookieless, public site only
(Umami, MIT), never the portal.

**CORS.** **Same-origin.** Caddy serves the site and routes `/api/*` to NestJS on the same
host, so there is no cross-origin request and CORS is **disabled** (no `Access-Control-*`
headers), not "allow list". No `*`, ever. If a separate API origin is ever introduced it is an exact-origin allowlist, with credentials only
on the cookie endpoints.

### 5.3 Host and container baseline (LB-13)

| Control | Requirement |
|---|---|
| Exposure | **Only 80, 443 (+443/udp) and SSH.** Postgres, NestJS and Next.js bind to the internal Compose network with **no `ports:` mapping.** *Docker inserts its own iptables rules ahead of UFW; "UFW is on" does not stop a published port.* The check is an **external port scan** after deploy |
| SSH | Key-only, no root, no password auth, non-default port optional, `fail2ban` or CrowdSec; admin keys named per person |
| OS | Unattended security updates; monthly patch routine (ADR-001) with a calendar entry, not a memory |
| Containers | Non-root user, `read_only: true` root filesystem + tmpfs for temp, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, memory limits, images pinned by digest |
| Supply chain | Dependabot (or Renovate), `npm audit`/OSV-scanner and **Trivy** on images in CI; fail on High/Critical with a fix available |
| Database | Separate roles (§3.1); `log_statement = none`; `log_min_duration_statement = 200ms` with parameters **not** logged; no `pg_stat_statements` exposure outside the DB |
| Time | NTP synced (also a CERT-In expectation) |
| Virtualisation | **KVM/full virtualisation** (Docker does not run properly on container-based VPS). Host-dependent: verify at purchase |
| Disk encryption | **Not relied upon.** On a VPS the key sits in the same machine and the provider can image the disk. Protection is application-layer encryption for C3 and client-side-encrypted backups. Provider volume encryption is welcome where offered, not counted |
| Monitoring | External probe, see §6.3 |

### 5.4 Upload validation (LB-10)

Application documents arrive from **the public internet, from people we have not authenticated**, via
a link that may have been forwarded. Treat every file as hostile.

| Control | Rule |
|---|---|
| Who | Only the holder of a valid stage-2 token, scoped to **one application**. No anonymous upload endpoint exists |
| Size | **5 MB per file, 6 files, 15 MB per application.** *(BLUEPRINT says 2 MB; HOSTING §1 sizes at ~5 MB; phone photos of certificates routinely exceed 2 MB, and a limit parents cannot meet gets worked around by emailing Aadhaar scans to the office. Reconcile at 5 MB)*. Enforced at **Caddy (`request_body max_size`)** and again while **streaming** in Nest, before the body is buffered |
| Allowed types | JPEG, PNG, PDF. Nothing else (no SVG, HTML, Office, archives, WebP) |
| Type check | **Magic-byte sniffing** (`file-type`), extension and client `Content-Type` ignored; mismatch → reject. `ApplicationDocument.mimeType` stores the sniffed type |
| Images | **Re-encoded** (`sharp`) to strip payloads and **EXIF/GPS**: a phone photo of a child's certificate taken at home carries the home's coordinates. Max pixel dimensions capped (decompression-bomb guard) |
| PDFs | Not rendered server-side. Structure check (no `/JavaScript`, `/Launch`, `/EmbeddedFile`); served **only** as `Content-Disposition: attachment` |
| Malware | **ClamAV (`clamd`) as a separate container, if the host has ≥ 4 GB** (it needs ~1 GB+). On a 2 GB host skip it and accept PDFs download-only. *Recommended, not launch-blocking, but the rest of this table is* |
| Storage | **Outside any web root**, random UUID keys, original filename kept as metadata only, mode `0600`, never executable, never served as static |
| Serving | Only through an authorised endpoint (§1) with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Content-Disposition: attachment`; never inline in the admin origin |
| Quota | Disk quota alarm at 70%; per-IP and per-token upload limits (§4.3) |
| Abuse | Stage-1 enquiry: Altcha + honeypot + 5/hour/IP; **uniform responses** so the form cannot be used to enumerate which phones have enquired |
| Stage-2 link token | 256 bits, SHA-256-hashed at rest, 30-day TTL, scoped to one application, **revoked on submit** (the office reissues if a correction is needed). On first load the token is exchanged for a short-lived cookie and the browser is redirected to a token-less URL; logs redact it (§3.2) |

### 5.5 Offline attendance and lost phones

The PWA keeps the roster and an outbox on teachers' phones (IndexedDB). That is personal data at rest on devices we do not control.

- Store the minimum: `studentId`, name, roll number, section. **No DOB, photo, phone or guardian data.**
- **The service worker never caches** `/api/*` responses for parent or admin routes (`no-store`, plus a
  denylist in the Workbox config). Only the teacher roster endpoint is cached, and only for the day.
- **Logout wipes IndexedDB and caches** (after flushing the outbox, or warning if it cannot). Auto-wipe
  after 7 days of inactivity.
- **Lost phone procedure:** the office hits "sign out everywhere"; the next sync fails and wipes.
  Residual risk: a device that never reconnects keeps its roster. Accepted and stated; mitigated by the phone's own lock screen.
- The outbox is replay-safe by design (`(sectionId, date)` idempotency), and the server's date window (§1.2) stops a stale replay rewriting old registers.

### 5.6 Data residency: my position

**I agree with the Indian-region recommendation. I also think it is less decisive than it sounds, and the board should know what actually moves the risk.**

- *For India:* parents' trust ("where is my child's data?") and one less transfer to explain. The
  Act permits transfer abroad except to countries the Government restricts (none today), so
  Option E (Hetzner) is **lawful**. Rejected for the *conversation*, as `HOSTING` §3 says, and because
  CERT-In log-location expectations and any future sector localisation are easier met in India.
- *Why it is less decisive:* residency protects against a jurisdictional risk; what protects a
  child's data from an attacker is **collecting less, access control and encryption.** If Aadhaar is
  never stored (my §2.3 recommendation) and C3 is app-layer encrypted, I would accept a non-India
  host **with disclosure in the notice.**
- **The condition:** *if the board chooses to store the Aadhaar number, India-resident hosting and
  India-resident backups are a launch blocker, not a preference.*
- The host is a **data processor**: keep the provider's terms/DPA on file, and list it in the notice (§8).
- Staging on Oracle free (Option A) is fine **only with synthetic data**. Never load real student
  records into a no-SLA free tier that can be reclaimed.

Host-dependent controls are consolidated in Appendix E.

---

## 6. SLAs

### 6.1 Sizing from reality

| Driver | Reality |
|---|---|
| Users | ~500 families, ~30 staff |
| Peak | Attendance, **08:00–08:30**, Mon–Sat: ~30 teachers, one `PUT` each (plus retries and roster loads), plus 30 near-simultaneous logins at ~08:00 |
| Expected load | Average < 1 req/s; burst ≈ 20 req/s for a few seconds; ≤ 60 concurrent sessions |
| Design headroom | Verified to **100 concurrent users / 50 req/s** (≈ 5× burst) with budgets held |
| Data | < 1 GB database for years; ~1.5 GB/year of documents |

### 6.2 Targets

| Measure | Target | Notes |
|---|---|---|
| **Availability**, monthly | **99.5%** (≈ 3.6 h/month), measured by an external probe | Honest for one VPS without HA. 99.9%+ would need a second host, which the school's budget does not justify |
| **Availability, 07:55–08:35 Mon–Sat** | **99.9%** | Achieved by *scheduling*, not hardware: no deploys, patches, backups-with-load or migrations between 07:30 and 09:00. Deploys after 15:00 or on Sunday |
| **Offline durability** | **0 lost attendance marks** through any outage up to the device-wipe window | The outbox turns an availability requirement into a durability one |
| API latency, server-side | read **p95 < 200 ms, p99 < 500 ms**; attendance `PUT` (≈ 40 rows) **p95 < 400 ms**; login **p95 < 800 ms** (argon2 is deliberately slow) | |
| Database | p95 query < 20 ms; slow-query log > 200 ms; pool 10 connections; `max_connections` 50 | |
| Public pages (mid-range Android, 4G) | **LCP < 2.0 s (p75)**, INP < 200 ms, CLS < 0.1; **initial JS ≤ 150 KB gz**, hero image ≤ 150 KB | Stricter than the "good" threshold because these pages are static and there is no excuse |
| Portal | LCP < 2.5 s; attendance screen interactive < 2 s on cached load | |
| Error rate | 5xx < 0.5% of requests | |
| Reset email delivery | 95% within 2 min | §4.5 |
| Backup freshness | newest verified backup < 26 h old (hourly dumps, §7) | alert, not just a log line |

### 6.3 Measuring them

- **Load test (launch gate):** k6, 100 virtual users for 10 min, mixed profile weighted to the
  08:00 window. It runs **on the purchased production-sized host before DNS cutover**; the staging box is
  not representative hardware. Budgets must hold.
- **Uptime Kuma runs on the staging host, not the VPS it watches**: a monitor on the box that has gone
  down reports nothing. It also receives the backup and SMTP heartbeats. Alerts go to the school's mail
  (hosted separately on the old server) and to a named phone number.
- `/healthz` (liveness) and `/readyz` (DB reachable, migrations current). Every response carries
  `X-Request-Id`; request ids appear in logs and in RFC 7807 bodies.
- Observability is not optional: structured logs, health checks, error tracking and latency telemetry (OpenTelemetry-compatible
  export if wanted) ship with the first release. An architecture without them is not approved.

---

## 7. Backups and recovery

### 7.1 Targets

| | Target | How |
|---|---|---|
| **RPO** | **≤ 1 hour** during school hours; ≤ 24 h worst case overnight | Hourly `pg_dump` 06:00–20:00, nightly otherwise. The database is < 1 GB: a dump takes seconds, so hourly is trivially cheap. *Nightly alone (BLUEPRINT §6) gives a 24-hour RPO, which means losing a whole day of fee receipts whose numbers are already printed on paper: duplicate receipt numbers are an audit problem* |
| **RTO** | **4 hours** (one operator, new VPS from nothing) | Proven by drill; the measured time replaces this guess |
| Attendance during an outage | no loss | offline outbox (§5.5) |
| WAL archiving (`pgBackRest`, MIT) → RPO of minutes | *Should-have*, not launch-blocking | The extra moving part is justified only if hourly proves insufficient |

### 7.2 What is backed up

Postgres dump; uploaded documents and photos; Caddy `/data` (certificates); the **deploy
configuration** (Compose, Caddyfile, migrations: in git, not needed); the **ErasureLedger** (§2.6).
**Not** in the backups: secrets (separate escrow, §3.1).

### 7.3 Where and how (LB-6)

- **Tool:** `restic` (BSD-2): encrypted, deduplicated, one repository for dumps (`--stdin`) and files.
- **Client-side encryption.** The provider only ever sees ciphertext. The repo password is in escrow with two holders, not just on the VPS.
- **Off-host and a different failure domain from the VPS.** Not the same provider's volume.
- **Credentials are write-only (append-only) from the VPS**, with bucket versioning/object lock
  where the provider offers it (R2 bucket locks, B2 Object Lock, S3 Object Lock: verify current
  feature on the chosen provider). A compromised VPS must **not** be able to delete the backups, which is the ransomware pattern.
- **Residency.** Cloudflare R2 and Backblaze B2 have no Indian region. With client-side encryption the data they hold is ciphertext,
  which I consider adequate *if Aadhaar is not stored* (§2.3, §5.6) and the notice discloses it. My preference is **Indian S3-compatible
  storage** (E2E Networks object storage, or S3 Mumbai) so the answer to "where are the backups" is the same as "where is the server". Board decision #4.
- **Retention: 35 days, no longer.** Longer retention keeps lawfully erased data (§2.6). Restic `forget --prune` runs on schedule.
- **Freshness is monitored.** Each job pushes a heartbeat to Uptime Kuma; no heartbeat in 26 h is an alert. "The backup job ran" is not the same as "a backup exists".

### 7.4 Verifying the restore path, not just the job

| Check | Cadence |
|---|---|
| Automated **restore into a scratch container**, then: migrations apply cleanly; row counts within tolerance of production; `MAX(receiptNo)` per session matches; latest `FeePayment` present; sample of 20 uploaded files hash-matches; `restic check` passes | **Weekly** (cron on the staging host), result pushed as a heartbeat |
| **Full DR drill:** new VPS built from nothing using *only* the off-host repo plus escrowed secrets; stopwatch running; site up and a test parent can log in; ErasureLedger replayed | **Once before launch (gate), then quarterly.** Results appended to `docs/ops/DR-DRILL-LOG.md`: date, who, measured RTO, what broke |
| Key-escrow test | At the drill: the second holder, alone, can decrypt a backup |

### 7.5 Restore runbook (outline; written and rehearsed before launch)

1. Declare the incident; stop writes (maintenance page from Caddy). 2. New VPS (§Appendix E host checks). 3. Pull secrets from escrow.
4. `restic restore` the latest verified dump and files. 5. `docker compose up`; apply migrations. **6. Replay `ErasureLedger`** so erased data is not resurrected. 7. Verify
`/readyz`, receipt-number continuity, and one end-to-end parent login (this proves SMTP/reset too). 8. Repoint DNS (TTL already 300) only after 7. 9. Post-mortem within 5 days; blameless.

---

## 8. Launch-blocking privacy artefacts (LB-4, LB-12)

### 8.1 What is drafted here, and what the school must supply

Drafted in Appendix A: the **public privacy notice**, and the **consent/notice lines** that sit on the
enquiry and application forms. These are drafts for counsel and the school to adopt, not finished legal text.
Not drafted, **because only the school has them**, Appendix B: Grievance Officer name and contact, the
legal entity, the retention confirmations, the hosting/processor details once chosen, and a Hindi
version (to be translated from the **frozen** English text, since translating a moving draft
wastes the work). **Do not conflate** with the `/disclosure` route in BLUEPRINT: that is the
board's mandatory public disclosure (RBSE), a different document.

### 8.2 Notice and consent: how the system behaves

- **Notice before collection.** Each form shows a short notice and links to `/privacy`
  *before* any field is filled in; the full notice is available in English and, once translated, Hindi.
- **Consent from the parent or guardian**, as a verifiable, unticked-by-default affirmative act:
  a checkbox that states the specific purposes. The system records `noticeVersion` and `consentedAt`
  on `Enquiry` and `Application` (and on `StudentSensitive`, by a guardian, witnessed by a named staff member). *Verifiability* is
  met by the school knowing the parent: stage 2 is a link sent to a number or email the school
  holds and stage 3 is **in person**, so the school can show that it dealt with the guardian.
- **No tracking, no behavioural monitoring, no advertising to children.** Technically: no third-party scripts (§5.2), no analytics on
  the portal, no profiling. Attendance and fees are used for the school's own educational administration only.
- **Rights are operable, not just promised.** Access, correction, erasure and withdrawal go through the office and the Grievance
  Officer (below). A **Data Request Log** records receipt, action and closure date; acknowledged within 3 working days, resolved within 30 days (I read the Rules' outer limit as longer; the shorter promise is ours).

### 8.3 Roles

The school (trust/society) is the **Data Fiduciary**: the notice names it. The hosting provider and
the backup provider are **Data Processors**; the notice lists them by category and the school
keeps their terms on file. Staff with access are bound by a short confidentiality undertaking signed
at onboarding (the school's to supply). Access is revoked the day someone leaves (checklist item).

### 8.4 Breach response (LB-12)

A one-page runbook, kept in escrow and printed at the office. Named roles, not titles: **Incident Lead**, **Technical Lead**,
**School Contact**. It states, as I read the obligations: contain first (revoke tokens, rotate secrets, isolate host); preserve
logs; **notify affected families without undue delay**, and the **Data Protection Board** with a
detailed report within the Rules' time limit (I understand 72 hours); consider the **CERT-In**
6-hour reporting expectation for cyber incidents; record everything. A table-top exercise ("a teacher's
laptop with the roster is stolen / the DB dump is found in a public bucket") is run once before launch.
*Counsel confirms the exact thresholds and clocks.*

---

## 9. Verification and release gates

| Gate | When |
|---|---|
| T1–T6 (§1.3), canary redaction (§3.2), forbidden-field test (§2.4), gitleaks, Trivy, typecheck, lint, unit/integration | Every PR; branch protection, no bypass |
| CSP report-only → enforced | ≥ 2 weeks pre-launch |
| Authenticated two-account ZAP/manual pass | Pre-launch |
| k6 load test on the real host | Pre-launch, before DNS cutover |
| Full DR drill, timed | Pre-launch |
| Port scan + TLS assertion + header check | Post-deploy, automated |
| Privacy artefacts reviewed by counsel and published | Pre-launch |

I (CTO) sign off production release against LB-1 … LB-13. Any exception is written down in
`ADR_INDEX`, with an owner and an expiry date.

---

## Appendix A — Draft privacy notice (for counsel and school review)

*Placeholders in ⟦double brackets⟧ are the school's to fill (Appendix B). English first; Hindi after the text is frozen.*

> **Privacy Notice — ⟦Legal name of the school's society/trust⟧ ("the School", "we")**
> Version ⟦1.0⟧ · Effective ⟦date⟧
>
> **1. Who we are.** ⟦Legal entity⟧, running the school in Pilani ⟦confirm school name and address⟧, is responsible for the personal data described here.
>
> **2. Whose data.** Mostly **children**, and their parents or guardians. We treat all of it as a child's data and apply the extra care the law requires.
>
> **3. What we collect, and when.**
> | Stage | What | Why |
> |---|---|---|
> | Enquiry | child's name, class sought, parent's name, phone, email (optional), locality | to reply to your enquiry |
> | Application (only if invited) | child's date of birth and gender, address, parents' occupations, previous school, siblings, emergency contact, birth certificate, transfer certificate, photograph | to assess and process admission |
> | Enrolment (only after a seat is offered, in person) | only what the law or the Board requires of us: ⟦list from the school, e.g. category certificate for a quota seat⟧. **We do not collect your Aadhaar number** ⟦or: we record only the last 4 digits and that we saw the card⟧ | ⟦cited legal requirement⟧ |
> | While enrolled | attendance, fee invoices and payments, class and section, photograph for school records | to run the school and to show you your child's attendance and fees |
> | Photographs on the public website | only with your **separate written consent** | to show school life |
>
> We do **not** collect family income, and we do not sell or share your data for advertising.
>
> **4. How we use it.** Admissions, running classes, attendance, fees and receipts, contacting you about your child, safety, and meeting legal duties. Nothing else without asking you.
>
> **5. No tracking.** This website sets only the cookie needed to keep you logged in. It has no advertising or third-party analytics.
>
> **6. Who sees it.** Only staff who need it for their work: a teacher sees their own class; the office and accounts see what their jobs need. **Sensitive details can be seen only by the office, and every time they are opened it is recorded.** Our hosting provider ⟦name, location⟧ and backup provider ⟦name, location⟧ store data on our behalf under contract; they cannot use it for their own purposes. We disclose data to authorities only where the law requires.
>
> **7. How long we keep it.** Enquiries: 12 months. Applications not accepted: 6 months. Medical and category details: until your child leaves the School plus 30 days. Attendance: ⟦3⟧ years. Fee records: ⟦8⟧ years. The student register is kept permanently as the law requires ⟦confirm⟧. Backups are kept for 35 days, so a deleted record can remain in a backup for up to that long.
>
> **8. Your rights.** You may ask to **see** the data we hold about your child, **correct** it, **delete** it, or **withdraw** your consent at any time, by telling the office in person, in writing, or by email. Withdrawing a photograph consent takes effect immediately. We will acknowledge within 3 working days and answer within 30. Some records we **must** keep by law while your child is enrolled; we will explain when that applies.
>
> **9. Security.** Data is encrypted in transit; sensitive details are encrypted in storage; access is by individual login with audit; backups are encrypted. If something goes wrong that affects your child's data, we will tell you without delay.
>
> **10. Complaints.** **Grievance Officer: ⟦name, designation⟧ · ⟦phone⟧ · ⟦email⟧ · office hours ⟦…⟧.** If we do not resolve it you may complain to the Data Protection Board of India.
>
> **11. Changes.** We will post changes here with a new version number and date.

**Form-level notice (enquiry), shown above the submit button:**

> ☐ I am the parent/guardian. I agree that ⟦School⟧ may use these details only to reply to my enquiry and to contact me about admission. I can withdraw this at any time. [Privacy notice]

**Application form (stage 2):** same pattern, listing the stage-2 purposes, plus "I confirm I am this child's parent or legal guardian."

**Stage-3 consent record** (paper or screen, in person, signed by the guardian, countersigned by staff; scanned to `evidenceFileKey` pattern as in `PHOTO-CONSENT`): states each field collected, the *cited legal requirement* for it, the retention rule, and the right to withdraw.

## Appendix B — What the school must provide

| # | Item | Needed for |
|---|---|---|
| 1 | **Grievance Officer**: name, designation, direct phone, email, hours | LB-4. Also named in `PHOTO-CONSENT` §8 |
| 2 | **Legal name** and registered address of the trust/society running the school; the RBSE/affiliation number | notice header |
| 3 | **For each stage-3 field the school wants** (Aadhaar, category, medical, disability): the *specific rule, circular or portal requirement* obliging them to collect it | LB-3, §2.3. No citation, no field |
| 4 | Whether the school must upload student data to a government portal (e.g. a state education portal) and what identifiers that portal requires | §2.3 |
| 5 | **Retention confirmations** (admission register, attendance, fee records) from the school's auditor / education-department rules | §2.5 |
| 6 | **Legacy form:** a cPanel login (or an export) so the legacy tables can be inventoried and then deleted; confirmation the sensitive fields are switched off now | LB-11 |
| 7 | **Hosting and backup provider** names and locations once chosen | notice §6 |
| 8 | A signed **staff confidentiality undertaking** template and an onboarding/offboarding checklist owner | §8.3 |
| 9 | **Hindi translation review** by a school staff member, once English is frozen | LB-4 |
| 10 | The names of the **two escrow holders** for backup and encryption keys, and the **incident roles** | §3.1, §8.4 |
| 11 | **Who can log into the DNS panel** and who owns the MailBaby/SMTP relay account | LB-5 |
| 12 | Whether a severe-allergy **medical alert** visible to teachers is wanted | §2.2 |

## Appendix C — Contract change requests (`prisma/schema.prisma`, BLUEPRINT)

These are requests to the contract owner; the contract lock is the Staff Engineer's call. None changes the three-stage design.

| # | Change | Reason |
|---|---|---|
| C1 | `User.emailVerifiedAt DateTime?`; reset only to verified `User.email`; drop `Guardian.email` as a reset target | §4.5(a) |
| C2 | `User.totpSecretEnc Bytes?`, `totpEnabledAt`, `RecoveryCode` (hashed, single-use) | §4.6 |
| C3 | `ErasureLedger { id, entity, entityId, erasedAt }` | §2.6 |
| C4 | `StudentSensitive`: add `consentWithdrawnAt`, `aadhaarLast4`, `aadhaarSightedOn`, `aadhaarSightedById`; keep `aadhaarEnc` **behind `AADHAAR_FULL_ENABLED`**; **encrypt in the application (AES-256-GCM, key-id prefix), not `pgcrypto`** (amend ADR-001 and BLUEPRINT §2.3) | §2.3 |
| C5 | `Enquiry` and `Application`: `noticeVersion String`, `consentedAt DateTime` | §8.2 |
| C6 | `Application.parentDetails`/`previousSchool`/`siblings`/`emergencyContact`: strict Zod schemas + `CHECK` rejecting forbidden keys | §2.4 |
| C7 | `AttendanceEntry.note`: coded reason or `OFFICE`-only; `Student.bloodGroup`: class teacher + office only; optional `Student.medicalAlert` | §2.1 |
| C8 | `RefreshToken`: `rememberDevice Boolean`, `lastUsedAt` | §4.4 |
| C9 | `AuditLog`: **INSERT-only grant** for the app role; `before`/`after` pass a field-level redaction (C3 entities log changed field names only) | §3.1, §3.2 |
| C10 | `ApplicationDocument.sizeBytes` cap 5 MB (BLUEPRINT said 2 MB); `kind` unchanged | §5.4 |
| C11 | Activation-code TTL: 30 d admission, 7 d reissue | §4.2 |
| C12 | `User` CHECK: staff roles have `email`, parents have `phone`; a trigger preventing a `PARENT` row without a `Guardian` link where one is required | §1 |

## Appendix D — Reference config (shape, not final)

**Caddyfile**

```caddyfile
{
  email ⟦ops mailbox⟧
  servers { timeouts { read_header 10s  read_body 30s  idle 2m } }
  # acme_ca https://acme-staging-v02.api.letsencrypt.org/directory   # use on rehearsal ONLY
}

hca.edu.in {
  encode zstd gzip
  request_body { max_size 16MB }          # >15MB application total; Nest enforces 5MB/file while streaming

  header {
    Strict-Transport-Security "max-age=300"   # staged: 300 -> 86400 -> 31536000. NO includeSubDomains
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()"
    Cross-Origin-Opener-Policy same-origin
    X-Frame-Options DENY
    -Server
  }

  @tokenpaths path /admissions/apply/* /reset/*
  header @tokenpaths Referrer-Policy no-referrer

  handle /api/* { reverse_proxy api:3000 }
  handle        { reverse_proxy web:3000 }

  log {
    output file /var/log/caddy/access.log { roll_keep 365 }
    format filter {
      request>uri query { delete }      # strip query string
      request>uri path_regexp /admissions/apply/[^/]+ /admissions/apply/[redacted]
      request>uri path_regexp /reset/[^/]+            /reset/[redacted]
      request>headers>Authorization delete
      request>headers>Cookie delete
      resp_headers>Set-Cookie delete
    }
  }
}

www.hca.edu.in { redir https://hca.edu.in{uri} permanent }
```

(`request>uri` filter field names vary slightly by Caddy version: verify against the pinned
release before relying on the redaction, and **test it** by grepping the log for a known token.)

**Compose hardening (per service)**

```yaml
api:
  user: "10001:10001"
  read_only: true
  tmpfs: [/tmp]
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  secrets: [jwt_signing_key, db_password, field_enc_key, smtp_password]
  networks: [internal]          # no `ports:`
db:
  networks: [internal]          # no `ports:`, ever
caddy:
  ports: ["80:80", "443:443", "443:443/udp"]
  volumes: [caddy_data:/data]   # persisted AND backed up
```

## Appendix E — Controls that depend on the host choice

Nothing is bought, so none of these is assumed. Verify each on whichever host is chosen, **before** loading real data.

| Control | Depends on | What to check |
|---|---|---|
| Data residency | provider region | India region for server **and** backup bucket (§5.6) |
| Virtualisation | provider | KVM / full virt (Docker needs it) |
| Outbound SMTP | provider | Many providers block port 25 (and some 587) by default; confirm the authenticated relay on 587 connects |
| Provider firewall / private network | provider | A second layer on top of host rules; not a substitute |
| DDoS protection | provider | Varies widely; at this scale, rate limits and a small VPS are the realistic posture; do not claim more |
| Snapshots | provider | Welcome as a *convenience*, **never** the backup (same failure domain) |
| Volume encryption | provider | Bonus only (§5.3) |
| Console / rescue access | provider | Needed for the restore drill; confirm it exists |
| SLA / support | provider | **Free-tier hosts (Option A) are staging-only**, synthetic data only; idle-reclaim and no SLA are disqualifying for production |
| IPv6 | provider | If AAAA is published it must serve a valid certificate too |
| Processor terms | provider | Keep the DPA/ToS on file (§8.3) |
| Same-provider backup | provider | Avoid; a different failure domain is the point |

---

*Prepared by: CTO · Issue WHO-5 · Phase 3. Companion to `BLUEPRINT-001` §5 and `ADR-001`.*
