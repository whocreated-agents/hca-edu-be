# PRD-001 — HCA Online Presence: Approved Scope (v2)

**Issue:** WHO-2 · **Phase:** 1 (Executive Alignment) · **Status:** **scope approved** — D1–D4, F1–F2 settled 2026-10-24
**Inputs:** `DISCOVERY-existing-site-information.md` (§12 confirmed facts register)
**Supersedes:** PRD-001 v1 (proposal). This version records decisions, not questions.
**Date:** 2026-10-25

---

## 0. Decisions on record

| Ref | Decision | Board answer |
|---|---|---|
| **D1** | Platform | **PWA only for v1.** `hca-edu-android` and `hca-edu-ios` stay empty. The web app ships installable |
| **D2** | Admission form | **Three-stage.** Sensitive data (Aadhaar, category, medical) collected only *after* a seat is offered |
| **D3** | Roadmap visibility | **Internal only.** No public "Coming Soon" section on the site |
| **D4** | Delivery sequence | **Website and portal launch together.** No staged public-site-first milestone |
| **F1** | Years of service | **"Since 2003"** + a computed count from **15 April 2003**, shown as **"N years of national service"**. Auto-increments; N = 23 today |
| **F2** | Academic session | **Fully admin-configurable.** Nothing hardcoded; real sessions seeded later |
| — | Email | `info@hca.edu.in` **works today** — safe to publish |
| **Scope** | Size | **Cut to the high-leverage set**: public website + admin CMS + admission pipeline + fee ledger + attendance |

### How D4 and the scope cut interact

They pull in opposite directions and both are honoured the same way: **one launch, narrower
contents.** We do not ship the website alone and follow with the portal; we ship both, but the
portal at launch contains only the features where each one removes a phone call to the office.
Everything else moves to V2 and ships after launch, which costs nothing because the portal is a
logged-in surface — adding a tab later is invisible to the public.

---

## 1. What we are building

Two surfaces, one system:

| Surface | Audience | Purpose |
|---|---|---|
| **Public website** (`hca.edu.in`) | Prospective parents, current parents, general visitors | Credibility, information, admission enquiry/application |
| **School portal** (`/portal`) | Admin, staff, parents | Day-to-day school operations |

One backend, one database, one admin panel, installable as a PWA. The public site reads from the
same content store the admin edits — the office changes a notice without calling a developer. That
property is the single most valuable thing the old site had and it is kept as a principle.

---

## 2. V1 scope — the launch set

Everything in this section is launch-blocking. Anything not here is §3 (V2) or §4 (later).

### 2.1 Public website — visitors and prospective parents

*Job: convince a Pilani parent this school is worth a visit, and let them start an application in
under two minutes on a phone.*

| Feature | Notes |
|---|---|
| Home — identity, headline, mission/vision, verified stats | §12 facts only. "Since 2003", **23 years of national service** (computed), RBSE, Reg. 103 JJN 2003-04 |
| About — history, the three named officers, affiliation & registration | The credibility block the old site never had |
| Academics — 14 levels (Nursery–X) with age bands, RBSE framing | |
| Facilities — the 6 confirmed facilities | Text-first; photographs deferred until real images exist |
| Admissions — process, eligibility, open-intake session, document checklist | Session read from the sessions table, never hardcoded |
| Admission enquiry form (6 fields) | The primary public CTA. Zero sensitive data |
| Full admission application | Stage 2 of §5. Redesigned, not copied |
| Notices, filterable by the 5 existing tags | admission · exam · holiday · event · fee |
| Contact — address, both phones, `info@hca.edu.in`, hours, map, 3 social links | |
| Fee information | Renders admin-entered structure. Payment shows "Online fee payment — coming soon" |
| Privacy policy, terms, DPDP disclosure | Legally required given what we collect. Non-negotiable |
| Mandatory public disclosure page | RBSE/RTE expectation. Structure now, content as the school provides it |

### 2.2 Parents

| Feature | Notes |
|---|---|
| Login — mobile number + own password, bootstrapped by a single-use office-issued activation code | **Board decision: no SMS.** Unlike the old class-wise 6-digit code, the activation code is per family, single-use, and only sets up a password the office never holds. Self-service reset by email where one is on record; office reissue otherwise. Full design in ADR-001 |
| Add/confirm an email address on first login | Deliberate: it moves that family onto the self-service reset path and off the office's desk |
| Dashboard — one card per child, multi-child support | Old site had no concept of a parent with two children |
| Child profile — class, section, roll number | |
| Fee ledger — due, paid, receipts, downloadable statement | Admin-entered; payment itself deferred |
| Attendance — monthly summary + day detail | |
| Notices targeted to their child's class | |

### 2.3 Staff / teachers

| Feature | Notes |
|---|---|
| Login, role-scoped (class teacher vs subject teacher) | |
| **Mark daily attendance for assigned class** | Highest-frequency action in the entire system. One-handed on a phone, tolerant of poor connectivity |
| Student roster + contact details for their class | |

### 2.4 Admin / office — the control plane

If this is weak, nothing else stays accurate.

| Feature | Notes |
|---|---|
| Admin auth, roles (super-admin · office · accounts), audit log | The old `/admin.html` sat permanently in first-run "create admin account" state — anyone could have claimed it |
| **Parent credential management** — issue and reissue activation codes, print slips in bulk per section | The operational consequence of choosing no SMS. Making it two clicks and batch-printable is what keeps that choice cheap |
| **Academic session management** | Sessions as data with an `upcoming → running → closed` lifecycle. Permanently fixes the stale-year problem |
| Student records — admit, edit, promote, transfer out | |
| Class & section setup, teacher assignment | |
| Admission pipeline — list, search, filter, status workflow, CSV export | Keeps the old status model: Submitted → Reviewed → Approved → Rejected |
| Fee structure configuration, class-wise | Board decision: admin-entered |
| Fee ledger — record offline payments, issue receipts | The real-world flow until a gateway exists |
| Attendance oversight & reports | |
| Notices — compose, tag, target by class, schedule, **expire** | Expiry matters: the old site still shows April 2025 notices |
| Website CMS — edit all public content without a deploy | |
| Staff records | |

---

## 3. V2 — ships after launch, no public announcement needed

Student logins (Class VI+) · timetable views for all roles · timetable builder ·
homework/diary · marks entry · exams and report-card generation · leave applications ·
bulk email to parents · passwordless email-OTP login *(only if reset volume proves painful — measure first)*.

**SMS is out, not deferred.** The board chose office-issued credentials over an SMS provider, which
removes TRAI DLT registration from the project entirely. Bulk SMS to parents therefore leaves even
the V2 list; email is the notification channel. Revisiting it means reopening the DLT paperwork, so
it should be a deliberate decision rather than a backlog item that quietly resurfaces.

Student accounts moved out of V1 deliberately: below Class VI the parent account is the access
path anyway, and above it the three things a student wants (timetable, notices, attendance) are
already visible to their parent at launch.

---

## 4. Later / not planned

Photo gallery · faculty profiles · academic calendar · board results & achievements ·
transport routes · uniform & booklist · online fee payment · TC requests · alumni ·
study material · parent↔teacher messaging *(needs a moderation policy first)* ·
library, inventory, payroll, accounting *(out of character for this system; likely never)*.

**Per D3, this list is internal.** It does not appear on the public site. Pages that do not exist
are simply absent rather than advertised as forthcoming.

---

## 5. Admission form — the three-stage design (D2 approved)

The old form collected, for **minors**: Aadhaar numbers (student *and* both parents), caste and
category, both parents' monthly income, medical records, and physical-disability status — all in a
public form, before any seat was offered.

Under the **DPDP Act 2023** children's data requires verifiable parental consent, purpose limitation
and data minimisation. Collecting a parent's monthly income and Aadhaar to enrol a child in Nursery
is hard to justify as necessary, and storing Aadhaar at all creates a disclosure obligation most
schools are not equipped to meet.

| Stage | When | Collects |
|---|---|---|
| **1 · Enquiry** | Public, unauthenticated | Child's name, class applied for, parent name, mobile, email, locality. **6 fields, nothing sensitive** |
| **2 · Application** | After enquiry, reached by a single-use tokenised link (emailed, or handed over by the office — no SMS) | DOB, gender, address, parent occupations, previous school, siblings, emergency contact, documents (birth certificate, TC, photo) |
| **3 · Enrolment** | **Only after a seat is offered**, office-assisted | Aadhaar, category, medical details — only where a legal need exists (RTE quota, board registration). Encrypted at rest, retention-limited, explicit consent record |

**Monthly income is dropped entirely.** If it drives a fee concession, that is modelled as a
concession application against a stated policy — a cleaner and more honest flow than a mandatory
field on every form.

---

## 6. Non-functional baseline (CTO gates)

- **Security:** no hardcoded secrets · parameterised queries · resource-level authorisation on every
  parent/student record (a parent must never read another child's ledger by changing an ID) ·
  rate-limited login/activation/reset with per-account lockout · PII redacted from logs · encryption at rest for the stage-3 tier.
- **Access control:** the old `/cms_api.php?action=get` was fully unauthenticated. Public read of
  *public* content is fine; everything else is authenticated and role-scoped.
- **Performance:** target LCP < 2.5 s on a mid-range Android over 4G in Pilani. Static-first
  rendering for public pages.
- **Mobile-first, genuinely:** parents and teachers will use this almost exclusively on phones.
- **PWA:** installable, offline shell, offline-tolerant attendance marking (D1 — this is the
  capability that replaces the native apps we are not building).
- **Accessibility:** WCAG 2.1 AA.
- **Open-source only:** MIT/Apache-2.0/BSD, no vendor lock-in, low hosting cost.
- **TLS:** fix the certificate (discovery §0). Every visitor currently sees a browser security
  warning. The cheapest credibility win available, and independent of this build.

---

## 7. Delivery sequence

| Phase | Output | Gate | State |
|---|---|---|---|
| 1. Scope | This document | Board | ✅ approved |
| 2. Architecture + design | `ADR-001`, `BLUEPRINT-001`, design spec | CTO + CDO | ← in progress |
| 3. Contract lock + foundations | API/schema contracts, auth, sessions, roles | Staff Engineer | |
| 4. Parallel build | Public site · admin · parent · staff | Senior Engineer | |
| 5. Hardening + launch | Security review, DPDP compliance, Go/No-Go | CTO → CEO | |

Single launch (D4): nothing goes public until the website and the V1 portal are both ready.

---

*Prepared by: Agentic Orchestrator · Issue WHO-2 · Phase 1 · v2 (decisions applied)*
