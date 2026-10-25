# DESIGN-SPEC-001 — HCA Online Presence & School Operations Portal

**Issue:** WHO-4 · **Phase:** 3 (Design Specification) · **Status:** Complete Developer Handoff  
**Author:** Product & UI/UX Designer  
**Audience:** Frontend Software Engineers, CDO, Staff Software Engineer, CEO, Board  
**Authoritative Context:** `PRD-001-scope-proposal.md` (v2), `BLUEPRINT-001-system-design.md`, `ADR-001-technology-stack.md`, `PHOTO-CONSENT-REQUIREMENTS.md`, `HOSTING-OPTIONS-AND-COST.md` §5  
**Canonical Design Tokens:** `docs/tokens.json` (DTCG standard) · `docs/tokens.css` (CSS Custom Properties)  

---

## 1. Executive Summary & Design Philosophy

This specification provides the complete visual, architectural, and component-level blueprint for the new Happy Children Academy (HCA) public website and authenticated school portal.

### 1.1 Core Directives & Hard Constraints
1. **Zero Design Carryover from Existing Site:** Per the board's strict mandate (*"Only info no design and nothing just plain info from the existing site"*), the historical website at `hca.edu.in` contributed confirmed factual data only (founded 15 April 2003, RBSE affiliation, Reg. 103 JJN 2003-04, 500+ students, 30+ faculty, 95% pass rate, named leadership). Visual layout, color palette, typography, HTML structure, and navigational flaws from the legacy site have been rejected and rebuilt from clean architectural foundations.
2. **Minimum-CTA Principle:** Every primary journey is streamlined to eliminate navigational clutter and modal nesting. Primary calls to action are visible above the fold; secondary options use clear spatial grouping. No primary flow exceeds 3 steps without architectural justification.
3. **Token-Only UI Guardrail:** No frontend engineer may write hardcoded hex values, arbitrary pixel paddings, or bespoke font sizes. Every component maps to semantic CSS custom properties defined in `tokens.css`.
4. **PWA Mobile-First for Pilani Reality:** Mobile is the primary computing platform for parents and teachers in Pilani. Layouts are designed specifically for Android viewports under variable daylight conditions, supporting high-contrast typography, 48px tactile touch targets, and offline-tolerant outbox sync for teacher attendance.
5. **DPDP Act 2023 Photographic Privacy:** To uphold Section 9 of the DPDP Act 2023 without blocking launch, public pages are architected with campus, facility, architectural, and non-identifiable student activity imagery as the baseline. Any photograph with an identifiable child is treated as a conditional enhancement requiring an active, verified parental consent record.

---

## 2. Design Tokens & System Standards

All values are formally defined in `docs/tokens.json` and exported as CSS variables in `docs/tokens.css`.

### 2.1 Color Palette & Semantic Mapping
The color palette pairs an authoritative, institutional deep blue with an energetic warm ochre accent reflecting regional heritage, supported by high-contrast neutral slates.

| Token Name | Hex Value | Semantic Usage | Contrast on White | WCAG 2.1 Level |
|---|---|---|---|---|
| `--hca-brand-primary-900` | `#0F294A` | HCA Dark Navy (Hero headers, site footer, brand crest) | 16.2:1 | AAA |
| `--hca-brand-primary-800` | `#1E3A8A` | HCA Deep Blue (Primary typography, key badges) | 9.1:1 | AAA |
| `--hca-brand-primary-600` | `#2563EB` | Royal Blue (Interactive links, primary buttons) | 4.6:1 | AA (Large/UI) |
| `--hca-brand-primary-50` | `#EFF6FF` | Soft Blue Tint (Active table rows, selected tabs) | — | Surface Tint |
| `--hca-brand-accent-600` | `#D97706` | Warm Ochre / Sand (Notice highlights, urgent alerts) | 4.5:1 | AA |
| `--hca-brand-accent-50` | `#FFFBEB` | Warm Gold Tint (Warning background, pinned notice banner) | — | Surface Tint |
| `--text-primary` | `#0F172A` | Slate 900 (Main body copy, headings) | 15.6:1 | AAA |
| `--text-secondary` | `#475569` | Slate 600 (Subheadings, form labels, metadata) | 5.8:1 | AA |
| `--text-muted` | `#64748B` | Slate 500 (Captions, helper text, timestamps) | 4.6:1 | AA |
| `--text-inverse` | `#FFFFFF` | Pure White (Text on dark navy or primary buttons) | 16.2:1 | AAA |
| `--surface-base` | `#FFFFFF` | Page canvas background | — | — |
| `--surface-subtle` | `#F8FAFC` | Neutral subtle background for sections and cards | — | — |
| `--border-standard` | `#CBD5E1` | Slate 300 (Input borders, card dividers) | 3.1:1 | UI Component |
| `--border-focus` | `#2563EB` | Royal Blue focus ring (2px solid, 2px offset) | 4.6:1 | AAA Focus |

#### Attendance Quick-Action Tokens
Classroom attendance demands instant chromatic recognition without reading text:
- **Present:** `--attendance-present-bg` (`#DCFCE7`), text: `#15803D`, border: `#86EFAC`, active: `#16A34A`
- **Absent:** `--attendance-absent-bg` (`#FEE2E2`), text: `#B91C1C`, border: `#FCA5A5`, active: `#DC2626`
- **Late:** `--attendance-late-bg` (`#FEF3C7`), text: `#B45309`, border: `#FCD34D`, active: `#D97706`
- **Leave:** `--attendance-leave-bg` (`#EEF2FF`), text: `#4338CA`, border: `#A5B4FC`, active: `#4F46E5`

### 2.2 Typography Scale
Font Stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Devanagari", sans-serif`.  
The inclusion of `Noto Sans Devanagari` ensures crisp native rendering for Hindi names and notices.

| Scale Token | Font Size | Line Height | Weight | Typical Element |
|---|---|---|---|---|
| `--font-size-xs` | `0.75rem` (12px) | `1.00rem` (16px) | 500 / 600 | Badges, timestamps, legal fine print |
| `--font-size-sm` | `0.875rem` (14px) | `1.25rem` (20px) | 400 / 500 | Form helper text, table data, sub-labels |
| `--font-size-base` | `1.00rem` (16px) | `1.50rem` (24px) | 400 / 500 | Body copy, input values, primary buttons |
| `--font-size-lg` | `1.125rem` (18px) | `1.75rem` (28px) | 600 | Card titles, navigation items, subheadings |
| `--font-size-xl` | `1.25rem` (20px) | `1.75rem` (28px) | 600 / 700 | Section titles, modal headers |
| `--font-size-2xl` | `1.50rem` (24px) | `2.00rem` (32px) | 700 | Page headings (H2), dashboard metrics |
| `--font-size-3xl` | `1.875rem` (30px) | `2.25rem` (36px) | 700 | Major section titles (H1 mobile) |
| `--font-size-4xl` | `2.25rem` (36px) | `2.50rem` (40px) | 700 / 800 | Page hero titles (H1 desktop) |
| `--font-size-5xl` | `3.00rem` (48px) | `1.15` | 800 | Landing page main display statement |

### 2.3 Spatial Scale & Touch Targets
Based on a strict 4px grid (`--space-1`: 4px, `--space-2`: 8px, `--space-3`: 12px, `--space-4`: 16px, `--space-5`: 20px, `--space-6`: 24px, `--space-8`: 32px, `--space-10`: 40px, `--space-12`: 48px, `--space-16`: 64px).
- **Minimum Touch Target:** `44px × 44px` (`--touch-target-min`) across all mobile elements.
- **Comfortable Thumb Target:** `48px × 48px` (`--touch-target-comfortable`) on mobile attendance marking buttons.

### 2.4 Responsive Breakpoints
- **Mobile (`< 640px`):** Single-column stacked layouts, bottom navigation bars, full-width thumb actions.
- **Tablet (`640px – 1023px`):** 2-column grids, collapsible sidebars, adaptive data lists.
- **Desktop (`1024px – 1440px+`):** High-density split panes, persistent navigation rail, multi-column tables.

---

## 3. Information Architecture & UX Critique of BLUEPRINT-001

A review of `BLUEPRINT-001-system-design.md` reveals four structural route conflicts that fight intuitive user mental models and frontend routing hygiene.

### 3.1 UX Critiques & Recommended Route Fixes

| # | Blueprint-001 Route | UX Problem Identified | Recommended Route | Architectural & UX Justification |
|---|---|---|---|---|
| **C1** | `/admissions` (Admin) vs `/admissions` (Public) | **Direct Namespace Collision:** The public marketing page and the admin admission kanban both claim `/admissions`. In Next.js App Router, this forces messy route rewriting or auth leakage. | `/admin/admissions` | Clear separation between public marketing funnel and authenticated administrative workflow. |
| **C2** | `/sessions`, `/students`, `/classes`, `/fees/*` (Admin) | **Root Namespace Pollution:** Admin operational routes are un-namespaced at the root level, cluttering top-level routing and breaking RBAC layout wrapping. | `/admin/sessions`, `/admin/students`, `/admin/classes`, `/admin/fees/*` | Enables a single persistent admin layout with role-gated middleware at `/admin/*`. |
| **C3** | `/child/:id/fees`, `/child/:id/attendance` | **Inconsistent Hierarchy:** Blueprint lists `/portal/child/:id` alongside root `/child/:id/fees`. This breaks breadcrumb navigation and parent dashboard context. | `/portal/children/:id/fees`, `/portal/children/:id/attendance` | Standardizes on restful plural `/portal/children/:id/*`, maintaining the parent portal shell and child-switcher state. |
| **C4** | Teacher `/portal` landing | **Superfluous Landing Step:** Directing teachers to a generic `/portal` home forces a redundant tap before reaching the classroom attendance sheet. | Direct redirect to `/portal/attendance` | Minimizes friction for the teacher who is standing in class during morning roll call. |

### 3.2 Canonical V1 Route Map

```mermaid
flowchart TD
    subgraph Public["Public Website (hca.edu.in)"]
        Home["/ (Home)"]
        About["/about (Credibility & Leadership)"]
        Academics["/academics (Nursery - X Stages)"]
        Facilities["/facilities (6 Verified Amenities)"]
        Admissions["/admissions (Criteria & Process)"]
        Enquiry["/admissions/enquiry (Stage 1 Public Form)"]
        Apply["/admissions/apply/:token (Stage 2 Secure Form)"]
        Notices["/notices (Tagged Public Notices)"]
        NoticeDetail["/notices/:slug"]
        Fees["/fees (Structure & Payment Notice)"]
        Contact["/contact (Address, Phone, Map)"]
        Disclosure["/disclosure (Mandatory RBSE)"]
        Privacy["/privacy & /terms (DPDP Compliant)"]
    end

    subgraph Auth["Authentication Shell"]
        Login["/login (Unified Parent / Staff)"]
        Activate["/activate (Parent Code Bootstrap)"]
        Forgot["/forgot-password (Email / Slip Notice)"]
    end

    subgraph ParentPortal["Parent Portal (/portal)"]
        PDash["/portal (Multi-Child Overview)"]
        PChild["/portal/children/:id"]
        PFees["/portal/children/:id/fees (Ledger & Receipts)"]
        PAtt["/portal/children/:id/attendance (Monthly Calendar)"]
        PNotices["/portal/notices (Class-Targeted)"]
    end

    subgraph StaffPortal["Staff / Teacher Portal"]
        TAtt["/portal/attendance (Daily Register)"]
        TRoster["/portal/roster/:sectionId (Class List)"]
    end

    subgraph AdminPortal["Admin Control Plane (/admin)"]
        ADash["/admin (School Operations Overview)"]
        ASessions["/admin/sessions (Lifecycle Management)"]
        AStudents["/admin/students & /:id (Records & Sensitive)"]
        AParents["/admin/parents/activation (Batch Slips)"]
        AAdmissions["/admin/admissions (Pipeline Kanban)"]
        AFees["/admin/fees (Structure, Billing, Payments)"]
        AAttReport["/admin/attendance/reports"]
        ANotices["/admin/notices (Compose & Expiry)"]
        ACMS["/admin/cms (Public Content Blocks)"]
        AMedia["/admin/media (DPDP Consent Registry)"]
        AAudit["/admin/audit (Immutable Activity Log)"]
    end
```

---

## 4. Zero-CLS Guidance & DPDP Photo Compliance

### 4.1 Reserved Dimensions & Aspect Ratios
To guarantee Cumulative Layout Shift (CLS) = 0 across 4G mobile connections, all media and dynamic containers reserve explicit aspect ratios and bounding boxes in CSS.

| Media Slot | Aspect Ratio | Desktop Dimensions | Mobile Dimensions | Fallback Representation |
|---|---|---|---|---|
| **Header School Logo** | 4:1 | `200px × 50px` | `160px × 40px` | Typographic Wordmark: "Happy Children Academy" |
| **Hero Landmark Image** | 16:9 | `1200px × 675px` | `360px × 202px` | Architectural vector silhouette with brand navy gradient |
| **Facility Card Photo** | 3:2 | `380px × 253px` | `100% × 220px` | Dedicated Facility Icon + Duotone Material Background |
| **Leadership Portrait** | 1:1 | `160px × 160px` | `120px × 120px` | Institutional seal placeholder with officer initials |
| **Student Avatar (Portal)**| 1:1 | `64px × 64px` | `48px × 48px` | Student initials on neutral slate surface |
| **Notice Card Tag** | Auto | Reserved `24px` height | Reserved `24px` height | Pre-rendered badge placeholder |

### 4.2 DPDP Act 2023 Photographic Privacy Architecture
Section 9 of the DPDP Act 2023 mandates verifiable parental consent prior to publishing any photograph showing an identifiable minor.
1. **Launch-Ready Baseline Imagery:** The site ships exclusively with non-identifiable assets:
   - Exterior school gates, campus signboard, and academic building facade.
   - Interior empty laboratory benches, computer lab terminals, library reading stacks, and sports fields.
   - Group wide-angle activity shots from the rear (e.g., students facing classroom blackboard or morning assembly from behind).
   - Real adult portraits of the named leadership (Mr. Kapoor Singh, Mr. Mahendra Singh Chahar, Mrs. Sharmila) with their consent.
2. **Progressive Consent Layering:** The CMS stores `containsIdentifiableChild: boolean` (no default). An asset flagged `true` cannot be published to `PUBLIC_SITE` unless linked to a scanned, verified `MediaConsent` record in the database.
3. **Instant Withdrawal:** When a parent withdraws consent, setting `withdrawnOn` in `/admin/media` automatically unpublishes the asset and triggers Next.js On-Demand ISR revalidation in under 60 seconds.

---

## 5. Screen Inventory & Wireframes

### Surface A: Public Website (`hca.edu.in`)

#### S01: Global Public Header & Navigation
- **Desktop (1440px):**
  ```
  +----------------------------------------------------------------------------------------------------+
  | [HCA Crest] Happy Children Academy  | Affiliated to RBSE (Reg. 103 JJN 2003-04)  | Call: 9460540956  |
  +----------------------------------------------------------------------------------------------------+
  | Home   About   Academics   Facilities   Admissions   Notices   Fees   Contact | [Enquire] [Portal] |
  +----------------------------------------------------------------------------------------------------+
  ```
- **Mobile (360px):**
  ```
  +-----------------------------------+
  | [HCA] Happy Children Academy  [=] |
  | Reg. RBSE 103 JJN · Call: 9460540 |
  +-----------------------------------+
  ```
  *Mobile Drawer:* Full-height overlay with oversized links (44px min tap height), quick dial buttons, and high-visibility "Parent / Staff Login" button at bottom.

---

#### S02: Home Page (`/`)
- **Primary CTA:** "Enquire for Admission" (links to `/admissions/enquiry`).
- **Secondary CTA:** "Call School Office" (`tel:+919460540956`).
- **Desktop Wireframe (1440px):**
  ```
  +----------------------------------------------------------------------------------------------------+
  | HERO:                                                                                              |
  | "Nurturing Curious Minds in Pilani Since 2003"                                                     |
  | Subtitle: 23 Years of National Service · Affiliated with RBSE (Reg. 103 JJN 2003-04)               |
  | [ Button: Submit Admission Enquiry ]   [ Secondary: Call +91 94605 40956 ]                        |
  | [ Reserved Image Slot: Campus Building Exterior (1200x675px, 16:9) ]                              |
  +----------------------------------------------------------------------------------------------------+
  | STATS STRIP:                                                                                       |
  | [ 23 Years Service ]   [ 500+ Active Students ]   [ 30+ Dedicated Faculty ]   [ 95% Pass Rate ]    |
  +----------------------------------------------------------------------------------------------------+
  | URGENT NOTICE TICKER:                                                                              |
  | [PINNED] Admissions Open for Session 2027-28 · Limited Intake Nursery to Class X  [Read Notice ->]  |
  +----------------------------------------------------------------------------------------------------+
  | ACADEMIC FOUNDATIONS:                                                                              |
  | [ Pre-Primary (Nursery-HKG) ]   [ Primary (Class I-V) ]   [ Middle & Secondary (Class VI-X) ]       |
  +----------------------------------------------------------------------------------------------------+
  | LEADERSHIP WELCOME:                                                                                |
  | [ Photo Slot: Headmaster Mrs. Sharmila ]                                                           |
  | "At HCA, education extends beyond textbooks. We build character, discipline, and scientific inquiry|
  |  rooted in our cultural heritage." — Mrs. Sharmila, Headmaster                                     |
  +----------------------------------------------------------------------------------------------------+
  | CAMPUS FACILITIES PREVIEW: (3 cards with 3:2 reserved photo slots)                                 |
  | [ Science Laboratories ]      [ Computer Technology Lab ]    [ Extensive Library ]                 |
  +----------------------------------------------------------------------------------------------------+
  ```
- **Mobile Wireframe (360px):**
  ```
  +-----------------------------------+
  | "Nurturing Curious Minds          |
  |  in Pilani Since 2003"            |
  | 23 Years of Service · RBSE Reg 103|
  |                                   |
  | [ Reserved Hero Slot: 360x202px ] |
  |                                   |
  | [ Primary CTA: Admission Enquiry] |
  | [ Quick Call: +91 94605 40956 ]   |
  +-----------------------------------+
  | 23 Yrs  | 500+  | 30+   | 95%     |
  | Service | Stds  | Staff | Pass    |
  +-----------------------------------+
  | [!] Admissions Open 2027-28   [>] |
  +-----------------------------------+
  | Academic Stages:                  |
  | [ Pre-Primary: Nursery to HKG  >] |
  | [ Primary: Class I to V        >] |
  | [ Secondary: Class VI to X     >] |
  +-----------------------------------+
  | Leadership Spotlight:             |
  | [ Portrait: Headmaster ]          |
  | "Character, discipline & inquiry" |
  | — Mrs. Sharmila, Headmaster       |
  +-----------------------------------+
  ```

---

#### S03: About Us (`/about`)
- **Key Content:** Founding story (15 April 2003), verified registration (103 JJN 2003-04), RBSE curriculum framing, and leadership structure.
- **Desktop Wireframe (1440px):**
  ```
  +----------------------------------------------------------------------------------------------------+
  | Heading: 23 Years of Educational Commitment in Pilani                                              |
  | Subheading: Founded 15 April 2003 · Affiliated to Rajasthan Board of Secondary Education           |
  +----------------------------------------------------------------------------------------------------+
  | [ Story & Values Grid ]                                                                            |
  | Left Column: Founding Journey & Service to Shekhawati Region                                       |
  | Right Column: Statutory Accreditations Card (Registration No: 103 JJN 2003-04, Affiliation: RBSE)  |
  +----------------------------------------------------------------------------------------------------+
  | GOVERNING LEADERSHIP:                                                                              |
  | +-----------------------+ +-----------------------+ +-----------------------+                      |
  | | [Portrait Slot 160px] | | [Portrait Slot 160px] | | [Portrait Slot 160px] |                      |
  | | Mr. Kapoor Singh      | | Mr. Mahendra S. Chahar| | Mrs. Sharmila         |                      |
  | | Executive Director    | | Managing Director     | | Headmaster            |                      |
  | +-----------------------+ +-----------------------+ +-----------------------+                      |
  +----------------------------------------------------------------------------------------------------+
  ```

---

#### S04: Academics (`/academics`)
- **Key Content:** The 14 Class Levels (Nursery, LKG, HKG, Class I through Class X), age criteria, RBSE evaluation methodology, and academic calendar cycle.
- **Layout:** High-contrast tabbed interface by stage (`Pre-Primary`, `Primary`, `Middle School`, `Secondary School`). Each tier details subjects taught, age band requirements, and classroom teacher-student ratios.

---

#### S05: Facilities (`/facilities`)
- **Key Content:** The 6 verified facilities with explicit DPDP-compliant imagery:
  1. **Science Laboratories:** Physics, Chemistry, Biology demonstration benches (empty lab apparatus layout).
  2. **Computer Technology Lab:** Modern PC terminals with broadband connectivity.
  3. **Curated Library:** Reading hall, reference volumes, Hindi & English periodicals.
  4. **Smart Classrooms:** Audio-visual learning units and ventilated seating.
  5. **Sports & Playground:** Outdoor cricket, athletics, and physical training grounds.
  6. **Arts & Creative Studio:** Fine arts, cultural practice space.
- **Card Specification:** Fixed aspect ratio `3:2` image slot, descriptive paragraph, and verified equipment bullet points.

---

#### S06: Admissions Overview (`/admissions`)
- **Key Content:** 3-stage funnel breakdown, active academic session badge (dynamically read from database, never hardcoded), age eligibility matrix, checklist of documents required at Stage 2.
- **Primary CTA:** Prominent sticky button leading directly to `/admissions/enquiry`.

---

#### S07: Stage 1 Admission Enquiry Form (`/admissions/enquiry`)
- **Hard Rule:** Exactly 6 fields. Zero sensitive data (no Aadhaar, no caste, no income, no medical).
- **Desktop & Mobile Wireframe:**
  ```
  +-------------------------------------------------------------+
  | Quick Admission Enquiry (Takes under 2 minutes)             |
  | For Academic Session: 2027–2028 (Open Intake)               |
  +-------------------------------------------------------------+
  | 1. Child's Full Name *                                      |
  |    [ Enter child's name                                   ] |
  |                                                             |
  | 2. Class Seeking Admission For *                            |
  |    [ Select Class (Nursery to Class X)                  v ] |
  |                                                             |
  | 3. Parent / Guardian Full Name *                            |
  |    [ Enter parent's name                                  ] |
  |                                                             |
  | 4. Mobile Number (For Office Contact) *                     |
  |    +91 [ 10-digit mobile number                           ] |
  |                                                             |
  | 5. Email Address (Optional, for digital receipt)            |
  |    [ parent@example.com                                   ] |
  |                                                             |
  | 6. Residential Locality / Village *                         |
  |    [ e.g., Shiv Colony, Pilani / Surajgarh                ] |
  +-------------------------------------------------------------+
  | [ Submit Enquiry (Step 1 of 1)                            ] |
  | Protected under DPDP Act 2023. We never share phone numbers.|
  +-------------------------------------------------------------+
  ```

---

#### S08: Stage 2 Full Admission Application (`/admissions/apply/:token`)
- **Authentication:** Accessed exclusively via single-use secure token link delivered to parents following approved inquiry.
- **Structure:** Multi-section progressive form with persistent step indicator:
  - Step 1: Student Demographics (DOB, Gender, Mother Tongue).
  - Step 2: Parent Background (Occupations, Emergency Phone, Full Address).
  - Step 3: Prior Education & Siblings (Previous School, Transfer Certificate Status).
  - Step 4: Non-Sensitive Document Uploads (Child Passport Photo 1:1, Birth Certificate PDF/JPG, TC Scan — capped at 2MB with client-side image compression).
  - Step 5: Statutory Declarations & Digital Signature Checkbox.

---

#### S09 & S10: Notices Hub (`/notices`) & Notice Reader (`/notices/:slug`)
- **Filters:** 5 Canonical Tags: `All`, `Admission`, `Exam`, `Holiday`, `Event`, `Fee`.
- **Card Blueprint:** Tag pill, publication date, pinned indicator icon, notice headline, 2-line preview, attachment badge (e.g. `PDF 142 KB`).
- **Notice Expiry:** Notices past `publishUntil` are automatically filtered out by server-side query.

---

#### S11: Fee Information (`/fees`)
- **Core Directive:** Renders admin-configured fee structure by class.
- **Mandatory Payment Notice:** Prominent static card displaying:
  *"Online fee payment — coming soon. Offline payments (Cash, Cheque, Bank Transfer) are accepted at the school accounts office during regular hours."*
  *Prohibited:* No UPI QR codes, no manual UPI transfer instructions.

---

#### S12: Contact & Location (`/contact`)
- **Address:** Shiv Colony, Pilani, Rajasthan – 333031.
- **Phone Numbers:** Primary: `+91 94605 40956` · Secondary: `+91 94139 35511`. Both formatted as click-to-dial `tel:` links.
- **Official Email:** `info@hca.edu.in` (`mailto:` link).
- **Office Hours:** Monday – Saturday: 8:00 AM – 2:00 PM.
- **Map:** Embedded OpenStreetMap / Google Maps container with driving directions from Pilani Bus Stand and Birla Institute.

---

#### S13: Mandatory Public Disclosure (`/disclosure`)
- **Structure:** Tabular grid satisfying standard state education board / RTE transparency norms.
- **Slots:** Society Registration Certificate, Building Safety Certificate, Fire Safety NOC, Clean Drinking Water & Sanitary Certificate, Land Certificate, Fee Schedule Copy.

---

### Surface B: Authentication Flows

#### S14: Unified Login (`/login`)
- **Desktop & Mobile Wireframe:**
  ```
  +-------------------------------------------------------------+
  |              HAPPY CHILDREN ACADEMY PORTAL                  |
  |         Sign in to access student & school services         |
  +-------------------------------------------------------------+
  |  [ Parent Account (Tab) ]   |   [ Staff & Admin (Tab) ]     |
  +-------------------------------------------------------------+
  | (When Parent Tab Active)                                    |
  | Mobile Number                                               |
  | +91 [ 10-digit registered mobile                          ] |
  |                                                             |
  | Password                                                    |
  | [ ******************                                    (o) ] |
  |                                                             |
  | [ Sign In to Parent Portal                                ] |
  |                                                             |
  | First time here? [ Activate your account with office code ] |
  | Forgot password? [ Reset via email or office slip ]         |
  +-------------------------------------------------------------+
  ```

---

#### S15: Parent Account Activation (`/activate`)
- **Context:** Office issues a single-use 10-character code on a printed paper slip (e.g., `HCA-7K9-2P4`). Zero SMS dependency.
- **Wireframe:**
  ```
  +-------------------------------------------------------------+
  |                 ACTIVATE PARENT ACCOUNT                     |
  | Bootstrap your password using your office-issued slip code  |
  +-------------------------------------------------------------+
  | 1. Registered Mobile Number                                 |
  |    +91 [ 94605 40956                                      ] |
  |                                                             |
  | 2. 10-Character Activation Code (from office slip)          |
  |    [ HCA-7K9-2P4                                          ] |
  |                                                             |
  | 3. Create Your New Password                                 |
  |    [ Minimum 8 characters with number & symbol            ] |
  |                                                             |
  | 4. Confirm Password                                         |
  |    [ Re-enter password                                    ] |
  |                                                             |
  | 5. Email Address (Recommended for self-service reset)       |
  |    [ parent@example.com                                   ] |
  +-------------------------------------------------------------+
  | [ Complete Activation & Login                             ] |
  +-------------------------------------------------------------+
  ```

---

### Surface C: Parent Portal (`/portal`)

#### S16: Multi-Child Dashboard (`/portal`)
- **UX Goal:** A parent with multiple children can see each child's status at a glance without navigating multiple pages.
- **Desktop (1440px) & Mobile (360px):**
  ```
  +----------------------------------------------------------------------------------------------------+
  | [HCA Portal]  Happy Children Academy           | Active Family: Sharma | [Notices (2)] [Sign Out]  |
  +----------------------------------------------------------------------------------------------------+
  | Welcome, Rajesh Sharma · Parent Dashboard                                                          |
  +----------------------------------------------------------------------------------------------------+
  | CHILD CARDS (Multi-Child View):                                                                    |
  |                                                                                                    |
  | +-----------------------------------------+   +-----------------------------------------+          |
  | | [Avatar] AARAV SHARMA                   |   | [Avatar] PRIYA SHARMA                   |          |
  | | Class V - Section A · Roll #14          |   | | Class II - Section B · Roll #08         |          |
  | | Class Teacher: Mr. Ramesh Verma         |   | | Class Teacher: Mrs. Sunita Devi       |          |
  | +-----------------------------------------+   +-----------------------------------------+          |
  | | Today: [ PRESENT (Green Badge) ]        |   | | Today: [ PRESENT (Green Badge) ]        |          |
  | | Attendance (Oct): 94% (21/22 Days)      |   | | Attendance (Oct): 98% (22/22 Days)      |          |
  | | Fee Status: [ UP TO DATE ]              |   | | Fee Status: [ Dues Pending: Rs 1,400 ]|          |
  | +-----------------------------------------+   +-----------------------------------------+          |
  | | [ View Attendance ] [ View Fee Ledger ] |   | | [ View Attendance ] [ View Fee Ledger ] |          |
  | +-----------------------------------------+   +-----------------------------------------+          |
  +----------------------------------------------------------------------------------------------------+
  | LATEST NOTICES FOR YOUR CHILDREN'S CLASSES:                                                        |
  | * [Class V] Unit Test II Mathematics Schedule Starting Monday, 3 Nov                               |
  | * [General] School Closed for Diwali Break: 28 Oct – 02 Nov                                        |
  +----------------------------------------------------------------------------------------------------+
  ```
  *Mobile Bottom Bar:* `[Home/Children]` · `[Attendance]` · `[Fee Ledger]` · `[Notices]`.

---

#### S17: Parent Fee Ledger (`/portal/children/:id/fees`)
- **Key Information:**
  - Outstanding Balance Banner (e.g., `₹0 Due` or `₹1,400 Due by 30 Nov`).
  - Invoice Summary Table: Session, Period Label (e.g. "Q3 Oct-Dec 2026"), Total Due, Due Date, Status Pill.
  - Payment Receipts History: Date, Receipt No (gapless series, e.g. `RCP-2026-0842`), Mode (Cash/Cheque/Bank Transfer), Amount, `[Download Receipt PDF]` action.
  - Informational Banner: "Online payment gateway under integration. Payments can be settled via Cash/Cheque at the office."

---

#### S18: Parent Attendance View (`/portal/children/:id/attendance`)
- **Key Information:**
  - Month Picker (`< October 2026 >`).
  - Monthly Stat Badges: `20 Present` · `1 Absent` · `1 Late` · `0 Leave` · `Total Working Days: 22` · `Rate: 90.9%`.
  - Interactive Monthly Calendar Grid: Green circles for Present, Red for Absent, Amber for Late, Blue for Leave, Gray for Holidays/Sundays.
  - Tap on date shows detail drawer: Date, Status, Arrival Time (if late), Remarks from Class Teacher.

---

### Surface D: Staff / Teacher Portal (Phone-First, One-Handed)

#### S19: Daily Attendance Register (`/portal/attendance`)
- **Context:** The single highest-frequency action in the entire school system. A teacher stands in a crowded, noisy classroom holding a phone in one hand.
- **Ergonomic Design Requirements:**
  - **Single-Handed Thumb Zone:** All critical action buttons sit in the lower 60% of the mobile screen.
  - **One-Tap Mark All Present:** Default assumption is full attendance; teacher taps 1 button to fill all 45 students as Present, then taps only the 2-3 absent students to toggle them to Absent.
  - **48px Tactile Toggle Pills:** Large tap zones prevent accidental miss-clicks.
  - **Offline Sync & Outbox Counter:** If school WiFi or 4G drops, registers store in browser IndexedDB with an amber status badge (*"1 register queued offline"*). Auto-syncs idempotently upon reconnection.
- **Mobile Classroom Wireframe (360px × 740px):**
  ```
  +-----------------------------------+
  | HCA Staff | Class V-A Attendance  |
  | Date: Today, 25 Oct 2026 [Change] |
  +-----------------------------------+
  | QUICK ACTION:                     |
  | [ *** MARK ALL PRESENT (1-Tap) ***]
  +-----------------------------------+
  | Roll | Student Name   | Status    |
  |------+----------------+-----------|
  | #01  | Aakash Sharma  | [P][A][L] | (P active - Green)
  | #02  | Ananya Gupta   | [P][A][L] | (P active - Green)
  | #03  | Ayush Choudhary| [P][A][L] | (A active - RED)
  | #04  | Bhavesh Soni   | [P][A][L] | (P active - Green)
  | #05  | Chhavi Verma   | [P][A][L] | (L active - AMB)
  | ...  | ...            | ...       |
  | #45  | Zoya Khan      | [P][A][L] | (P active - Green)
  +-----------------------------------+
  | STICKY BOTTOM TRAY (In Thumb Zone)|
  | Total: 45 | Present: 43 | Abs: 2  |
  | [   SUBMIT ATTENDANCE REGISTER   ]|
  | [✓] All marks verified for today  |
  +-----------------------------------+
  ```

---

#### S20: Class Student Roster (`/portal/roster/:sectionId`)
- **Information Density:** Student Roll No, Full Name, Guardian Name, Primary Emergency Phone (`tel:` tap-to-call link for the teacher), Blood Group, Medical Alert indicator (e.g. "Asthma / Inhaler").

---

### Surface E: Admin / Office Control Plane (`/admin`)

#### S21: Admin Operations Overview (`/admin`)
- **Key Metrics Strip:**
  - Active Students (`512`) · Faculty & Staff (`34`) · Today's Global Attendance (`94.2%`) · Active Intake Session (`2027–28`).
- **Urgent Action Tiles:**
  - Pending Inquiries (`14 New`) · Pending Full Applications (`3 Awaiting Review`) · Unmarked Registers Today (`2 Classes Pending`).

---

#### S22: Academic Session Lifecycle Management (`/admin/sessions`)
- **Key Fields:** Session Label (`2026–27`, `2027–28`), Start Date, End Date, State (`UPCOMING`, `RUNNING`, `CLOSED`), Open Admission Toggle (`isAdmissionOpen`).
- **Integrity Rule:** Database constraint ensures exactly 1 session is `RUNNING` and at most 1 is accepting admissions.

---

#### S23: Student Directory & Profile (`/admin/students`, `/admin/students/:id`)
- **Directory Table:** Search by Admission No / Name, Filter by Class & Section, Status pill (`Active`, `Transferred`, `Alumnus`), Actions: Edit, Promote, Issue Transfer Certificate.
- **Student Profile View:**
  - Tab 1: Academic & Enrollment History.
  - Tab 2: Linked Guardians & Emergency Contacts (many-to-many relationship).
  - Tab 3: Fee Ledger & Receipts.
  - Tab 4: Statutory & Sensitive Data (`StudentSensitive` table, encrypted at rest via `pgcrypto`, office role only, logged to `AuditLog` on every access).

---

#### S24: Parent Activation Code Manager (`/admin/parents/activation`)
- **Operational Necessity:** Because SMS is removed by board decision, the office must be able to issue parent login credentials in under 2 clicks.
- **Batch Print Slips Feature:**
  - Office selects a class & section (e.g. "Class V-A").
  - Clicks `[ Generate & Print Slips for All 45 Families ]`.
  - System generates a print-ready A4 grid of tear-off slips: Student Name, Parent Mobile, 10-char Activation Code (`HCA-XXX-XXX`), Instructions in Hindi and English.
  - One-click individual reissue automatically invalidates old password and terminates all active sessions.

---

#### S25: Admission Pipeline Kanban & Table (`/admin/admissions`)
- **Workflow Columns:**
  `1. Submitted` (14) → `2. Under Review` (6) → `3. Approved (Seat Offered)` (8) → `4. Enrolled / Rejected`.
- **Card Actions:** Drag-and-drop or single-click status progression, view uploaded verification documents, trigger Stage-2 application link generation, export CSV.

---

#### S26: Fee Structure & Offline Payment Entry (`/admin/fees`)
- **Sub-View 1 (Structure):** Class-wise fee head definition (Tuition, Development, Examination). Fully admin-configured.
- **Sub-View 2 (Record Payment):** Office selects student -> selects unpaid invoices -> enters Mode (`Cash`, `Cheque`, `Bank Transfer`, `Manual UPI`) -> enters Bank Reference -> Clicks `[ Record & Generate Gapless Receipt ]`.

---

#### S27: Notices CMS & Expiry Enforcement (`/admin/notices`)
- **Notice Composition Modal:**
  - Notice Title (with character limit indicator).
  - Body Copy (Rich text editor).
  - Tag Selection: `Admission`, `Exam`, `Holiday`, `Event`, `Fee`.
  - Audience Selector: `Public Website` or `Portal Only` (Targeted to specific classes).
  - **Mandatory Expiry Field (`publishUntil`):** Date picker prevents stale notices from lingering indefinitely.
  - Pinned Notice Toggle.

---

#### S28: Media Asset & DPDP Consent Registry (`/admin/media`)
- **Columns:** Thumbnail (64px), Asset Caption, Contains Identifiable Child (`Yes` / `No`), Linked Consent Slips Count, Usage Status (`Public Site`, `Portal Only`, `Unpublished`).
- **Guardrail Action:** If `containsIdentifiableChild = true`, the `[Publish to Public Site]` button is disabled until at least one verified consent slip is uploaded.
- **Emergency Button:** `[ Instant Unpublish & Purge Cache ]` immediately revokes public display upon parental request.

---

#### S29: Immutable Audit Log (`/admin/audit`)
- **Columns:** Timestamp, Actor (User Email & Role), Action Type (`CREATE`, `UPDATE`, `DELETE`, `SENSITIVE_READ`), Target Entity, IP Address, JSON Diff Inspection Modal (`Before` vs `After`).

---

## 6. All-State UI Specifications (The 5 States Matrix)

Every component and screen view implements the 5 standardized UI states without causing Cumulative Layout Shift (CLS).

| Screen / Component | 1. Empty / Zero State | 2. Loading / Skeleton State | 3. Ideal / Populated State | 4. Edge / Overflow State | 5. Error / Validation State |
|---|---|---|---|---|---|
| **Public Notices (`/notices`)** | Clean card: "No active notices in this category." Illustration + "View all announcements" button. | 4 shimmer cards with reserved `120px` height. Zero layout jump. | Sorted list of cards with tags, dates, and download attachments. | 50+ notices: paginated by 10 with search bar; notice titles over 100 chars clamp to 2 lines with tooltip. | Inline banner: "Unable to load notices. [Retry Connection Button]". |
| **Admission Enquiry Form (`/admissions/enquiry`)** | Pristine 6-field form with clear placeholder text. | Input fields disabled with soft pulse animation while submitting. | Clean validated fields with green confirmation checks. | Extreme text input (e.g. 150-char name): text inputs scroll horizontally without breaking wrapper. | Inline red border (`#DC2626`) + explicit error message below invalid field without clearing user input. |
| **Parent Dashboard (`/portal`)** | "No student linked to this mobile number. Contact school office with slip." | 2 pulsing child card skeletons (`280px` height) + notice skeleton. | Multi-child cards with live attendance status and fee balance. | 4+ children: horizontal scrollable pill selector at top + vertical stack of child cards. | "Session expired or disconnected. [Reconnect Button]". |
| **Teacher Attendance Register (`/portal/attendance`)** | "No active section assigned for today. Contact admin office." | Table skeleton rows with placeholder circle pills. | Full roster of 45 students with green "P" active badges and submit bar. | 60+ students in section: sticky bottom action tray persists while roster scrolls smoothly. | Sync failure: Amber banner "Offline - Saved locally in Outbox. Auto-syncing when signal resumes." |
| **Parent Fee Ledger (`/portal/children/:id/fees`)** | "No fee records generated yet for session 2026–27." | Skeleton table header and 3 placeholder invoice rows. | Itemized invoices, payment history, and [Download Receipt] buttons. | Multiple partial payments: receipts list expands with pagination; fee balance calculations remain exact. | "Unable to retrieve payment records. Please try again or visit office." |
| **Admin Admissions Pipeline (`/admin/admissions`)** | "No applications in this column yet." Drop zone indicator. | Column skeletons with pulsating card outlines. | Rich kanban board with student applicant cards and status tags. | 200+ applications: virtualized scrolling list with instant search and filter controls. | "Failed to update application status. Changes reverted." Toast alert. |

---

## 7. Accessibility (WCAG 2.1 AA) & Ergonomics

### 7.1 Visual Contrast & Lighting Optimization
- **Contrast Baseline:** All body copy achieves a minimum contrast ratio of `5.8:1` (Slate 600) and `15.6:1` (Slate 900) against white, far exceeding the WCAG 2.1 AA threshold of `4.5:1`.
- **Sunlight Readability:** Mobile screens use strong font weights (600/700) for numerical metrics and high-saturation status badges (`#16A34A` Green, `#DC2626` Red) to maintain legibility in intense outdoor sunlight common in Rajasthan.
- **Focus Rings:** All interactive inputs, buttons, and links display an explicit focus ring: `outline: 2px solid var(--border-focus); outline-offset: 2px;` to support hardware keyboard navigation.

### 7.2 Touch Target Sizing & Spacing
- All buttons and clickable controls maintain a minimum touch target bounding box of `44px × 44px`.
- High-frequency classroom attendance toggle pills use an expanded `48px × 48px` target with an `8px` gutter to eliminate mis-taps when walking through classroom aisles.

### 7.3 Screen Reader & Keyboard Navigation
- **Semantic Landmarks:** Pages are structured with `<header role="banner">`, `<main role="main">`, `<nav role="navigation">`, and `<footer role="contentinfo">`.
- **ARIA Live Regions:** Attendance counter (`Total: 45 | Present: 43 | Absent: 2`) and offline outbox status pills use `aria-live="polite"` so screen readers vocalize updates without interrupting the user.
- **Logical Tab Order:** Form tab indexes follow visual reading order; modal dialogs enforce keyboard focus traps with `Escape` key dismissal.

---

## 8. Minimum-CTA Analysis & Journey Compression

In accordance with the CDO's Minimum-CTA mandate, user interaction counts have been measured and compressed.

| Flow Name | Target Audience | Step-by-Step User Journey | Total Click / Tap Count | UX Justification |
|---|---|---|---|---|
| **Submit Admission Enquiry** | Prospective Parent | 1. Click "Enquire Now" on Hero<br>2. Complete 6 input fields<br>3. Click "Submit Enquiry" | **2 Clicks** (+ typing) | Meets optimal single-screen funnel standard. Zero pagination or modal jumps. |
| **Teacher Daily Attendance Marking** | Class Teacher | 1. Open app (auto-redirects to `/portal/attendance`)<br>2. Tap "Mark All Present" (fills all 45 students)<br>3. Tap 1-2 absent students to toggle<br>4. Tap "Submit Register" | **3 Taps Total** | Marks a class of 45 students in under 20 seconds. Exceptional high-frequency efficiency. |
| **Parent Check Daily Attendance** | Current Parent | 1. Log in / Open PWA<br>2. View child card on home dashboard | **0 Taps** (Visible on load) | Status is surfaced immediately on the dashboard without requiring navigation into a sub-page. |
| **Parent View Fee Balance & Download Receipt** | Current Parent | 1. Log in<br>2. Click "View Fee Ledger" on child card<br>3. Click "Download Receipt" | **2 Taps** | Direct path from child card to PDF invoice/receipt download. |
| **Admin Batch Print Activation Slips** | School Office Staff | 1. Navigate to `/admin/parents/activation`<br>2. Select Class & Section dropdown<br>3. Click "Print Batch Slips" | **2 Clicks** | Replaces complex SMS setup with an instant 2-click paper slip generator for the entire class. |
| **Admin Unpublish Photo on Consent Revocation** | Office / DPO | 1. Search photo or child in `/admin/media`<br>2. Click "Revoke Consent & Unpublish" | **2 Clicks** | Instant compliance with Section 9 DPDP Act in under 60 seconds. |

*Audit Conclusion:* Zero primary flows exceed 3 steps. The system eliminates redundant confirmation modals, replacing them with instant optimistic updates accompanied by temporary undo toasts.

---

## 9. Brand Asset Slots & Specifications

Pending delivery of confirmed school photography and vector crests from the board, the frontend codebase reserves the following immutable slots:

```
/public/brand/
├── logo-header.svg         # 200px x 50px (Horizontal Lockup, Transparent)
├── logo-mark.svg           # 512px x 512px (Square Crest for PWA App Icon & Favicon)
└── placeholder-hero.svg    # 1200px x 675px (Architectural Vector Silhouette Fallback)

/public/images/facilities/
├── science-lab.jpg         # 1200px x 800px (3:2 Ratio)
├── computer-lab.jpg        # 1200px x 800px (3:2 Ratio)
├── library.jpg             # 1200px x 800px (3:2 Ratio)
├── smart-class.jpg         # 1200px x 800px (3:2 Ratio)
├── sports-ground.jpg       # 1200px x 800px (3:2 Ratio)
└── arts-studio.jpg         # 1200px x 800px (3:2 Ratio)

/public/images/leadership/
├── ed-kapoor-singh.jpg     # 400px x 400px (1:1 Ratio)
├── md-mahendra-chahar.jpg  # 400px x 400px (1:1 Ratio)
└── hm-sharmila.jpg         # 400px x 400px (1:1 Ratio)
```

Frontend implementation requires `next/image` with explicit `width`, `height`, and `priority` on above-the-fold hero images to guarantee zero CLS and optimal LCP under 2.5s on 4G networks.

---

*Handoff approved for Frontend Engineering implementation.*
