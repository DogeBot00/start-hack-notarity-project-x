import { NextRequest, NextResponse } from 'next/server';
import { getTimeslots } from '@/lib/notarity/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const label = sp.get('_timeslotLabel') ?? '';
  const startDate = sp.get('startDate') ?? new Date().toISOString();
  const endDate =
    sp.get('endDate') ?? new Date(Date.now() + 7 * 864e5).toISOString();
  try {
    const slots = await getTimeslots(label, startDate, endDate);
    return NextResponse.json({ slots, source: 'live' });
  } catch (e) {
    // Offline fallback: synthesise a few 10-minute slots so the flow is demoable.
    const base = new Date();
    base.setHours(9, 0, 0, 0);
    const slots = Array.from({ length: 6 }).map((_, i) => {
      const start = new Date(base.getTime() + i * 30 * 60000);
      const end = new Date(start.getTime() + 10 * 60000);
      return {
        id: `mock-slot-${i}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        available: 2,
        taken: 0,
        _timeslotLabel: label,
        deleted: false,
      };
    });
    return NextResponse.json({ slots, source: 'fixture', error: (e as Error).message });
  }
}
