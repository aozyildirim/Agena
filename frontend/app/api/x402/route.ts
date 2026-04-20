import { NextRequest } from 'next/server';

const PAY_TO = process.env.X402_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';
const FACILITATOR = process.env.X402_FACILITATOR_URL || 'https://facilitator.x402.org';
const NETWORK = process.env.X402_NETWORK || 'base-sepolia';
const ASSET = process.env.X402_ASSET || 'USDC';

const paymentRequirements = {
  x402Version: 1,
  accepts: [
    {
      scheme: 'exact',
      network: NETWORK,
      asset: ASSET,
      maxAmountRequired: '10000',
      payTo: PAY_TO,
      resource: 'https://agena.dev/api/x402',
      description: 'Pay-per-call access to AGENA premium agent endpoints.',
      mimeType: 'application/json',
      maxTimeoutSeconds: 60,
      facilitator: FACILITATOR,
    },
  ],
  error: 'Payment required',
};

function parsePayment(header: string | null) {
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function handle(req: NextRequest) {
  const payment = parsePayment(req.headers.get('x-payment'));

  if (!payment) {
    return new Response(JSON.stringify(paymentRequirements, null, 2), {
      status: 402,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Payment-Required': '1',
        'WWW-Authenticate': `x402 facilitator="${FACILITATOR}"`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Payment-Required, X-Payment-Response',
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
        'X-Payment-Response': Buffer.from(JSON.stringify(settlement)).toString('base64'),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Payment-Response',
      },
    },
  );
}

export const GET = handle;
export const POST = handle;
