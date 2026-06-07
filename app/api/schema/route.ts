import { NextResponse } from 'next/server';
import { getSchema } from '@/lib/notarity/client';
import { FIXTURE_FORM } from '@/lib/notarity/fixture';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const schema = await getSchema();
    return NextResponse.json({ schema, source: 'live' });
  } catch (e) {
    // Offline / unreachable API: fall back to the documented fixture so the
    // experience still works. Clearly labelled so it is never mistaken for live.
    return NextResponse.json({
      schema: FIXTURE_FORM,
      source: 'fixture',
      error: (e as Error).message,
    });
  }
}
