# ADR-001 — Technology stack and hosting

**Issue:** WHO-2 · **Phase:** 2 (Architecture) · **Status:** proposed
**Depends on:** `PRD-001-scope-proposal.md` v2 (scope approved)
**Date:** 2026-10-25

---

## Context

A ~500-student school in Pilani needs a public website and an operational portal, launched
together (D4), as an installable PWA with no native apps (D1), on a scope cut to the high-leverage
set. The school has no in-house engineering. Whatever we choose must be cheap to run, boring to
operate, and still readable by whoever maintains it in three years.

Constraints that actually bind:

- **Cost.** This is a single school's budget, not a SaaS company's. Target: **under ₹2,000/month**
  all-in for hosting, excluding SMS.
- **No vendor lock-in.** Permissive OSS only (MIT / Apache-2.0 / BSD), per org guardrail 2.
- **One operator.** Nobody will babysit a Kubernetes cluster. Deployment must be a single command.
- **Public pages must be fast** on a mid-range Android over 4G, and must be crawlable — this is the
  school's marketing surface.
- **Portal must work on bad connectivity.** Attendance marking is the highest-frequency action and
  teachers will do it on phones in a building with patchy signal.

## Decision

| Layer | Choice | Licence | Why this and not the obvious alternative |
|---|---|---|---|
| **Language** | TypeScript, end to end | Apache-2.0 | One language across both repos. Types cross the API boundary as generated artefacts, which is what makes contract-first parallelism (guardrail 1) actually enforceable rather than aspirational |
| **Backend** | **NestJS** (Node 22 LTS) | MIT | Opinionated module/provider structure. Its verbosity is a *feature* here: explicit DI, decorators and guards make authorisation visible at the handler, which matters when the system holds minors' records. Plain Express would be smaller but offers no structural pressure |
| **ORM** | **Prisma** | Apache-2.0 | Declarative schema is the single source of truth for the data model; migrations are generated and reviewable. Parameterised by construction, which satisfies guardrail 5 without discipline |
| **Database** | **PostgreSQL 17** | PostgreSQL (BSD-like) | Row-level correctness, real constraints, JSONB for CMS blocks, `pgcrypto` for the stage-3 sensitive tier. One database, no second store |
| **Frontend** | **Next.js 15** (App Router), React 19 | MIT | Static/ISR rendering for public pages (fast, crawlable) and client rendering for the portal, in one codebase. This dual mode is precisely our shape: a marketing site and an app sharing a domain |
| **Styling** | **Tailwind CSS** + CSS custom properties as design tokens | MIT | Tokens live in one file; guardrail 4 ("token-only UI") becomes mechanically checkable |
| **Components** | **shadcn/ui** on Radix primitives | MIT | Copied into the repo, not a dependency — no upstream can break us. Radix gives WCAG-conformant focus and keyboard behaviour for free, which is most of the accessibility budget |
| **PWA / offline** | Workbox service worker + IndexedDB outbox | MIT / Apache-2.0 | Attendance marks queue locally and sync when signal returns. This is the capability that justifies not building native apps |
| **Auth** | Self-hosted JWT (access + rotating refresh), argon2id passwords for **every** role including parents, bootstrapped by a single-use office-issued activation code | MIT | No Auth0/Clerk — recurring per-MAU cost for a fixed, small, known user population makes no sense. **No SMS at all**, per board decision; see "Parent authentication" below |
| **File storage** | Local volume behind the app, S3-compatible interface | — | Admission documents are a few MB each at a few hundred per year. Object storage can be swapped in later without touching call sites |
| **Reverse proxy / TLS** | **Caddy** | Apache-2.0 | Automatic Let's Encrypt issuance and renewal. **This permanently fixes the certificate mismatch** every visitor hits today (discovery §0) — it is a config file, not a project |
| **Deployment** | Docker Compose on a single VPS | Apache-2.0 | One `docker compose up`. **Which VPS, and whether we buy one at all, is not decided** — the board placed hosting spend on hold pending options and cost. See `HOSTING-OPTIONS-AND-COST.md`. The architecture is deliberately provider-agnostic: Compose plus a Postgres volume runs identically on every option on that list, including the free one |
| **CI** | GitHub Actions — typecheck, lint, test, build on every PR | — | Enforces guardrail 3 (zero unverified merges) |
| **Email** | SMTP via the existing `hca.edu.in` mailbox | — | Confirmed working. No new vendor |
| **Errors / uptime** | Self-hosted GlitchTip + Uptime Kuma | MIT | Sentry-compatible without the bill |

### Repository layout

| Repo | Contents |
|---|---|
| `hca-edu-be` | NestJS API, Prisma schema and migrations, seeds, OpenAPI spec, these docs |
| `hca-edu-web` | Next.js app — public website, `/portal`, `/admin` |
| `hca-edu-android`, `hca-edu-ios` | **Intentionally empty.** Per D1 |

**Contract flow:** the Prisma schema generates database types; the Nest controllers emit an OpenAPI
document; `openapi-typescript` generates the web client's types from it in CI. No hand-written
cross-boundary type exists anywhere, so a backend change that breaks the frontend fails CI rather
than production.

## Parent authentication — decided, no SMS

The board chose **office-issued credentials over SMS OTP**. That removes TRAI DLT registration from
the critical path entirely: nothing in this system now blocks on a telecom regulator, and launch no
longer waits on paperwork. It is the right call for schedule. It does move a cost from a vendor bill
onto the office desk, so the design below exists to keep that cost small.

**Activation, not a shared code.** The office does not know or set parent passwords. It generates a
**single-use activation code** — 10 characters, unambiguous alphabet (no `O`/`0`, `I`/`1`), stored
only as an argon2id hash, valid 30 days — printed on a slip handed over at admission or at a
parent-teacher meeting. The parent enters *mobile number + activation code*, is forced to set their
own password, and the code is burned on use.

**This is not the old 6-digit system.** That system failed for structural reasons worth naming,
because each one is now closed:

| Old 6-digit access code | This design |
|---|---|
| Issued **class-wise** — one code per class | Per family, never shared |
| Was the credential itself, permanently | Bootstraps a credential, then dies |
| Reusable, so sharing it granted access to someone else's child | Single-use; a leaked code is already spent |
| Office held every live credential | Office holds none |
| 6 digits — a million-space, brute-forceable | 10 chars from a 32-symbol alphabet, rate-limited, hashed |

**Reset, which is the part that actually costs the office time.** Two paths, in order of preference:

1. **Email reset**, where the family has an email on record — a signed single-use token, 1-hour TTL,
   over the existing `hca.edu.in` SMTP that the board confirmed works. Zero office involvement. The
   admission form already collects parent email, so coverage should be high.
2. **Office reissue**, where it does not — two clicks in the admin panel reissue an activation code,
   which simultaneously invalidates the existing password. Audited like any other admin mutation.

**Brute-force posture.** Per-account lockout after 10 failed attempts for 15 minutes, per-IP rate
limiting independently, every failure audited. A parent account grants read-only sight of one
family's fee and attendance records, so the blast radius of a single compromise is one family —
but the lockout is there because a phone number is a guessable username.

**The cost we are accepting, stated plainly.** Some number of parents will forget a password and ring
the office, and where no email is on record a human has to act. Rough order: at 500 families, expect
a handful of resets a week in the first month and very few thereafter. Two mitigations are in the
build rather than in a policy document: a 90-day "remember this device" refresh token so a parent's
own phone rarely asks again, and a prompt to add an email address on first login precisely so the
self-service path becomes available to them. If reset volume still proves painful after a term, email
OTP login (no password at all) is a small change on the same primitives — but we should measure before
building it.

**Consequence for admissions.** Stage 2 of the application was specified as OTP-verified. With no SMS,
stage-2 access is a **tokenised link** — long random URL token, 30-day TTL, scoped to exactly one
application — emailed on enquiry where an email was given, and otherwise handed over by the office
alongside the application number. The public enquiry form (stage 1) stays unauthenticated, as it must.

## Alternatives considered

**One monolithic Next.js app with route handlers as the backend.** Fewer moving parts and one
deploy. Rejected because four repositories are already provisioned around a backend/frontend split,
because background work (notice expiry, session rollover, fee reminders) sits awkwardly in a
Next.js runtime, and because a clean HTTP contract is what lets the four build streams in PRD §7
proceed in parallel. Worth revisiting if the team turns out to be one person.

**Supabase / Firebase.** Fastest start by some distance. Rejected on guardrail 2: a school's
student records should not sit inside a hosted proprietary auth-and-row-security model whose
pricing we do not control. Postgres is the same database without the lock.

**Django or Laravel.** Both genuinely good for this exact problem, and Django's admin would hand us
most of §2.4 for free. Rejected to keep one language across the stack, and because the generated
admin would not survive contact with the mobile-first, one-handed requirements — we would end up
rebuilding it.

**Kubernetes, microservices, or a managed Postgres tier.** Rejected as several orders of magnitude
more operational cost than ~500 students and ~30 staff can possibly justify.

## Consequences

**Good.** Runs for roughly ₹1,000/month. Every component is replaceable. TLS stops being a problem
on day one. Type safety crosses the network boundary. The PWA is one codebase instead of three.

**Costs we accept.** Node's memory footprint is larger than Go's or PHP's — irrelevant at this
scale. Prisma's migration story requires care under concurrent edits — manageable with one
database. A single VPS is a single point of failure: mitigated by nightly `pg_dump` to off-host
storage and a documented restore, not by paying for redundancy this school does not need.
Self-hosting means we own patching — a monthly update routine goes in the runbook.

**Critical path is now clear.** The SMS/TRAI DLT dependency is **gone** — the board chose office-issued
credentials, so no regulator, vendor or template approval sits between us and launch. Nothing in the
architecture is blocked. What remains open is procurement, not engineering: the hosting choice is on
hold (`HOSTING-OPTIONS-AND-COST.md`), and the brand assets are in transit from the school. Both are
needed at launch, neither blocks the build.

**DNS is in hand.** The school holds access to `hca.edu.in` through **ERNET India**, the `.edu.in`
registry. Worth knowing in advance: ERNET's panel is an institutional registry rather than a
consumer registrar, so record changes can be slower and may require the registered institutional
contact to act. The TLS cutover needs only an A record pointed at the new host with ports 80 and 443
reachable — Caddy does the rest — but we should rehearse the record change before launch day rather
than discover the approval workflow on it.

---

*Prepared by: Agentic Orchestrator · Issue WHO-2 · Phase 2*
