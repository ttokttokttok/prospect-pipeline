# Design brief — Champion Comment Workspace

You are designing the hero screen of a B2B growth tool. Produce a high-fidelity UI/UX design
(layout, component hierarchy, all states, and micro-interactions) for the **Champion Workspace**.
Give 2 distinct aesthetic directions to choose from, then a recommended one.

## What the product is
A tool for founders doing **targeted, personalized outreach**. The founder wins their next 2–5
customers by engaging the *champion* at each target company with messages that sound like them and
land a real pain point. The product finds the champion, reads what they post, and drafts the outreach.

It supports **two output modes** the founder can switch between for the same champion:
1. **Comment** — a genuine, in-their-voice reply on the champion's recent LinkedIn post (public,
   warm, low-friction first touch).
2. **Direct message** — a personalized 1:1 message to **copy-paste into a LinkedIn DM or an email**
   (private, more direct ask). Same voice, grounded in the same dossier; when used as email it also
   gets an optional **subject line**.

Thesis (validated in customer interviews): both the comment (on their own post) and the DM reach the
champion 1:1, unlike a broadcast post; and the #1 adoption risk is "AI slop under my name," so
**quality and authentic voice are everything** — every draft must look human and publishable, never
generic.

## Who's using it
A technical founder / growth engineer. Time-poor, taste-sensitive, allergic to cringe. They will not
post anything that embarrasses them. They want to go from "open the app" to "a comment worth posting"
in under 30 seconds.

## The screen to design: Champion Workspace (the hero)
The job of this screen: **make "their post → your comment" the centerpiece**, and make posting it one
click of friction.

Suggested anatomy (improve on it — you're the designer):
- **Left — the champion & their world.** Champion identity (avatar, name, title, company, a "Top Voice"
  badge when applicable) and a one-line *why them* rationale. Their **most recent post shown
  prominently** (text, date, like count), with older posts scannable below. A tight **"what they care
  about"** block: 2–3 pain points, each a short label + a supporting quote from their posts.
- **Right — your move.** A **two-mode output**, switched by a segmented control / tabs at the top:
  - **Comment** — the drafted reply in the founder's voice, prominent and **editable inline**.
    Actions: **Copy**, **Regenerate**, **Open post on LinkedIn** (deep link, so they paste it under
    the real post). A secondary, lower-emphasis strip for **post angles** (1–2 broadcast-post ideas).
  - **Message (DM / email)** — a personalized 1:1 message in the founder's voice, editable inline,
    grounded in the champion's dossier. A small **DM ↔ Email** toggle: in Email mode an editable
    **subject line** appears above the body. Actions: **Copy** (and **Copy with subject** for email),
    **Regenerate**, and channel deep-links (**Open LinkedIn messages**; **mailto** when an email is
    known).
  Both modes share the same left-panel context and the same voice; switching modes must feel instant
  and never lose an edit the user has made.
- **A slim champion rail** (2–5 people) so it reads as a *pipeline*, not a one-off: each champion shows
  a status — **Draft → Copied → Posted → Replied** — and is one click to switch into the workspace.

Make the comparison between *their post* and *your comment* the visual hero — that's the demo moment.

## Data the screen has to work with (real fields)
- Champion: `name`, `title`, `companyDomain`, `avatar` (optional), `isInfluencer` (→ "Top Voice"),
  `reason` ("why them"), `linkedinUrl`.
- Posts (up to 10): `text`, `postedAt`, `likes`, `url`.
- Pain points (2–3): `label`, `evidence` (a quote).
- Comment draft: `comment` (the text), `postUrl` + `postText` (the post being replied to), `postAngles`.
- Message draft: `message` (the DM/email body), `subject` (for email use), `workEmail`/`personalEmail`
  (enable mailto when present).
- Web footprint (optional, for depth): categorized mentions — talk / podcast / github / article.
- Status per champion (client-side), tracked per mode: e.g. comment = draft / copied / posted /
  replied; message = draft / copied / sent / replied.

## States to design (don't skip these)
States apply within whichever output mode (Comment / Message) is active:
- **Empty / first run** (no champions yet — nudge to set up "You" and build a target list).
- **Generating** (a draft is being written — a tasteful loading state, not a dead spinner).
- **Drafted** (the main state above).
- **No posts for this champion** (can't draft a *comment* — explain gracefully; the Message mode may
  still work from the rest of the dossier, so steer the user there).
- **No email known** (Message/Email mode — mailto disabled, DM still available).
- **Edited** (user has tweaked the draft — show it's their version now).
- **Error / regenerate failed** (recoverable, low-drama).

## Supporting screens (functional, not the focus — design lightly)
- **"You" setup / settings:** one-time capture of the founder's **product one-liner** + **their own
  posts (voice)**, persisted across all champions. Reference it; don't over-design it.
- **Build target list:** "describe an ICP or paste target companies" → produces the champion list.
  Keep it minimal; it's the on-ramp to the workspace.

## Constraints (must be buildable fast)
- Stack: **Next.js (App Router) + React + Tailwind v4**. Reuse existing primitives: `Card`, `Badge`,
  `Button`, `Skeleton`. Component-driven; no heavy new dependencies.
- **Desktop-first** (it's demoed on a laptop/projector); graceful but secondary mobile.
- This is a 24-hour hackathon build — favor a few high-impact, low-effort moves over an elaborate
  system. It must look *premium* but be implementable in hours.

## Aesthetic direction
Modern, fast, confident B2B SaaS — think Linear / Vercel / Attio levels of polish. Calm, lots of
whitespace, strong typographic hierarchy, restrained color with one confident accent. The drafted
comment should *feel* human and high-quality — typographically warm, not a robotic textarea. Avoid
anything that reads as "AI tool slop." (Context: built for the Orange Slice AI Growth Hackathon; an
orange accent is on-brand but not required.)

## Deliverables
1. Two aesthetic directions (mood + color + type + one annotated layout each), then a recommendation.
2. The Champion Workspace in detail: full layout, component breakdown, the **Comment ↔ Message**
   mode switch (incl. the DM ↔ Email toggle + subject line), and the key states above.
3. The micro-interactions that sell it: switching champions, switching output mode, DM↔Email toggle,
   regenerate, copy → "Copied"/status advance, edit-in-place, "Open post / Open messages / mailto."
4. Call out the single demo "wow" frame and how the design maximizes it.
