import { NextRequest, NextResponse } from 'next/server';
import { submitAppointment } from '@/lib/notarity/client';
import type { BookingPayload } from '@/lib/notarity/types';

export const dynamic = 'force-dynamic';

/**
 * Receives the assembled payload (JSON string) + uploaded files from the browser,
 * forces debug mode based on server config, and forwards the multipart request to
 * notarity. Keeping this server-side protects credentials and lets us enforce the
 * debug guardrail centrally.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const payloadRaw = form.get('payload');
  if (typeof payloadRaw !== 'string') {
    return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
  }

  const payload = JSON.parse(payloadRaw) as BookingPayload;

  // Server-enforced safety: default to debug unless explicitly disabled.
  const debug = (process.env.NOTARITY_DEBUG ?? 'true') !== 'false';
  if (debug) payload.mode = 'debug';
  else delete payload.mode;

  const files: { name: string; data: Blob }[] = [];
  for (const entry of form.getAll('files')) {
    if (entry instanceof Blob) {
      files.push({ name: (entry as any).name ?? 'file.pdf', data: entry });
    }
  }

  try {
    const result = await submitAppointment(payload, files);
    return NextResponse.json({ ok: true, debug, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
