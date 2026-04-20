import type { NextRequest } from 'next/server';

const PAY_TO = process.env.X402_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';
const FACILITATOR = process.env.X402_FACILITATOR_URL || 'https://facilitator.x402.org';
// Base Sepolia (CAIP-2 eip155:84532) USDC test contract
const NETWORK_CAIP2 = process.env.X402_NETWORK || 'eip155:84532';
const NETWORK_LEGACY = 'base-sepolia';
const ASSET_ADDRESS = process.env.X402_ASSET_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const ASSET_NAME = 'USDC';

function parsePayment(req: Request) {
  const headerNames = ['payment-signature', 'x-payment', 'payment'];
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

  const v2Accept = {
    scheme: 'exact',
    network: NETWORK_CAIP2,
    maxAmountRequired,
    resource,
    description,
    mimeType: 'application/json',
    payToAddress: PAY_TO,
    assetAddress: ASSET_ADDRESS,
    maxTimeoutSeconds: 60,
    extra: { name: ASSET_NAME, version: '2' },
    facilitator: FACILITATOR,
  };

  const v1Accept = {
    scheme: 'exact',
    network: NETWORK_LEGACY,
    asset: ASSET_NAME,
    maxAmountRequired,
    payTo: PAY_TO,
    resource,
    description,
    mimeType: 'application/json',
    maxTimeoutSeconds: 60,
    facilitator: FACILITATOR,
  };

  const body = {
    x402Version: 2,
    error: 'Payment required',
    accepts: [v2Accept, v1Accept],
  };

  if (!payment) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-402-Version': '2',
        'X-Payment-Required': '1',
        'Payment-Required': '1',
        'WWW-Authenticate': `x402 facilitator="${FACILITATOR}", scheme="exact", network="${NETWORK_CAIP2}"`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'X-402-Version, X-Payment-Required, Payment-Required, WWW-Authenticate, Payment-Response, X-Payment-Response',
      },
    });
  }

  const settlement = {
    success: true,
    transaction: payment.transaction || null,
    network: payment.network || NETWORK_CAIP2,
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
        'X-402-Version': '2',
        'Payment-Response': settlementB64,
        'X-Payment-Response': settlementB64,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-402-Version, Payment-Response, X-Payment-Response',
      },
    },
  );
}
