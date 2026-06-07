import { NextRequest, NextResponse } from 'next/server';
import { postPrice } from '@/lib/notarity/client';
import { confirmedPriceFromLineItems } from '@/lib/notarity/payload';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const payload = await req.json();
  try {
    const lineItems = await postPrice(payload);
    return NextResponse.json({
      lineItems,
      confirmedPrice: confirmedPriceFromLineItems(lineItems),
      source: 'live',
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, source: 'error' },
      { status: 502 }
    );
  }
}
