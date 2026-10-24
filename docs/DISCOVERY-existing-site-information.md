# DISCOVERY — Information Inventory from Existing Site (hca.edu.in)

**Purpose:** Factual information extracted from the existing site only. No design, layout, styling,
colour, typography, or markup has been carried over — per explicit board direction
("Only info no design and nothing just plain info from the existing site").
This document is the sole input the new build inherits from the old site.

**Extracted:** 2026-10-25 · **Source:** `https://hca.edu.in` (and its `/cms_api.php?action=get` content feed)

---

## 0. Access note (needs fixing, unrelated to scope)

The TLS certificate served on `103.108.220.145` is issued for `mail.hcapilani.in` / `webdisk.hcapilani.in`
and does **not** cover `hca.edu.in`, `www.hca.edu.in`, or `hcapilani.in`. Every browser shows a
certificate-mismatch warning on the live site today. Extraction required relaxed cert verification.
`hca.edu.in`, `www.hca.edu.in` and `hcapilani.in` all resolve to the same IP.

---

## 1. School identity

| Field | Value as published |
|---|---|
| Full name | Hemant Children Academy Secondary School |
| Short name / brand | HCA Pilani |
| Tagline | Secondary School, Pilani |
| Also appears as | "HCASS" (admission portal), "Hemant Children Academy" (portal pages) |
| Logo | None published (`logo_url` is empty) |
| Headline | "Nurturing Bright Minds, Building Better Futures" |
| Grade range | Nursery through Class X |
| Established | "since 2009" (footer); stated elsewhere as "15+ years" |

## 2. Contact details

| Field | Value as published |
|---|---|
| Address (homepage) | Pilani, Rajasthan — 333031 |
| Address (admission portal) | Shiv Colony, Pilani (Raj.) |
| Phone (homepage) | `+91 XXXXX XXXXX` — **placeholder, never filled in** |
| Phone (admission form) | +91-9460540956 / +91-9413935511 |
| Phone (fee structure page) | +91-9460540956 / +91-9413935511 |
| Email (general) | info@hcapilani.in |
| Email (admissions) | admission@hca.edu.in |
| School hours | Mon – Sat: 8:00 AM – 2:00 PM |
| UPI ID (fee payment) | hcapilani@icici |

**Two different domains are in use for email** (`hcapilani.in` and `hca.edu.in`).

### Social media
- Facebook — https://www.facebook.com/hcapilani
- X/Twitter — https://x.com/hcapilani
- Instagram — https://www.instagram.com/hemantchildrenacademy

## 3. Mission, vision, about

- **About:** "Hemant Children Academy Secondary School (HCA) is a premier secondary school in Pilani,
  Rajasthan, dedicated to providing holistic education to students from Nursery through Class X.
  We believe every child is unique and deserves an environment that fosters curiosity, creativity,
  and character."
- **Mission:** "To provide quality education that develops intellect, character, and a sense of social
  responsibility in every student."
- **Vision:** "To be the most trusted school in Pilani by empowering students with knowledge, skills,
  and values for lifelong success."

## 4. Published statistics

| Stat | Value |
|---|---|
| Enrolled students | 500+ |
| Qualified faculty | 30+ |
| Pass rate | 95% |
| Years of service | 15+ |

All four are round marketing figures with no source, date, or definition attached.

## 5. Classes offered

| Grouping as published | Label | Stated age |
|---|---|---|
| Nursery | — | 3–4 yrs |
| LKG | — | 4–5 yrs |
| UKG | — | 5–6 yrs |
| Class I – II | Primary | — |
| Class III – V | Primary | — |
| Class VI – VIII | Middle School | — |
| Class IX | Secondary | — |
| Class X | Board Exams | — |

Admission form and admin filters both enumerate individual classes:
**Nursery, LKG, UKG, Class I … Class X** (14 intake levels).

## 6. Facilities

| Facility | Published description |
|---|---|
| Well-Stocked Library | "Thousands of books, magazines, and digital resources to fuel curiosity and support academic research." |
| Computer Laboratory | "Modern computer labs with internet access to develop digital literacy and 21st-century skills." |
| Science Laboratory | "Fully equipped Physics, Chemistry, and Biology labs for hands-on experiential learning." |
| Playground & Sports | "Spacious grounds for cricket, football, athletics, and other sports promoting physical fitness." |
| Arts & Music Room | "Dedicated spaces for music, dance, drawing, and craft to nurture creativity and expression." |
| Safe Campus | "CCTV surveillance, trained staff, and a secure boundary ensure every child's safety at all times." |

## 7. "Why parents choose us" claims

1. **Experienced & Caring Faculty** — teachers as mentors attentive to each child's learning style.
2. **Holistic Development** — sports, arts, life skills, moral values beyond academics.
3. **Affordable Quality Education** — fees accessible across all sections of society in Pilani.
4. **Transparent Fee Management** — online portal to track dues, view statements, pay via UPI.
5. **Strong Board Results** — "consistently excellent Class X results… with distinction year after year."

## 8. Admissions information

- **Session advertised:** 2025–26 (now stale — we are in the 2026–27 cycle).
- **Stated process (4 steps):** Fill Online Form → Submit Documents → Pay Fees Online → Confirmation.
- **Positioning:** "Seats are limited"; "admission process is simple and entirely online."
- **Portal auth:** email + OTP.

### Data the admission form collects

- **Student:** application no., date of application, class applied for, full name, DOB, gender,
  blood group, Aadhaar, religion, caste, category (General/SC/ST/OBC/EWS), mother tongue, nationality.
- **Address:** permanent address, city, state, PIN; optional separate correspondence address.
- **Father & Mother (each):** full name, Aadhaar, occupation, designation, monthly income,
  office address, mobile, email.
- **Guardian (if different):** full name, relationship, mobile, occupation, email.
- **Previous school:** name, class last attended, board/curriculum, year of passing, reason for leaving,
  medium of instruction (English / Hindi / Bengali / Other).
- **Medical:** known allergies, current medications, physical disabilities, emergency contact
  (other than parents).
- **Siblings:** name, class, admission number.
- **Documents:** passport photo (max 2 MB), birth certificate, student Aadhaar,
  previous-school TC, other documents (multiple).
- **Declaration (5 clauses):** information true; false information voids admission; agree to abide by
  school rules; school may refuse admission without reason; agree to pay fees per fee structure.
  Plus parent/guardian name, date, consent checkbox.
- **Output:** submit generates a PDF.

> This is a large volume of sensitive personal data — Aadhaar numbers, caste/category, family income,
> and medical records for minors. It carries direct DPDP Act 2023 obligations. Flagged for the
> CTO security baseline; not resolved here.

## 9. Fee information

- **Fee structure page:** gated behind *administrator* credentials. It currently reports
  "No Fee Structure Available — the fee structure has not been configured yet."
  **No fee amounts are published anywhere on the existing site.**
- **Stated caveats:** "Fees are subject to change as per school policy"; "payment deadlines will be
  communicated separately."
- **Parent fee portal auth:** mobile number + 6-digit access code, issued class-wise by the office.
- **Payment:** UPI only — deep link, QR code, or manual transfer to `hcapilani@icici`.
  Parents are told to enter the exact amount, add the student name in remarks, and keep a screenshot.
  There is no payment gateway, no automatic reconciliation, and no receipt generation.

## 10. Notices published (all dated 2025, all stale)

| Date | Tag | Notice |
|---|---|---|
| 2025-04-15 | admission | Admissions Open for Session 2025–26 — Nursery to Class X, limited seats, apply online. |
| 2025-04-10 | exam | Annual Examination Schedule Released — Class I–X timetable available; check with school office. |
| 2025-04-07 | holiday | Summer Vacation: May 20 – June 30 — new session begins 1 July 2025. |
| 2025-04-01 | event | Annual Sports Day — April 26, 2025 — parents invited; register participation. |
| 2025-03-25 | fee | Q1 Fee Due: April 30, 2025 — pay online via UPI on the fee portal. |

Useful signal: the notice taxonomy already in use is **admission, exam, holiday, event, fee**.

## 11. Existing site surface (what exists today)

| Path | What it is | State |
|---|---|---|
| `/` , `/index.html` | Single-page public site, CMS-driven | Live |
| `/cms_api.php?action=get` | Public content feed for the homepage | Live, **unauthenticated** |
| `/admission` | Admission portal login (email + OTP) | Live |
| `/admission.html` | Full admission form | Live |
| `/fee_login.html` | Parent fee portal (mobile + 6-digit code) | Live |
| `/fee_structure.html` | Class-wise fees | Live but **empty / not configured** |
| `/fee_payment.html` | UPI payment helper | Live |
| `/admin.html` | Admin dashboard | Live, **in first-run "create admin account" state** |
| `/timetable.html` | Linked from portal nav | **404 — broken link** |
| `/manifest.json`, `/sw.js` | PWA install + service worker | Live |

### Admin modules referenced
Admission submissions (search by name; filter by class, date range, status
**Submitted / Reviewed / Approved / Rejected**; CSV export; paginated 10/25/50/100),
Timetable Generator, Fee Management, Class Fees, Email Management, Website CMS.

### Information absent from the existing site entirely

Affiliation board (CBSE / RBSE / other) · school/affiliation code · principal and management names ·
faculty profiles · academic calendar · syllabus or curriculum detail · actual board results data ·
photo gallery · transport/bus routes · uniform or booklist · TC/certificate requests · alumni ·
mandatory public disclosure · privacy policy / terms · real street address with map ·
a working primary phone number.

---

## 12. Confirmed facts register (board-answered 2026-10-24)

This section **supersedes** anything above it where they conflict. These are the authoritative values.
Everything in §1–§11 is "as published on the old site"; this is "as it will be published on the new one".

| # | Fact | Confirmed value | Supersedes |
|---|---|---|---|
| 1 | Primary phone | **+91 94605 40956** | the `+91 XXXXX XXXXX` placeholder |
| 1b | Secondary phone | +91 94139 35511 | — |
| 2 | Postal address | **Shiv Colony, Pilani, Rajasthan – 333031** | both partial variants |
| 3 | Email domain | **hca.edu.in** (single domain) | `info@hcapilani.in` |
| 4 | Affiliation board | **RBSE (Board of Secondary Education, Rajasthan)** | absent from old site |
| 5 | Registration number | **103 JJN 2003-04** | absent from old site |
| 6 | Founded | **2003** | footer's "since 2009" is **wrong** |
| 7 | Statistics | 500+ students · 30+ faculty · 95% pass rate — confirmed accurate and republishable. Years-of-service is **computed, not stored** (see correction 1) | — |
| 8 | Session to build for | **Fully admin-configurable.** No session year is hardcoded anywhere; the office seeds and switches sessions in the admin panel. 2027–28 is the intended first open intake | the stale 2025–26 |
| 9 | Fee structure | **Admin-entered only.** No amounts hardcoded; office configures class-wise fees in the admin panel | the empty `/fee_structure.html` |
| 10 | Fee payments | **No payment gateway.** Show a simple "Online fee payment — coming soon" state. No UPI deep links, no QR, no manual-transfer instructions | replaces `hcapilani@icici` manual-UPI flow |
| 11 | Leadership | Executive Director — **Mr. Kapoor Singh**<br>Managing Director — **Mr. Mahendra Singh Chahar**<br>Headmaster — **Mrs. Sharmila** | absent from old site |
| 12 | Missing content areas (transport, uniform, calendar, faculty profiles, gallery, results data, alumni) | **Not in scope now.** Tracked as an **internal** roadmap list — *not* published on the public site (D3) | — |
| 13 | Parent authentication | **No SMS.** Office issues a single-use activation code; the parent sets their own password. Reset by email where one is on record, office reissue otherwise. TRAI DLT registration is **out of the project entirely** | replaces the class-wise 6-digit access code *and* the earlier mobile-OTP proposal |
| 14 | DNS for `hca.edu.in` | **Registrar is ERNET India**, school has access. But the **nameservers are delegated to SolidHosting** (`in/eu/sg/us.solidhosting.pro`), so A and MX records are edited in a SolidHosting panel, *not* at ERNET. Verified 2026-10-25 — see `DNS-AND-EMAIL-CUTOVER.md` | the old site's unknown DNS custody |
| 15 | Logo and photographs | **Both exist**; the school is sending the files. Required formats listed in `HOSTING-OPTIONS-AND-COST.md` §5 | the old site's empty `logo_url` and absent imagery |
| 16 | Hosting spend | **On hold by board decision — to be decided at launch cutover.** **Nothing purchased.** Build proceeds on local Docker Compose, which is the same configuration as production. See `HOSTING-OPTIONS-AND-COST.md` | — |
| 17 | Current web + mail host | **Not ERNET.** `103.108.220.145` is on **Parallel Web Cloud Services** (Nashik, Maharashtra), served through **SolidHosting**, with cPanel hostname conventions (`mail.`, `webdisk.`). The hosting invoice is held by someone other than ERNET; the registrar answer was correct, the hosting answer conflated registrar with host. Verified 2026-10-25 | the assumption that ERNET hosts the site |
| 18 | Domain term | `hca.edu.in` registered **18 June 2025**, paid through **18 June 2030**. No renewal risk in this project's horizon | — |
| 19 | Mail path | MX → `mail.hca.edu.in` → same server. SPF additionally authorises a third-party relay, **MailBaby** (`spf-c.mailbaby.net`). DMARC is `p=none` — i.e. no anti-spoofing protection today | — |
| 20 | Photograph consent | **Not known** whether guardian consent was recorded. Requirements, a bilingual consent slip, the system-level enforcement and a no-consent launch fallback are set out in `PHOTO-CONSENT-REQUIREMENTS.md`. **Not launch-blocking** — V1 can launch on imagery containing no identifiable child | — |
| 21 | Git | **Board approved committing the planning documents** (2026-10-24). Repository initialised with its first commit 2026-10-25 | the previously uncommitted working tree |

### Derived corrections to carry into content

1. **Years of service is computed, never stored.** *(F1 — resolved 2026-10-24.)* The site publishes
   **"Since 2003"** alongside a live count derived from the founding date **15 April 2003**,
   rendered as **"N years of national service"**. N increments automatically on 15 April each year;
   as of 2026-10-25, N = **23**. The old "15+ years" figure is retired — it understated the school by
   eight years — and the footer's "since 2009" is simply incorrect. No editable year field exists
   in the CMS for this value, by design.
2. **Session modelling.** *(F2 — resolved 2026-10-24: "fully admin-configurable, seed later".)*
   Academic session is a first-class database entity with its own lifecycle (`upcoming` → `running`
   → `closed`). Nothing in code or content hardcodes a year. The office seeds real sessions and
   switches the open-intake flag; the public site reads whichever session is flagged open. The
   intended first open intake is 2027–28, but that is seeded data, not a constant.
3. **Email is confirmed working.** *(Resolved 2026-10-24: `info@hca.edu.in` receives mail today.)*
   Safe to publish. The `mail.hcapilani.in` certificate observed in §0 is a separate infra artefact
   and does not block us.
4. **95% pass rate** is confirmed for republication. It will be rendered as a school-stated figure
   tied to the RBSE Class X result, not as an audited statistic.
5. **DPDP Act 2023** obligations around the old admission form's Aadhaar / caste / income / medical
   collection remain **open** and are carried into the security baseline, not closed by these answers.
   A second DPDP item is now added: **photographs of identifiable children need recorded guardian
   consent** before appearing on a public page.
6. **Mail must survive the cutover — and it can, cheaply.** *(Added 2026-10-25, resolved the same
   day.)* `hca.edu.in` mail lives on the old host, and email is now load-bearing as the parent
   password-reset channel. The MX record points at the *hostname* `mail.hca.edu.in` rather than a
   bare IP, which means the website can move while mail stays exactly where it is: change the apex
   and `www` A records, leave the `mail` A record and MX untouched. The real risk is **sending**, not
   receiving — the new server must be added to SPF in the same edit, or reset emails land in spam.
   Full sequence in `DNS-AND-EMAIL-CUTOVER.md`.

---

*Prepared by: Agentic Orchestrator · Issue WHO-2 · Phase 0 (Discovery)*
*§12 answered by board 2026-10-24. Phase 1 scope proposal: `PRD-001-scope-proposal.md`.*
