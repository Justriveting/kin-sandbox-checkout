# KIN Sandbox Checkout

A scoped prototype built for the PayPal AI Hackathon ("Build What's Next with
PayPal and AI", submissions close Nov 12, 2026).

**Every listing here is fictional.** KIN is not accepting real donations, and
checkout runs entirely in PayPal sandbox mode: no real money moves and no real
families are involved. The prototype exists to show how KIN's dignity-preserving
model would work: a supporter chooses a verified need, an AI explainer says in
plain language what the payment covers and what KIN does and does not decide, and
PayPal sandbox checkout completes the flow.

KIN: "A little help can change everything." Neighbors helping neighbors.
Listings are anonymized ("Confidential household" + metro area only) under four
trust pillars: recipient choice, KIN decision, partner choice, supporter choice.

## What is proven, not just built
Verified end to end on November 6, 2026, on the entrant's own machine:
- The live AI explainer answered from each listing's own facts, answered
  "What does the $85 cover?" exactly (cleats plus league fee), and refused a
  question the listing does not answer ("Does this child have any siblings?"
  returned "This is not something the listing states.").
- A sandbox buyer approved the $85 soccer listing and the server captured it;
  PayPal returned a verified COMPLETED capture, Transaction ID
  4JY15284257332943, Order ID 3MP81250H5370563W, USD 85.00 in test funds.
- Order creation carries an idempotency key, and a single automatic retry on a
  dropped connection keeps back-to-back PayPal calls reliable without ever
  creating a duplicate charge path.

## Run it
1. Copy `.env.example` to `.env` and fill in four values: a PayPal SANDBOX
   Client ID and Secret (developer.paypal.com, sandbox app named anything you
   like), an OpenAI API key, and the model line (default gpt-4o-mini). Never
   commit a real credential; `.env` is gitignored.
2. Start the zero-dependency server: `node server.js` (or `npm start`), then
   open http://localhost:8080. Startup prints four lines, and all four should
   say yes: PayPal environment sandbox, Client ID loaded, Client secret
   configured, AI key configured.
3. The server serves the page, generates `/config.js` from `.env` (so the
   sandbox banner and checkout read the same config; the Client ID is never
   hard-coded in the page), and performs server-side order create and capture.
   Listings render from `data/listings.json`.
4. If `PAYPAL_CLIENT_SECRET` is missing or still a placeholder, the page and
   listings still work, but the order endpoints return a clear "sandbox secret
   not configured" error and no success is ever shown. Approval alone is not
   completion: the confirmation appears only after PayPal returns a verified
   COMPLETED capture, and it names the sandbox transaction ID.
5. The explainer is a live OpenAI call governed by `docs/AI-EXPLAINER-PROMPT.md`:
   facts only from the listing's own fields, assumptions flagged separately,
   honest refusal when the listing does not say. Pre-generated fallback text in
   `data/explainers.json` is shown, clearly labeled as fallback, only if the
   live endpoint is unavailable.

## Docs
- Build spec and schedule: `docs/BUILD-SPEC.md`
- Demo video script (under 3 minutes): `docs/DEMO-SCRIPT.md`
- Submission checklist: `docs/SUBMISSION-CHECKLIST.md`

## License
MIT. See `LICENSE`.
