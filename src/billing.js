'use strict';

var crypto = require('crypto');

function initBilling(app) {
  // Lazy-load stripe only if key is set
  var STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) {
    console.log('[billing] STRIPE_SECRET_KEY not set — billing disabled');
    return;
  }

  var stripe = require('stripe')(STRIPE_KEY);
  var { db, DB_PATH } = require("./db");

  // Schema
  db.exec("\
    CREATE TABLE IF NOT EXISTS stripe_fulfillments (\
      session_id TEXT PRIMARY KEY,\
      status TEXT NOT NULL,\
      api_key TEXT,\
      credits_added INTEGER,\
      tier TEXT,\
      created_at INTEGER NOT NULL,\
      fulfilled_at INTEGER,\
      raw_event_id TEXT\
    );\
  ");

  var PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://survivor-oracle-production.up.railway.app';

  var PLANS = {
    starter: { credits: 1000, usd: 29, priceId: process.env.STRIPE_PRICE_STARTER },
    builder: { credits: 5000, usd: 99, priceId: process.env.STRIPE_PRICE_BUILDER },
    pro:     { credits: 25000, usd: 399, priceId: process.env.STRIPE_PRICE_PRO },
  };

  function planFromPriceId(priceId) {
    var keys = Object.keys(PLANS);
    for (var i = 0; i < keys.length; i++) {
      if (PLANS[keys[i]].priceId === priceId) {
        return { name: keys[i], credits: PLANS[keys[i]].credits, usd: PLANS[keys[i]].usd };
      }
    }
    return null;
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  console.log('[billing] Stripe billing enabled');
  console.log('[billing] Plans: starter=$29/1k, builder=$99/5k, pro=$399/25k');

  // ── GET /billing/plans ────────────────────────────────────────────────────

  app.get('/billing/plans', function (req, res) {
    res.json({
      plans: {
        starter: { credits: 1000, usd: 29 },
        builder: { credits: 5000, usd: 99 },
        pro:     { credits: 25000, usd: 399 },
      },
      currency: 'USD',
      note: 'One-time purchase. Credits never expire.',
    });
  });

  // ── POST /billing/checkout ────────────────────────────────────────────────

  var express = require('express');
  app.post('/billing/checkout', express.json(), function (req, res) {
    var planName = (req.body || {}).plan;
    var plan = PLANS[planName];
    if (!plan || !plan.priceId) {
      return res.status(400).json({ error: 'bad_plan', valid_plans: Object.keys(PLANS) });
    }

    stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: PUBLIC_BASE_URL + '/billing/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: PUBLIC_BASE_URL + '/billing/cancel',
      metadata: { plan: planName },
    }).then(function (session) {
      db.prepare('INSERT OR IGNORE INTO stripe_fulfillments (session_id, status, created_at) VALUES (?, ?, ?)').run(
        session.id, 'pending', nowSec()
      );
      res.json({ url: session.url, session_id: session.id });
    }).catch(function (e) {
      console.error('[billing] Checkout error:', e.message);
      res.status(500).json({ error: 'checkout_failed', message: e.message });
    });
  });

  // ── POST /billing/webhook (RAW body — must be registered before express.json) ──

  app.post('/billing/webhook', express.raw({ type: 'application/json' }), function (req, res) {
    var sig = req.headers['stripe-signature'];
    var event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error('[billing] Webhook signature failed:', e.message);
      return res.status(400).send('Webhook Error: ' + e.message);
    }

    if (event.type !== 'checkout.session.completed') {
      return res.json({ received: true, ignored: event.type });
    }

    var session = event.data.object;
    console.log('[billing] checkout.session.completed: ' + session.id);

    // Idempotency check
    var existing = db.prepare('SELECT status FROM stripe_fulfillments WHERE session_id = ?').get(session.id);
    if (existing && existing.status === 'fulfilled') {
      console.log('[billing] Already fulfilled: ' + session.id);
      return res.json({ received: true, idempotent: true });
    }

    // Get line items to determine plan
    stripe.checkout.sessions.listLineItems(session.id, { limit: 1 }).then(function (lineItems) {
      var priceId = lineItems.data && lineItems.data[0] && lineItems.data[0].price && lineItems.data[0].price.id;
      var plan = planFromPriceId(priceId);

      if (!plan) {
        console.error('[billing] Unknown price_id: ' + priceId);
        db.prepare('UPDATE stripe_fulfillments SET status = ?, raw_event_id = ? WHERE session_id = ?').run('failed', event.id, session.id);
        return res.json({ received: true, status: 'failed_unknown_price' });
      }

      // Create API key
      var apiKeyModule = require('./apikeys');
      var key = crypto.randomBytes(24).toString('hex');

      db.prepare('INSERT INTO api_keys (key, name, tier, daily_limit, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
        key, 'stripe:' + plan.name + ':' + session.id.slice(-8), 'paid', 50000, nowSec()
      );

      // Create wallet + add credits
      db.prepare('INSERT OR IGNORE INTO credit_wallets (api_key, credits, total_spent, created_at) VALUES (?, 0, 0, ?)').run(key, nowSec());
      db.prepare('UPDATE credit_wallets SET credits = credits + ? WHERE api_key = ?').run(plan.credits, key);
      db.prepare('INSERT INTO credit_ledger (api_key, action, amount, balance, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        key, 'topup', plan.credits, plan.credits, 'stripe:' + plan.name, nowSec()
      );

      // Record fulfillment
      db.prepare('\
        INSERT INTO stripe_fulfillments (session_id, status, api_key, credits_added, tier, created_at, fulfilled_at, raw_event_id)\
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)\
        ON CONFLICT(session_id) DO UPDATE SET\
          status=excluded.status, api_key=excluded.api_key, credits_added=excluded.credits_added,\
          tier=excluded.tier, fulfilled_at=excluded.fulfilled_at, raw_event_id=excluded.raw_event_id\
      ').run(session.id, 'fulfilled', key, plan.credits, 'paid', nowSec(), nowSec(), event.id);

      console.log('[billing] Fulfilled: ' + plan.name + ' → key=' + key.slice(0, 8) + '... credits=' + plan.credits);
      return res.json({ received: true, status: 'fulfilled' });
    }).catch(function (e) {
      console.error('[billing] Fulfillment error:', e.message);
      db.prepare('UPDATE stripe_fulfillments SET status = ?, raw_event_id = ? WHERE session_id = ?').run('failed', event.id, session.id);
      return res.json({ received: true, status: 'failed', message: e.message });
    });
  });

  // ── GET /billing/success ──────────────────────────────────────────────────

  app.get('/billing/success', function (req, res) {
    var sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: 'missing_session_id' });

    var row = db.prepare('SELECT status, api_key, credits_added, tier FROM stripe_fulfillments WHERE session_id = ?').get(sessionId);

    if (!row) return res.status(404).json({ error: 'unknown_session' });
    if (row.status !== 'fulfilled') return res.status(202).json({ status: row.status, message: 'Payment processing. Refresh in a few seconds.' });

    res.json({
      status: 'fulfilled',
      api_key: row.api_key,
      credits: row.credits_added,
      tier: row.tier,
      quickstart: {
        whoami: 'curl -s ' + PUBLIC_BASE_URL + '/whoami -H "x-api-key: ' + row.api_key + '"',
        attest: 'curl -sX POST ' + PUBLIC_BASE_URL + '/attest -H "x-api-key: ' + row.api_key + '" -H "Content-Type: application/json" -d \'{"mint":"TOKEN_MINT","router_program_id":"Dw5bpnjUeY6XX9oCwqbDUTsAH3vAoSSszr98bfSpMcv"}\'',
      },
    });
  });

  // ── GET /billing/cancel ───────────────────────────────────────────────────

  app.get('/billing/cancel', function (req, res) {
    res.json({ status: 'cancelled', message: 'Payment was cancelled. No charges were made.' });
  });
}

module.exports = { initBilling };
