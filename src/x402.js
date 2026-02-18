const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { ExactEvmScheme } = require('@x402/evm/exact/server');

const RECEIVER_WALLET = process.env.PAYMENT_WALLET || '';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.cdp.coinbase.com';

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator)
  .register('eip155:8453', new ExactEvmScheme());

const routes = {
  'GET /score/:mint': {
    accepts: {
      scheme: 'exact',
      price: '$0.01',
      network: 'eip155:8453',
      payTo: RECEIVER_WALLET,
      maxTimeoutSeconds: 60,
    },
    description: 'SURVIVOR token risk score — $0.01 USDC on Base',
  },
};

async function initX402() {
  try {
    await resourceServer.initialize();
    console.log('[x402] Resource server initialized ✓');
  } catch (e) {
    console.warn('[x402] Facilitator init failed:', e.message);
  }
}

const x402Middleware = paymentMiddleware(routes, resourceServer, undefined, undefined, false);

module.exports = { x402Middleware, initX402 };
