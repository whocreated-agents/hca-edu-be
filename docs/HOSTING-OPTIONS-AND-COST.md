# Hosting — options and cost, for decision

**Issue:** WHO-2 · **Status:** awaiting board decision · **Date:** 2026-10-25
**Raised because:** the board placed hosting spend on hold — *"tell me the options and cost before
anything is bought."*

> **Nothing has been purchased, and nothing will be until this document is answered.**
> Equally important: **the build does not wait on it.** Everything in `ADR-001` runs from one
> `docker compose up`, identically on a laptop, a free tier, or any option below. The purchase is a
> launch-day decision, not a start-work decision. See §6.

---

## 1. What we actually need — sized from the school, not from a pricing page

| Driver | Reality at HCA | Resource consequence |
|---|---|---|
| Users | ~500 families, ~30 staff | Tiny by server standards |
| Peak concurrency | Attendance marking, 8:00–8:30 AM, maybe 30–60 simultaneous requests | A single 2-vCPU box is already over-provisioned |
| Database growth | Students, enrolments, invoices, attendance rows | **Under 1 GB for several years.** Attendance is the only high-row-count table and it is ~500 rows/day |
| File storage | Admission documents, ~300/year at ~5 MB | **~1.5 GB/year.** Photos for the public site add a few hundred MB |
| Public traffic | A school website in a town of Pilani's size | Negligible; it is served as static files |

**Conclusion: 2 vCPU · 4 GB RAM · 80 GB SSD is comfortable, with headroom to spare.** 2 GB would
technically run it, but Postgres plus a Node process plus an on-host build leaves no slack, and
slack is what stops a 2 GB box falling over during a deploy. The difference in price between the two
is small enough that I would not optimise it.

What this means in practice: **almost every option below is oversized for us.** The decision is
therefore not about capacity. It is about three things — *where the data physically sits*, *how much
operational burden we accept*, and *what the school is already paying for*.

---

## 2. The question that should be answered before any of these

**What does the school pay today, for what, and when does it renew?**

The existing site sits on `103.108.220.145` with cPanel-style `webdisk` and `mail` hostnames, which
means there is a live hosting account somewhere with a renewal date. That matters for three reasons:

1. **Mail must keep working.** `hca.edu.in` email is confirmed working and is the notification
   channel for the whole system — and, now that parent password reset is email-based (ADR-001), it is
   load-bearing. If we point the domain's A record at a new server without preserving the **MX
   records**, school email stops. This is the single most likely way to break something real on
   cutover day, and it is entirely avoidable: migrate web, leave mail where it is.
2. **The current provider may already sell a VPS.** Upgrading an existing account can be cheaper
   than a new vendor and keeps one invoice and one support relationship.
3. **We may be about to pay twice.** If the current plan renews annually and cannot host the portal
   anyway, the useful move is to downgrade it to a mail-only plan rather than keep both.

I cannot answer this from outside — it needs whoever holds the hosting invoice.

---

## 3. The options

**Read the prices as indicative list prices to confirm at purchase, not quotes.** They are what these
tiers have cost publicly; providers change them, and Indian regions often carry 18% GST on top.
Where I convert, I assume roughly **₹88/USD** and **₹96/EUR**. I have deliberately not pretended to
more precision than I have.

| # | Option | Where data sits | Indicative cost/month | Honest assessment |
|---|---|---|---|---|
| **A** | **Oracle Cloud Free Tier** — Ampere ARM, 4 cores / 24 GB / 200 GB, Mumbai or Hyderabad | India | **₹0** | Genuinely free and genuinely capable — far more machine than we need. But: no SLA, no support worth the name, account verification is often painful, ARM capacity in Indian regions is frequently unavailable, and free accounts carry reclaim risk. **I would not make it the sole home of a school's student records.** I *would* use it for staging at zero cost |
| **B** | **Indian-region VPS** — e.g. E2E Networks, Utho, Hostinger India; 2 vCPU / 4 GB / 80 GB | India | **₹700–1,500** + GST | The sweet spot for this project. Data in India, latency under 50 ms, prices set in rupees so no FX drift. Trade-off: smaller providers mean thinner documentation and more variable support. Monthly billing where offered; avoid the annual prepay discount until after launch |
| **C** | **AWS Lightsail, Mumbai** — 2 vCPU / 4 GB / 80 GB | India | **~₹2,100** ($24) + GST | Roughly double option B for the same machine. What the premium buys is reliability you can stake a reputation on, and an exit into the rest of AWS if ever needed. A 2 GB tier at ~₹1,050 also exists and would work, with the slack caveat from §1 |
| **D** | **DigitalOcean, Bangalore** — 2 vCPU / 4 GB / 80 GB | India | **~₹2,100** ($24), +20% for managed backups | Comparable to C. Best documentation of any provider here, which has real value if the school ever hands maintenance to someone new |
| **E** | **Hetzner, Germany/Finland** — 2 vCPU / 4 GB / 40 GB | **EU** | **~₹400** (€3.79) + VAT | By far the cheapest competent option, and excellent hardware. Two costs: ~130–160 ms added latency from India (tolerable — public pages are static, and the portal is not chatty), and the data leaves the country. Cross-border transfer is permitted under the DPDP Act except to countries the government notifies as restricted, and none are notified today — so this is *legal*. It is still a conversation I would rather not have with a parent who asks where their child's Aadhaar is stored. **Recommended against for that reason, not a technical one** |
| **F** | **Keep the current shared hosting** | India, presumably | already paid | Not viable for the portal. Shared cPanel hosting will not run Docker, a long-lived Node process, or a Postgres server. Worth keeping **for mail only** (§2) |
| **G** | **Managed PaaS** — Render, Railway, Fly.io + managed Postgres | varies; often no Indian region | **~₹1,800–3,500** ($20–40) | Removes server patching, which is the one ongoing chore in the self-hosted options. But it costs more, splits the bill in two, has weak Indian-region coverage, and reintroduces the platform dependency that guardrail 2 exists to avoid. Reasonable if nobody will ever maintain a server; otherwise no |

### Costs that are not the server

| Item | Indicative cost/month | Note |
|---|---|---|
| TLS certificate | **₹0** | Let's Encrypt via Caddy, automatic renewal. **This is what fixes the browser security warning every visitor currently sees** — it costs nothing and is not a line item |
| Off-host backups | **₹0–100** | Cloudflare R2 or Backblaze B2 for nightly `pg_dump` plus uploaded documents. R2's free tier (10 GB) likely covers us for years. **Not optional** — a single VPS is a single point of failure, and this is the mitigation |
| Domain `hca.edu.in` | already paid, annual | Via ERNET India. Confirmed in hand |
| Email | already paid | Existing `hca.edu.in` mailboxes. No new vendor |
| Error tracking / uptime | **₹0** | Self-hosted GlitchTip + Uptime Kuma on the same box |
| SMS | **₹0** | **Removed from the project.** The board chose office-issued credentials, so there is no SMS vendor and no TRAI DLT registration. This was the largest unknown cost in the earlier estimate and it is now zero |

### Three scenarios, all-in

| Scenario | Stack | Monthly | Annual |
|---|---|---|---|
| **Minimum** | Option A (Oracle free) + free-tier backups | **₹0** | **₹0** |
| **Recommended** | Option B (Indian VPS, 4 GB) + backups + GST | **~₹1,000–1,800** | **~₹12,000–21,600** |
| **Conservative** | Option C or D (AWS/DO Mumbai) + managed backups + GST | **~₹2,600–3,000** | **~₹31,000–36,000** |

For context: the recommended scenario is roughly **₹2–3 per family per month**.

---

## 4. My recommendation

**Option B — a 4 GB VPS in an Indian region, billed monthly — with option A as free staging.**

The reasoning, in order of weight:

1. **Data residency.** This system holds minors' names, photographs, attendance patterns and, in the
   stage-3 tier, Aadhaar numbers. Keeping that inside India is the defensible position, and the price
   of defensibility here is about ₹1,000/month. Option D is cheaper by two-thirds and I am still
   recommending against it.
2. **Monthly, not annual.** Annual prepay typically saves 20–30%, and we should take it — *after* the
   system has run in production for a term. Committing a year to an untested provider to save
   ₹3,000 is a bad trade.
3. **Staging should be free.** Option A's free tier is ideal for the thing that only needs to work
   on weekdays and holds no real data.

**Two things I would do before buying anything, in this order:** answer §2 (what is already being
paid for, and what must stay put for mail), then verify the chosen provider's current price and GST
treatment — because the numbers in §3 are indicative and I will not spend the school's money on my
recollection of a pricing page.

---

## 5. Brand assets — what to send, so one handoff is enough

The school confirmed a logo file and photographs exist. To avoid a second round trip:

**Logo** — ideally **SVG**; otherwise PNG with a transparent background at **1024 px or larger on the
long edge**. If more than one form exists, the useful set is a horizontal lockup (for the site
header) and a square or circular mark (for the favicon and the PWA app icon). We can derive every
other size from those two. A JPEG of a logo on a white square is workable but will show its seams on
a coloured background.

**Photographs** — **2000 px or wider**, landscape where possible, original files rather than
WhatsApp forwards (WhatsApp recompresses to roughly a quarter of the resolution, which is visible
when an image spans a page). Most useful subjects: the building exterior and gate, a classroom in
use, the library, the computer and science labs, the playground, and an assembly or event.

**One obligation attached to the photographs.** Any image showing an identifiable child needs
recorded guardian consent before it appears on a public page — that is a DPDP Act requirement, not a
house style. If consent was not collected at the time, the practical routes are to use images where
faces are not identifiable, or to collect consent for the specific photographs. I would rather raise
this now than take it down after a parent objects.

**If the files turn out to be unavailable or too low-resolution**, launch is not held hostage: a clean
typographic wordmark from the school name, and illustrated or abstract section imagery, is a
perfectly respectable first version. Worth saying, though, that real photographs of a real school
convert enquiries better than anything we can draw.

---

## 6. What happens while this is on hold

Nothing stops. Phase 3 (contract lock and foundations) proceeds against local Docker Compose, which
is the same configuration that will run in production. Concretely, the hosting decision is only
needed for the **launch cutover** — pointing DNS, issuing TLS, running migrations against a real
database. If it is answered any time before then, it has cost the project nothing.

The one thing I would not leave until launch week is §2's mail question, because getting the MX
records wrong is how a school loses its email on a Monday morning.

---

*Prepared by: Agentic Orchestrator · Issue WHO-2 · Phase 2*
