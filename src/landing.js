'use strict';

module.exports = function buildLandingPage(VERSION) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shield Router — Risk-Aware Execution Control for Solana</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#020617;color:#e2e8f0;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;overflow-x:hidden}
code,pre,.mono{font-family:'JetBrains Mono',monospace}
a{color:#f97316;text-decoration:none}
a:hover{text-decoration:underline}

.noise{position:fixed;inset:0;pointer-events:none;opacity:.02;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:800px;height:500px;background:radial-gradient(ellipse,rgba(249,115,22,.06) 0%,transparent 70%);pointer-events:none}

.container{max-width:960px;margin:0 auto;padding:48px 24px;position:relative;z-index:1}

/* Hero */
.hero{text-align:center;margin-bottom:64px;padding-top:32px}
.hero-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#f97316;background:#1a0f00;border:1px solid #f9731633;padding:5px 14px;border-radius:100px;margin-bottom:20px}
.hero-badge .dot{width:6px;height:6px;background:#22c55e;border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.hero h1{font-family:'JetBrains Mono',monospace;font-size:clamp(28px,5vw,48px);font-weight:800;letter-spacing:-1px;line-height:1.1;margin-bottom:16px}
.hero h1 span{color:#f97316}
.hero p{font-size:18px;color:#94a3b8;max-width:600px;margin:0 auto 32px;line-height:1.6}
.hero-cta{display:inline-block;background:#f97316;color:#020617;font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;transition:transform .15s,box-shadow .15s}
.hero-cta:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(249,115,22,.25);text-decoration:none}

/* Code block */
.code-block{background:#0c1222;border:1px solid #1e293b;border-radius:12px;padding:24px;text-align:left;max-width:640px;margin:32px auto 0;font-size:13px;line-height:1.8;color:#94a3b8;overflow-x:auto}
.code-block .kw{color:#c084fc}
.code-block .fn{color:#60a5fa}
.code-block .str{color:#22c55e}
.code-block .cm{color:#475569}

/* Features */
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;margin-bottom:64px}
.feature{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:24px}
.feature-icon{font-size:24px;margin-bottom:12px}
.feature h3{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:#f8fafc;margin-bottom:8px}
.feature p{font-size:13px;color:#64748b;line-height:1.6}

/* Flow */
.flow{margin-bottom:64px}
.flow-title{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:20px;display:flex;align-items:center;gap:8px}
.flow-title::before{content:"";display:block;width:3px;height:14px;background:#f97316;border-radius:2px}
.flow-steps{display:flex;gap:0;align-items:stretch;flex-wrap:wrap}
.flow-step{flex:1;min-width:140px;background:#0f172a;border:1px solid #1e293b;padding:20px 16px;text-align:center;position:relative}
.flow-step:first-child{border-radius:12px 0 0 12px}
.flow-step:last-child{border-radius:0 12px 12px 0}
.flow-step::after{content:"\\2192";position:absolute;right:-12px;top:50%;transform:translateY(-50%);color:#475569;font-size:18px;z-index:2}
.flow-step:last-child::after{display:none}
.flow-step .num{font-family:'JetBrains Mono',monospace;font-size:11px;color:#f97316;margin-bottom:6px}
.flow-step .label{font-size:13px;font-weight:600;color:#e2e8f0}
.flow-step .sub{font-size:11px;color:#475569;margin-top:4px}

/* Pricing */
.pricing{margin-bottom:64px}
.pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
.plan{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:28px;position:relative}
.plan.featured{border-color:#f97316;border-width:2px}
.plan-badge{position:absolute;top:-10px;right:16px;background:#f97316;color:#020617;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;padding:3px 10px;border-radius:4px}
.plan-tier{font-family:'JetBrains Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.plan-price{font-family:'JetBrains Mono',monospace;font-size:32px;font-weight:800;color:#f8fafc}
.plan-credits{font-size:13px;color:#64748b;margin:8px 0 16px}
.plan-features{font-size:13px;color:#94a3b8;line-height:2}

/* Decisions */
.decisions{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:64px}
.decision{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px;text-align:center}
.decision .state{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:800;margin-bottom:6px}
.decision .state.allow{color:#22c55e}
.decision .state.challenge{color:#eab308}
.decision .state.deny{color:#ef4444}
.decision .desc{font-size:12px;color:#64748b}

/* API */
.api-ref{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:24px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#94a3b8;line-height:2;margin-bottom:64px}
.api-ref .method{color:#f97316;font-weight:700}

/* Footer */
.footer{padding-top:24px;border-top:1px solid #1e293b;font-size:12px;color:#475569;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}

@media(max-width:640px){
  .flow-steps{flex-direction:column}
  .flow-step{border-radius:0!important}
  .flow-step::after{content:"\\2193";right:auto;left:50%;top:auto;bottom:-12px;transform:translateX(-50%)}
  .decisions{grid-template-columns:1fr}
}
</style></head><body>
<div class="noise"></div>
<div class="glow"></div>
<div class="container">

<div class="hero">
  <div class="hero-badge"><span class="dot"></span> LIVE — v${VERSION}</div>
  <h1>Shield<span>.</span>Router</h1>
  <p>Risk-aware execution control for Solana. Signed attestations, regime-adaptive pricing, and three-state policy decisions — in one API call.</p>
  <a href="/billing/plans" class="hero-cta">Get API Key — From $29</a>
  <div class="code-block">
    <span class="cm">// npm i @survivorshield/shield</span><br>
    <span class="kw">const</span> { <span class="fn">createShield</span> } = <span class="fn">require</span>(<span class="str">"@survivorshield/shield"</span>);<br>
    <span class="kw">const</span> shield = <span class="fn">createShield</span>({ apiKey: process.env.<span class="str">SURVIVOR_KEY</span> });<br><br>
    <span class="kw">const</span> gate = <span class="kw">await</span> shield.<span class="fn">attestAndGate</span>({<br>
    &nbsp;&nbsp;mint: <span class="str">"TOKEN_MINT"</span>,<br>
    &nbsp;&nbsp;amountUsd: <span class="str">2500</span>,<br>
    });<br><br>
    <span class="kw">if</span> (gate.allow) <span class="fn">executeSwap</span>();<br>
    <span class="kw">if</span> (gate.challenge) <span class="fn">reducePosition</span>(gate.limits.max_amount_usd);<br>
    <span class="kw">if</span> (gate.deny) console.<span class="fn">log</span>(<span class="str">"Blocked"</span>, gate.reasonCodes);
  </div>
</div>

<div class="features">
  <div class="feature">
    <div class="feature-icon">&#x1F50F;</div>
    <h3>Ed25519 Attestations</h3>
    <p>Every risk score is cryptographically signed with borsh serialization. Verifiable on-chain. Tamper-proof.</p>
  </div>
  <div class="feature">
    <div class="feature-icon">&#x26A1;</div>
    <h3>Three-State Decisions</h3>
    <p>ALLOW / CHALLENGE / DENY with score-based amount limits. Not just pass/fail — graduated risk control.</p>
  </div>
  <div class="feature">
    <div class="feature-icon">&#x1F4CA;</div>
    <h3>Regime-Adaptive Pricing</h3>
    <p>Credits adjust dynamically across calm, speculative, mania, and crisis regimes. Pay less when risk is low.</p>
  </div>
  <div class="feature">
    <div class="feature-icon">&#x1F6E1;</div>
    <h3>Drop-in SDK</h3>
    <p>npm i @survivorshield/shield — gate swaps in 3 lines. TypeScript definitions included. Zero dependencies.</p>
  </div>
  <div class="feature">
    <div class="feature-icon">&#x1F4B3;</div>
    <h3>Self-Serve Billing</h3>
    <p>Buy credits via Stripe. Get your API key instantly. No DMs. No approval process. Start in 60 seconds.</p>
  </div>
  <div class="feature">
    <div class="feature-icon">&#x1F50D;</div>
    <h3>Preflight Quotes</h3>
    <p>Simulate policy decisions and credit costs before executing. No charge for /rpe/quote calls.</p>
  </div>
</div>

<div class="flow">
  <div class="flow-title">How It Works</div>
  <div class="flow-steps">
    <div class="flow-step"><div class="num">01</div><div class="label">Buy Credits</div><div class="sub">Stripe checkout</div></div>
    <div class="flow-step"><div class="num">02</div><div class="label">Get API Key</div><div class="sub">Instant delivery</div></div>
    <div class="flow-step"><div class="num">03</div><div class="label">Call /attest</div><div class="sub">Score + sign + decide</div></div>
    <div class="flow-step"><div class="num">04</div><div class="label">Gate Execution</div><div class="sub">ALLOW / CHALLENGE / DENY</div></div>
    <div class="flow-step"><div class="num">05</div><div class="label">Credits Deduct</div><div class="sub">Risk-adjusted cost</div></div>
  </div>
</div>

<div class="flow">
  <div class="flow-title">Policy Decisions</div>
</div>
<div class="decisions">
  <div class="decision"><div class="state allow">ALLOW</div><div class="desc">Score ≥ 65 — Execute swap. Full attestation returned with signature.</div></div>
  <div class="decision"><div class="state challenge">CHALLENGE</div><div class="desc">Score 40-64 — Reduce position. Amount limits enforced ($500-$5,000).</div></div>
  <div class="decision"><div class="state deny">DENY</div><div class="desc">Score &lt; 40 — Block execution. Too risky. Reasons provided.</div></div>
</div>

<div class="flow">
  <div class="flow-title">Pricing</div>
</div>
<div class="pricing">
  <div class="pricing-grid">
    <div class="plan">
      <div class="plan-tier" style="color:#22c55e">Starter</div>
      <div class="plan-price">$29</div>
      <div class="plan-credits">1,000 credits — one-time</div>
      <div class="plan-features">
        &#x2713; Signed attestations<br>
        &#x2713; Three-state policy<br>
        &#x2713; Regime-aware pricing<br>
        &#x2713; SDK access<br>
        &#x2713; Credits never expire
      </div>
    </div>
    <div class="plan featured">
      <div class="plan-badge">POPULAR</div>
      <div class="plan-tier" style="color:#f97316">Builder</div>
      <div class="plan-price">$99</div>
      <div class="plan-credits">5,000 credits — one-time</div>
      <div class="plan-features">
        &#x2713; Everything in Starter<br>
        &#x2713; 5x the credits<br>
        &#x2713; Best value per call<br>
        &#x2713; Priority support<br>
        &#x2713; Credits never expire
      </div>
    </div>
    <div class="plan">
      <div class="plan-tier" style="color:#ef4444">Pro</div>
      <div class="plan-price">$399</div>
      <div class="plan-credits">25,000 credits — one-time</div>
      <div class="plan-features">
        &#x2713; Everything in Builder<br>
        &#x2713; 25x the credits<br>
        &#x2713; Volume pricing<br>
        &#x2713; Dedicated support<br>
        &#x2713; Credits never expire
      </div>
    </div>
  </div>
</div>

<div class="flow">
  <div class="flow-title">API Reference</div>
</div>
<div class="api-ref">
  <span class="method">POST</span> /attest — Signed attestation + pricing + policy decision (requires x-api-key)<br>
  <span class="method">POST</span> /attest/verify — 7-check signature verification<br>
  <span class="method">GET</span>&nbsp; /attest/signer — Oracle pubkey + program binding<br>
  <span class="method">POST</span> /rpe/quote — Preflight policy + cost simulation (no charge)<br>
  <span class="method">POST</span> /rpe/evaluate — Full policy evaluation<br>
  <span class="method">GET</span>&nbsp; /rpe/policy — Policy version + thresholds<br>
  <span class="method">GET</span>&nbsp; /billing/plans — Available credit packages<br>
  <span class="method">POST</span> /billing/checkout — Create Stripe checkout session<br>
  <span class="method">GET</span>&nbsp; /credits/balance — Check credit balance (requires x-api-key)<br>
  <span class="method">GET</span>&nbsp; /credits/ledger — Credit transaction history (requires x-api-key)<br>
  <span class="method">GET</span>&nbsp; /pricing — Current regime + multipliers<br>
  <span class="method">GET</span>&nbsp; /whoami — Account info + usage (requires x-api-key)<br>
  <span class="method">GET</span>&nbsp; /docs — Full API documentation (JSON)
</div>

<div class="footer">
  <div>Shield Router Oracle — Built by <a href="https://x.com/youngs_modulus" target="_blank">@youngs_modulus</a> · <a href="https://github.com/ayubeay/survivor-oracle" target="_blank">GitHub</a> · <a href="https://www.npmjs.com/package/@survivorshield/shield" target="_blank">npm</a></div>
  <div>Agent #598 · Powered by SURVIVOR</div>
</div>

</div></body></html>`;
};
