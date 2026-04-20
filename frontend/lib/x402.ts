import type { NextRequest } from 'next/server';

const PAY_TO = process.env.X402_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';
const FACILITATOR = process.env.X402_FACILITATOR_URL || 'https://facilitator.x402.org';
const NETWORK = process.env.X402_NETWORK || 'base-sepolia';
// USDC on Base Sepolia
const ASSET_ADDRESS = process.env.X402_ASSET_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

function parsePayment(req: Request) {
  const headerNames = ['x-payment', 'payment-signature', 'payment'];
  let raw: string | null = null;
  for (const h of headerNames) {
    const v = req.headers.get(h);
    if (v) {
      raw = v;
      break;
    }
  }
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export async function x402Handler(req: NextRequest, opts?: { resource?: string; description?: string; maxAmountRequired?: string }) {
  const payment = parsePayment(req);
  const resource = opts?.resource ?? new URL(req.url).toString();
  const description = opts?.description ?? 'Pay-per-call access to AGENA premium agent endpoints.';
  const maxAmountRequired = opts?.maxAmountRequired ?? '10000';

  // Canonical x402 v1 (Coinbase) response shape — what middleware libraries emit.
  const body = {
    x402Version: 1,
    error: 'X-PAYMENT header is required',
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired,
        resource,
        description,
        mimeType: 'application/json',
        outputSchema: null,
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        asset: ASSET_ADDRESS,
        extra: { name: 'USDC', version: '2' },
      },
    ],
  };

  if (!payment) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x402-version': '1',
        'X-Payment-Required': '1',
        'WWW-Authenticate': `x402 facilitator="${FACILITATOR}", scheme="exact", network="${NETWORK}"`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'x402-version, X-Payment-Required, WWW-Authenticate, X-Payment-Response',
      },
    });
  }

  const settlement = {
    success: true,
    transaction: payment.transaction || null,
    network: payment.network || NETWORK,
    payer: payment.payer || null,
    receivedAt: new Date().toISOString(),
  };

  const settlementB64 = Buffer.from(JSON.stringify(settlement)).toString('base64');

  return new Response(
    JSON.stringify({
      ok: true,
      message: 'Payment accepted. Premium agent call processed.',
      settlement,
    }, null, 2),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x402-version': '1',
        'X-Payment-Response': settlementB64,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'x402-version, X-Payment-Response',
      },
    },
  );
}
