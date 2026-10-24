# Photo consent — what is actually needed before a child's picture goes on the website

**Issue:** WHO-2 · **Status:** answer to the board's *"Not sure — tell me what is needed"*
**Date:** 2026-10-25
**Scope:** publishing photographs on the **public** website. Photographs held privately inside the
portal (a student's profile photo visible only to the office and that child's own guardians) are a
different and much lighter case, covered in §7.

> This is operational guidance for building the system, written so the school can comply without a
> lawyer in the room. It is not legal advice. If the school has a retained advocate, §4's form is the
> one thing worth having them read.

---

## 1. The short answer

Three sentences, then the detail.

1. **A photograph where a child's face is recognisable is personal data of a child**, and under the
   **DPDP Act 2023 (§9)** publishing it needs **verifiable consent of the parent or legal guardian**,
   recorded before publication.
2. **"We sent a note home and nobody objected" is not consent.** The Act requires a clear
   affirmative action — a silence, a pre-ticked box, or a general clause buried in the admission form
   does not qualify.
3. **If consent was not collected, nothing is lost.** The site is designed so it looks like a real,
   busy school using imagery that contains no identifiable child — see §6. Nothing about launch
   depends on this.

---

## 2. When consent is required, and when it is not

| The photograph | Consent needed? |
|---|---|
| A single child, face clear | **Yes** |
| A small group where individual faces are recognisable | **Yes, from every one of them** |
| A child named in the caption, even if the face is unclear | **Yes** — the name is the identifier |
| A child in uniform with the house/section visible, face clear | **Yes** |
| Assembly or sports crowd, faces small and incidental, nobody singled out | **No, in practice** |
| Back of heads, hands at a lab bench, children at a distance | **No** |
| Children facing away from the camera | **No** |
| Empty classroom, library, lab, playground, building, bus | **No** |
| Staff and officers *(adults)* | Not under §9, but take their consent anyway — it is courteous and takes one line |

The test to apply when looking at a candidate photo is not "is this a nice picture of the school"
but: **could a stranger use this page to recognise this specific child?** If yes, it needs consent.
If the honest answer is "maybe", treat it as yes — reviewing 40 photos this way takes an afternoon;
taking a photo down after a parent complains costs a great deal more.

---

## 3. What a valid consent record must contain

The Act says consent must be **free, specific, informed, unconditional and unambiguous, given by a
clear affirmative action**, and **withdrawable at any time**. Translated into fields the system will
store, each consent record needs:

| Field | Why it is there |
|---|---|
| Child's name and class | Which child this is about |
| Guardian's name and relationship | Who gave it, and their standing to give it |
| **Purpose, stated specifically** | "Publication on the school's public website and its official social media pages, for information about the school and its activities." **Not** "for school purposes" — that is too broad to be informed consent |
| **What it does not cover** | No sale, no sharing with third parties, no advertising |
| Date, and guardian's signature | The affirmative action |
| How to withdraw, and who to contact | A named grievance contact at the school. Required by the Act |
| Who recorded it, and when | So the record is auditable |

Two obligations that are easy to miss:

- **Withdrawal must be as easy as giving it.** One phone call or one line in writing to the office,
  and the photo comes down. The system will support this directly (§5).
- **Behavioural advertising and tracking directed at children are prohibited outright** — consent
  cannot authorise them. This is one reason the site carries no third-party ad or analytics
  trackers; the architecture already honours it.

---

## 4. A consent slip the office can use tomorrow

Print on school letterhead, one per child, collected at admission and refreshed each session. Hindi
alongside English, because a consent the parent cannot read is not informed consent.

> ### Photograph publication consent / फोटो प्रकाशन सहमति
>
> **Hemant Children Academy Secondary School**, Shiv Colony, Pilani, Rajasthan 333031
> Reg. No. 103 JJN 2003-04 · Session ____________
>
> Child's name / बच्चे का नाम: ______________________  Class / कक्षा: __________
>
> I am the parent / legal guardian of the child named above. I give my consent for the school to
> **publish photographs and video in which my child appears on the school's public website
> (hca.edu.in) and the school's official social media pages**, for the purpose of sharing
> information about the school and its activities.
>
> मैं ऊपर लिखे बच्चे का माता-पिता / वैध अभिभावक हूँ। मैं विद्यालय को अनुमति देता/देती हूँ कि मेरे बच्चे की
> फोटो या वीडियो विद्यालय की सार्वजनिक वेबसाइट (hca.edu.in) तथा विद्यालय के आधिकारिक सोशल मीडिया
> पृष्ठों पर, विद्यालय और उसकी गतिविधियों की जानकारी देने के उद्देश्य से प्रकाशित की जा सके।
>
> I understand that:
> - the school will **not** sell these photographs, give them to any other organisation, or use them
>   for advertising / विद्यालय इन फोटो को न बेचेगा, न किसी अन्य संस्था को देगा, न विज्ञापन में उपयोग करेगा;
> - my child's **name, class, address or any other personal detail will not be published alongside
>   the photograph** / फोटो के साथ मेरे बच्चे का नाम, कक्षा, पता या अन्य कोई व्यक्तिगत विवरण प्रकाशित नहीं किया जाएगा;
> - I may **withdraw this consent at any time**, by telling the school office in person, in writing,
>   or by telephone, and the photograph will be removed from the website / मैं यह सहमति कभी भी वापस ले
>   सकता/सकती हूँ, और फोटो वेबसाइट से हटा दी जाएगी;
> - **giving or refusing this consent has no effect whatsoever on my child's admission, fees,
>   marks or treatment at the school** / यह सहमति देने या न देने का मेरे बच्चे के प्रवेश, शुल्क, अंकों
>   अथवा विद्यालय में व्यवहार पर कोई प्रभाव नहीं पड़ेगा।
>
> ☐ **I give consent** / मैं सहमति देता/देती हूँ   ☐ **I do not give consent** / मैं सहमति नहीं देता/देती हूँ
>
> Guardian's name / अभिभावक का नाम: ______________________  Relationship / संबंध: __________
> Signature / हस्ताक्षर: ______________________  Date / दिनांक: ______________
>
> *Questions or withdrawal: the school office, +91 94605 40956, during 8:00 AM – 2:00 PM, Mon–Sat.*

Two details in that slip are deliberate and worth not editing out. The **"no effect on admission or
fees"** line is what makes the consent *free* rather than coerced — without it a parent may
reasonably believe refusal counts against their child. And the explicit **"I do not give consent"**
box matters: a returned slip with that box ticked is a far more useful record than a slip that never
came back, because the office then knows the answer instead of guessing.

---

## 5. How the system enforces it

Consent that lives in a drawer gets forgotten by the person uploading photos two years later. So it
becomes a database constraint, not a policy note. This adds two models to `BLUEPRINT-001` §2.7:

| Model | Key fields | Notes |
|---|---|---|
| `MediaAsset` | `fileKey`, `caption?`, `containsIdentifiableChild` *(bool, no default)*, `usage`, `uploadedBy`, `publishedAt?` | `usage ∈ {PUBLIC_SITE, PORTAL_ONLY, UNPUBLISHED}`. The boolean has **no default**, so whoever uploads has to answer the §2 question — the decision cannot be skipped |
| `MediaConsent` | `→MediaAsset`, `→Student`, `→Guardian`, `scope`, `grantedOn`, `evidenceFileKey?`, `recordedBy`, `withdrawnOn?`, `withdrawnReason?` | One row per child in the photograph. `evidenceFileKey` is a scan of the signed slip |

Three rules in code:

1. **A `MediaAsset` with `containsIdentifiableChild = true` cannot be set to `PUBLIC_SITE`** unless
   at least one non-withdrawn `MediaConsent` exists for every child tagged in it. The API rejects it;
   it is not a warning the office can click past.
2. **Withdrawal is one action.** Setting `withdrawnOn` immediately flips the asset to `UNPUBLISHED`
   and revalidates the public pages — so a parent's phone call takes effect in a minute, not at the
   next content update. This is the Act's "as easy to withdraw as to give" requirement made literal.
3. **Every publish, unpublish and consent change is written to `AuditLog`**, giving the school a
   dated record of exactly what was on the public site and on whose authority.

The office also gets an admin page listing published photos with their consent status, so "what are
we currently showing, and are we covered?" is a page rather than an investigation.

---

## 6. If consent was never collected — the fallback

**This is the realistic case, and it is fine.** Assume for planning that no usable consent exists for
historical photographs, and launch on imagery that needs none:

- the **building, gate, signboard and campus** — the single most useful photo on a school website
  is the one that shows a parent what to look for when they arrive;
- **the labs, the library, the computer room, the arts room, the playground** — empty or with
  children at a distance or facing away. These are the six facilities the old site already describes
  in words and never showed;
- **activity from behind or at a distance** — hands on a microscope, a line of children walking into
  assembly seen from the back, a cricket match shot wide;
- **staff and officers, with their own consent** — a real photograph of the Headmaster carries more
  credibility with a prospective parent than any stock image;
- **certificates, the registration document, the affiliation** — these are credibility assets and
  they contain no child at all.

That set is more than enough for a site that looks established and honest. Then collect consent
properly at the start of the next session with the §4 slip, and add faces later as the records come
in. It is the slower path to the same place, with no exposure in between.

What I would avoid entirely is the shortcut of blurring faces. It looks worse than no photograph,
and it signals to a visiting parent that something is being hidden.

---

## 7. Photographs inside the portal (not public)

A student's profile photograph shown only to the office, that child's class teacher, and that
child's own guardians is **not publication**, and §9's publication-consent question does not arise
in the same form. It is ordinary processing for running the school, and the admission form already
collects a passport photograph for exactly this purpose.

The obligations that do apply there are the ones the design already meets: the photo is behind the
relationship check that governs every other student record, so another family cannot reach it; it is
served from private storage via short-lived signed URLs rather than a guessable public path; and it
is covered by the privacy notice. **A portal photo is never promoted to the public site by any
automatic path** — moving one requires an explicit upload with the §5 consent check.

---

## 8. What I need from the school

Nothing blocking. Two things when convenient:

1. **A yes/no on historical photographs** — if signed permissions exist in the office for any
   photographs the school wants to publish, say so and I will build the consent-record import. If
   the answer is no or unknown, I proceed on §6 and nothing changes in the plan.
2. **A named grievance contact** for the privacy notice and the consent slip — one officer's name
   and the office phone number. The Act expects a published contact for data questions, and
   the privacy policy is already launch-blocking, so this is a field I need filled either way.

---

*Prepared by: Agentic Orchestrator · Issue WHO-2 · answers the `photo_consent` question on the
"Hosting decision + 3 things before launch cutover" card.*
