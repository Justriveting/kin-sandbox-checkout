# KIN Sandbox Checkout: build spec
Prepared Fri Oct 30, 2026, after Tayo's GO. Build starts by Wed Nov 4, 2026.
Submissions close Thu Nov 12, 2026 at 12:00pm PT. Demo video shot by Tue Nov 10.

## Scope (locked by Tayo, Oct 30)
A scoped prototype only. Fictional, clearly labeled example listings; an AI explainer;
PayPal SANDBOX checkout. No real money, no real families, no real donations.
Anything beyond this scope is out, no matter how good the idea is.

## What a judge does in the demo (the whole product)
1. Lands on the listings page and sees the honesty banner first: all examples are
   fictional, KIN accepts no real donations, checkout runs in PayPal sandbox mode.
2. Browses three anonymized fictional needs ("Confidential household" + metro area
   only, category and urgency labels, progress bar), in KIN's brand: coral and cream,
   serif headlines, tagline "A little help can change everything."
3. Opens one listing and reads the AI explainer panel: in plain language, what this
   payment would cover, what KIN verifies before a listing goes live, and what KIN
   does NOT decide (it never promises a family outcome, never handles a real case).
4. Clicks support, completes PayPal sandbox checkout with a sandbox buyer account.
5. Sees a confirmation that names the sandbox transaction ID and restates that no
   real money moved and the household is fictional.

## Architecture (deliberately small)
- Front end: one static page (index.html) rendering listings from data/listings.json.
  No framework, no build step, nothing to break the night before the deadline.
- Checkout: PayPal JavaScript SDK in sandbox mode, Orders API v2 flow
  (create order on the listing amount, capture on approve). Client IDs come from
  environment/config only, never committed. Sandbox buyer credentials for the demo
  are recorded in the submission notes, not in the repo.
- AI explainer: one serverless endpoint (or a small server stub) that takes a
  listing ID and returns the explainer text generated from docs/AI-EXPLAINER-PROMPT.md
  plus that listing's fields. The explainer text for the three demo listings is ALSO
  pre-generated and stored in data/explainers.json as a fallback, so the demo video
  can be shot even if the AI endpoint is down. The judges' requirement is meaningful
  AI use; the live endpoint is the primary path, the fallback is insurance, and the
  README says so honestly.
- No database, no accounts, no real payment code paths. Sandbox flag is a single
  config value and the UI banner reads from it, so sandbox mode can never be
  silently off in the demo build.

## Trust rules baked into the build (from KIN's locked model)
- Four pillars named on the page: recipient choice (publication requires consent),
  KIN decision (eligibility, verification, listing approval), partner choice,
  supporter choice (choose which verified need to meet).
- Listings anonymized: "Confidential household" + metro area only. No names, no
  faces, no hardship storytelling.
- The explainer never says a real family was helped, never invents verification
  results, and always ends with the human line: KIN decides listings; supporters
  decide which need to meet.

## Build order (Nov 4 start, each step leaves a working demo)
- Day 1 (Wed Nov 4): listings page + honesty banner + listings.json live locally.
- Day 2: PayPal sandbox checkout end to end on one listing, then all three.
- Day 3: AI explainer endpoint wired to the listing panel; fallback JSON in place.
- Day 4: confirmation state, README, open-source license, public repo pushed.
- Buffer / demo: script is docs/DEMO-SCRIPT.md (under 3 minutes). Shoot by Nov 10.
- Nov 11: submission form filled from docs/SUBMISSION-CHECKLIST.md. Nov 12 12:00pm PT close.

## Tayo's only remaining steps
- Register the project on Devpost (paypalaihackathon.devpost.com), same as Open Agent.
- Create the PayPal sandbox app at developer.paypal.com and hand over the sandbox
  client ID when build starts (never paste a live credential; sandbox only).
- Pick the AI tool account to use for the explainer endpoint if she has a preference;
  otherwise the builder uses the default already available in her stack.

---
ADDENDUM — Tayo's requirements, Mon Nov 2, 2026 (binding for the build)

FRAMING (Tayo): PayPal is participating in the hackathon; it is NOT becoming part of KIN's operating model. KIN Sandbox Checkout is a contest-specific proof of concept, not an expansion of KIN's production roadmap.

HER FOUR INSISTENCES:
1. AI must be FUNCTIONAL: explain a selected fictional listing, answer relevant questions, and clearly distinguish supplied facts from assumptions. A static paragraph labeled "AI" is not sufficient.
2. Payment integration must be REAL within the sandbox: judges can initiate and complete a test transaction and see a verified sandbox result. No simulated success screen disconnected from PayPal.
3. KIN identity protected: prominent notice, "Demonstration only. All listings are fictional. No real donations or payments are collected." Real KIN operations and financial credentials stay separate.
4. Scope stays small: three listings, one AI explainer, one sandbox checkout, one transaction confirmation. No accounts, matching algorithms, donor dashboards, pooled funds, or production infrastructure.

AI EXPLAINER FOCUS (SETTLED Nov 2, per Tayo's stated preference): PRIMARY = help donors understand each fictional family's stated needs. SUPPORTING = explain the transparency and payment process as a trust feature.

TECHNICAL REQUIREMENTS (Tayo):
- Sandbox payment approval alone is NOT completion. Use a server-side capture operation and confirm its result before displaying a successful transaction.
- Never expose PayPal client secrets in browser code or the public GitHub repository.

DONATION-IMPRESSION SAFEGUARDS (Tayo's one concern): separate demo branding, repeated sandbox disclosures, fictional listing labels, and no links that invite real contributions. Present the KIN vision without presenting the prototype as a launched nonprofit payment service.

TIMELINE (Tayo's, supersedes earlier dates):
- Nov 4-5: Build — app, three fictional listings, AI explanation feature.
- Nov 6-7: Integrate PayPal sandbox checkout; verify the transaction lifecycle.
- Nov 8-9: Test, fix failures, prepare public GitHub repo, open-source license, README.
- Nov 10: Record and publish the under-3-minute demo video.
- Nov 11: Complete the Devpost entry and SUBMIT EARLY; Nov 12 (deadline 12:00pm PT) is contingency only.

---
FINAL APPROVAL — Tayo, Mon Nov 2, 2026

GUIDING SENTENCE for the entire experience: "Understanding comes first. Trust is earned through transparency."

EXPERIENCE ORDER (the flow judges walk):
1. Understand the need
2. Explain the evidence
3. Build trust
4. Complete a sandbox transaction

ARCHITECTURAL DECISION (Tayo): fictional listing data stays SEPARATE from the AI's generated explanations, so the AI cannot quietly invent facts about a family. Unknown information stays unknown.

STATUS: Build specification APPROVED by Tayo. Build begins Wed Nov 4; demo video Tue Nov 10; submit Wed Nov 11; Nov 12 contingency only.
