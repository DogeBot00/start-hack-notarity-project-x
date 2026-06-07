import { NextRequest, NextResponse } from 'next/server';
import { extractFromDocument } from '@/lib/extract/extractor';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const filename = (file as any).name ?? 'document';
  const mediaType = file.type || 'application/octet-stream';
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  try {
    const result = await extractFromDocument(base64, mediaType, filename);
    return NextResponse.json({ result, filename });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
