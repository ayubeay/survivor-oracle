# Base x402 rail: built, never functional - 2026-08-04

src/x402.js registers eip155:8453 with @x402/evm ExactEvmScheme, prices /score/:mint at
$0.01 USDC on Base, and has a real PAYMENT_WALLET configured in Railway.

FACILITATOR_URL defaults to https://facilitator.cdp.coinbase.com, which returns NXDOMAIN.
The host does not resolve. initX402 catches the failure and logs "Resource server
initialized" regardless, so the boot log reads as success:

    Failed to fetch supported kinds from facilitator: TypeError: fetch failed
    [x402] Resource server initialized

No payment has ever been taken on this rail, and the failure went unnoticed because
nobody attempted one.

## Two defects
1. The facilitator URL is wrong or retired. The correct endpoint should come from
   Coinbase's current x402 documentation, not from memory.
2. initX402 logs success after catching an initialization failure. A rail that cannot
   reach its facilitator should report degraded, not initialized.

## Not fixing yet, and why
There is no evidence of demand on Base. The Solana rail works, is catalogued in the
Bazaar, and has taken only test settlements. Repairing a second unexercised rail before
the first converts would repeat the pattern.

Three distribution channels are currently built and unconverted: the Bazaar listing, the
SAP agent (stranded, zero calls), and this Base rail (non-functional). A fourth - Virtuals
ACP - was under consideration.

The open question is demand, not distribution.


## Observed symptom (2026-08-04)
GET /score/:mint returns 402, but not a protocol 402:

    {"error":"payment_required","message":"This endpoint requires payment...","upgrade":"DM ..."}

No accepts block, no network, no payTo, no PAYMENT-REQUIRED header. That body comes from
src/auth.js:103.

Middleware order is x402 first (index.js:36) then authMiddleware (index.js:47), so x402 is
passing the request through rather than challenging it - consistent with a resourceServer
that never loaded supported kinds from the unreachable facilitator, leaving it with no
scheme to quote.

Net effect: an x402 client receives a 402 with nothing to pay against. Fixing the
facilitator URL is the first step; whether the challenge then fires needs verifying rather
than assuming.
