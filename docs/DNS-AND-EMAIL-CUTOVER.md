# DNS and email cutover — verified current state, and the safe switch

**Issue:** WHO-2 · **Status:** findings, no change made
**Date:** 2026-10-25
**Why this exists:** parent password reset is now email-based (board decision), so `hca.edu.in` mail
is load-bearing. Pointing the domain at a new server carelessly would stop school email *and* lock
parents out of the portal. This document establishes exactly what is there today and the sequence
that avoids that.

> **Nothing in here has been changed.** Every statement below is a read-only lookup, reproducible
> with the commands in §5.

---

## 1. The correction worth having

The board's answer was *"current provider is ERNET"*. That is **right about the registrar and wrong
about the hosting**, and the difference decides who we have to talk to.

| Role | Who actually holds it | Verified by |
|---|---|---|
| **Domain registrar** for `hca.edu.in` | **ERNET India** (IANA ID 800068) — correct | registry WHOIS |
| **Authoritative DNS** (where A and MX records are *edited*) | **SolidHosting** — `in/eu/sg/us.solidhosting.pro` | NS delegation |
| **Web + mail server** `103.108.220.145` | **Parallel Web Cloud Services**, Nashik, Maharashtra (APNIC `PWCS-IN`) | IP WHOIS |
| **Outbound mail relay** | a third party — **MailBaby** (`spf-c.mailbaby.net`), present in the SPF record | DNS TXT |

ERNET is the registry operator for `.edu.in`, so the school's ERNET account is genuinely the
registrar of record — but the nameservers are delegated away to SolidHosting, which means
**day-to-day record changes happen in a SolidHosting control panel, not at ERNET**. That is good
news: editing an A record there is a web form taking minutes, and we do **not** need to go through
an institutional registry workflow for the cutover. ERNET access is only needed if we ever change
the nameservers themselves — which this plan deliberately does not do.

So the hosting invoice is **someone other than ERNET**, and finding it is now a smaller question
than before, because §3 shows the cutover is safe even without that answer.

### One piece of genuinely good news

`hca.edu.in` was registered **18 June 2025** and is **paid through 18 June 2030**. There is no
domain renewal cliff anywhere near this project.

---

## 2. Current records

```
hca.edu.in.          A     103.108.220.145
www.hca.edu.in.      A     103.108.220.145   (via CNAME to apex)
mail.hca.edu.in.     A     103.108.220.145
hca.edu.in.          MX    0 mail.hca.edu.in.
hca.edu.in.          TXT   "v=spf1 ip4:103.108.220.145 include:spf-c.mailbaby.net a mx ~all"
_dmarc.hca.edu.in.   TXT   "v=DMARC1; p=none;"
NS                         in / eu / sg / us .solidhosting.pro
```

`hcapilani.in` is configured identically and resolves to the same server — consistent with the TLS
certificate being issued for `mail.hcapilani.in` / `webdisk.hcapilani.in`. The `mail.` /
`webdisk.` hostname pattern is the signature of a **cPanel shared-hosting account**, which is almost
certainly what the school is paying for.

**The single most important fact here:** the MX record points at the *hostname* `mail.hca.edu.in`,
not at a bare IP. That one detail is what makes the cutover safe, and it is covered next.

---

## 3. The cutover, and why email cannot break

Because mail is addressed by hostname, web and mail can be separated by changing **two records and
leaving a third alone**:

| Record | Action at cutover | Result |
|---|---|---|
| `hca.edu.in` A | → **new server IP** | website moves |
| `www` A / CNAME | → **new server IP** | website moves |
| **`mail.hca.edu.in` A** | **leave at `103.108.220.145`** | **every mailbox keeps working, untouched** |
| `MX 0 mail.hca.edu.in` | **do not touch** | mail still delivers to the old host |

That is the whole trick: migrate the web, leave the mail exactly where it is. No mailbox migration,
no IMAP export, no risk of a Monday morning with no school email. The old hosting account stays paid
for as long as the mailboxes live on it, which is a cost the school is already carrying.

### The gotcha that would actually bite us

Not delivery — **sending**. Once the portal runs on a new server and sends password-reset mail as
`no-reply@hca.edu.in`, the current SPF record does not authorise that server, so a share of resets
would land in spam. For an email channel that is now the account-recovery path, that is a real
outage wearing a disguise.

The fix is one record, applied **at the same time** as the A records, never after:

```
hca.edu.in. TXT "v=spf1 ip4:103.108.220.145 ip4:<NEW_SERVER_IP> include:spf-c.mailbaby.net a mx ~all"
```

Two refinements worth doing in the same sitting, since the panel is already open:

- **Publish DKIM for the new sender** and then move DMARC from `p=none` to `p=quarantine`.
  `p=none` today means the school's domain has no protection against anyone spoofing it — a live
  phishing risk for a school that emails parents, independent of this project.
- **Prefer relaying through the existing provider's authenticated SMTP** rather than sending
  directly from the new VPS. The school already has working `hca.edu.in` SMTP (the board confirmed
  it), fresh VPS IPs have no sending reputation, and an authenticated relay sidesteps the entire
  deliverability problem. This is the route I would take.

### Rehearsal

Lower the TTL on the apex and `www` records to **300 seconds at least 24 hours before** cutover, and
restore it afterwards. With a low TTL, a bad switch is reversible in five minutes instead of a day.
And because the records live in a SolidHosting panel rather than at ERNET, I would want someone to
confirm they can **log in and edit a record** once, before launch day — a forgotten panel password
is the most ordinary way a cutover slips a week.

---

## 4. The TLS warning, separately

Worth repeating because it is the cheapest win available: every visitor to `hca.edu.in` today gets a
browser security warning, because the certificate on that server covers `mail.hcapilani.in` and
`webdisk.hcapilani.in` only. On the new server this disappears by itself — Caddy obtains a
Let's Encrypt certificate for `hca.edu.in` automatically, at zero cost, as soon as the A record
points at it and ports 80/443 are open. It needs no purchase and no decision.

If the school wants the warning gone *before* the new site is ready, the existing host's cPanel
almost certainly offers free AutoSSL, and enabling it is a checkbox. That is independent of this
project and I would do it this week.

---

## 5. Reproducing these findings

```bash
dig +short A hca.edu.in; dig +short MX hca.edu.in
dig +short A mail.hca.edu.in; dig +short NS hca.edu.in
dig +short TXT hca.edu.in; dig +short TXT _dmarc.hca.edu.in
whois hca.edu.in | grep -iE 'registrar|creation|expiry|name server'
whois 103.108.220.145 | grep -iE 'netname|org-name|country'
```

---

## 6. What I still need, and what I no longer need

**No longer blocking.** The cutover sequence in §3 works without knowing the hosting invoice,
because the mail host simply stays where it is. This has dropped from *"answer before launch week"*
to *"useful to know"*.

**Still worth an answer, in priority order:**

1. **Who can log into the SolidHosting DNS panel** — and a one-off confirmation that they can
   actually edit a record. This is now the only human dependency in the cutover.
2. **Is the MailBaby relay a live paid service**, and who holds that account? It is in the SPF
   record, so something was set up deliberately. If it is live and paid, it is the obvious relay for
   the portal's outbound mail and we should use it rather than add a new sender.
3. **Whether `hcapilani.in` should be kept.** It costs money, duplicates `hca.edu.in`, and the board
   already chose a single domain. The clean end state is a 301 redirect to `hca.edu.in` — but mail
   on it (`info@hcapilani.in` is published on the old site) must be checked for live mailboxes
   before anything is switched off.

---

*Prepared by: Agentic Orchestrator · Issue WHO-2 · extends the `current_hosting` answer on the
"Hosting decision + 3 things before launch cutover" card with verified lookups.*
