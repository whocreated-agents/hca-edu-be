# CONTRACT-LOCK-001 — Phase 3 Contract Lock & Draft Schema Deviations

**Issue:** WHO-3 · **Phase:** 3 (Contract Lock) · **Status:** locked
**Depends on:** `BLUEPRINT-001-system-design.md` · `ADR-001-technology-stack.md` · `PRD-001-scope-proposal.md`
**Locked at Migration:** `20261025000000_init`
**Date:** 2026-10-25

---

## 1. Overview & Scope

Phase 3 locks the canonical database schema (`prisma/schema.prisma`), initial migration (`migration.sql`), and the wire contract package (`@hca/contracts`). This document records every architectural deviation between the initial WHO-2 draft schema and the locked Phase 3 production contract, along with the technical justification for each decision.

---

## 2. Canonical Deviations from WHO-2 Draft Schema

### D-01: Enrollment State & Composite Session-Section Foreign Key
- **Change:** Added `EnrollmentState` (`ACTIVE`, `PROMOTED`, `WITHDRAWN`, `TRANSFERRED`) to `Enrollment` and bound enrollment sections to session via composite foreign key constraints.
- **Rationale:** BLUEPRINT-001 §2.3 specifies that students have an active enrollment lifecycle. A section must strictly belong to the enrollment's active academic session to prevent cross-session orphan records.

### D-02: Isolated `StudentSensitive` Tier
- **Change:** Separated Aadhaar and medical information into `StudentSensitive` with its own unique relation to `Student`, encrypted payload columns (`aadhaarEnc`, `medicalNotesEnc`), and explicit consent tracking (`consentById`, `consentRecordedAt`).
- **Rationale:** Prevents sensitive PII from leaking into general student queries, parent portal responses, or teacher attendance views. Access requires `SUPER_ADMIN` or `OFFICE` role and generates an immutable audit record.

### D-03: `User.authEpoch` Immediate Token Revocation
- **Change:** Added an integer `authEpoch` column to `User` embedded into JWT access token claims (`ep`).
- **Rationale:** Standard stateless JWT access tokens remain valid until expiration (15 minutes). Bumping `authEpoch` on password change, account suspension, or office slip reissue revokes outstanding access tokens immediately on the next request.

### D-04: HMAC-Peppered High-Entropy Tokens & Argon2id Passwords
- **Change:** Token hashes (`RefreshToken`, `PasswordResetToken`) use HMAC-SHA256 with a server-side pepper (`TOKEN_PEPPER`). Password hashes use Argon2id with memory cost 19,456 KiB and time cost 2.
- **Rationale:** Protects against offline rainbow table attacks in the event of database exfiltration. Pepper is maintained in environment configuration, never stored in the database.

### D-05: Idempotent Fee Payments & Gapless Receipt Numbers
- **Change:** Added `requestId` (UUID) idempotency key and per-session `receiptSeq` integer sequence with composite unique constraint `[sessionId, receiptSeq]` on `FeePayment`.
- **Rationale:** Prevents accidental double-charging from client retries or network drops. `receiptSeq` ensures gapless audit trails per session.

### D-06: Attendance Sync Idempotency & Staleness Protection
- **Change:** Added `lastMutationId` (UUID), `capturedAt` (timestamp), and `isFinalised` (boolean) to `AttendanceDay`.
- **Rationale:** Solves the flaky mobile network problem for teachers. An offline register marked on a device PUTs the whole section day payload once. Identical `lastMutationId` yields a `REPLAYED` outcome without duplicate writes. A stale `capturedAt` is rejected with `409 ATTENDANCE_STALE` against newer office corrections.

### D-07: Immutability Trigger & Engine-Level Database Constraints
- **Change:** Added PostgreSQL triggers preventing `UPDATE` and `DELETE` on `AuditLog` (except `ON DELETE SET NULL` on `actorId`), alongside CHECK constraints for positive currency, ordered session dates, and singleton school profile.
- **Rationale:** Guarantees audit trail immutability and data integrity even if accessed via direct SQL or external clients.

### D-08: Class Level Counts (13 Confirmed Levels)
- **Change:** Verified and seeded 13 distinct academic class levels: Nursery, LKG, UKG, and Classes I through X.
- **Rationale:** Planning documents colloquially referred to "14 levels", but the exact academic structure of HCA under RBSE consists of 3 pre-primary levels and 10 standard classes (total 13).

### D-09: Dual-Purpose Email Tokens & Decoupled Verification
- **Change:** Unified `PasswordResetToken` with `EmailTokenPurpose` (`PASSWORD_RESET`, `VERIFY_EMAIL`) with 24-hour verification TTL and 1-hour password reset TTL.
- **Rationale:** Reuses robust token hashing and single-use burning primitives for both account recovery and initial recovery email verification.

### D-10: Notice Publication Lifecycle
- **Change:** Added `isPublished` boolean flag and derived query visibility (`isPublished AND publishFrom <= now AND (publishUntil IS NULL OR publishUntil > now)`).
- **Rationale:** Allows office staff to save notice drafts ahead of publication date. Dynamic query derivation prevents expired notices from displaying even if background cron sweeps fail.

### D-11: Media Consent Scope & Asset Metadata Sniffing
- **Change:** Stored MIME types and byte sizes on `MediaAsset`, and typed `MediaConsent.scope` with `ConsentScope` (`PUBLIC_WEBSITE`, `WEBSITE_AND_SOCIAL`).
- **Rationale:** Enforces DPDP Act compliance. Notice or asset withdrawal immediately updates publishing status.

### D-12: Application-Layer Envelope Encryption for Sensitive PII
- **Change:** Encrypted fields store raw bytes in format: `version(1 byte) | iv(12 bytes) | tag(16 bytes) | ciphertext`.
- **Rationale:** Encryption keys remain in application memory, avoiding plaintext exposure in PostgreSQL query logs or `pg_dump` backups.

---

## 3. Database Invariants Enforced in Migration SQL

| Target Table | Constraint / Index | Invariant Enforced |
|---|---|---|
| `AcademicSession` | `one_running_session` (partial unique) | At most one session in `RUNNING` state |
| `AcademicSession` | `one_open_intake` (partial unique) | At most one session with admissions open |
| `AcademicSession` | `session_dates_ordered` (CHECK) | `endsOn > startsOn` |
| `User` | `user_has_login_identifier` (CHECK) | Parents must have `phone`, others must have `email` |
| `User` | `user_staff_email_unique` (partial unique) | Unique email for staff/admin roles (parents can share) |
| `FeeStructure` | `fee_structure_amount_positive` (CHECK) | Amount must be > 0 |
| `FeePayment` | `fee_payment_amount_positive` (CHECK) | Paid amount must be > 0 |
| `FeePayment` | `[sessionId, receiptSeq]` (UNIQUE) | Gapless sequence per academic session |
| `AuditLog` | `audit_log_no_update_delete` (TRIGGER) | Complete immutability of audit trail records |
| `SchoolProfile` | `school_profile_singleton` (CHECK) | `id = 1` enforces singleton configuration row |
