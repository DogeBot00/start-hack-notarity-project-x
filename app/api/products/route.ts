import { NextRequest, NextResponse } from 'next/server';
import { getProductsByTags, getProductById } from '@/lib/notarity/client';
import { FIXTURE_PRODUCTS } from '@/lib/notarity/fixture';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tags = req.nextUrl.searchParams.getAll('_tags');
  const ids = req.nextUrl.searchParams.getAll('_ids');
  try {
    const products = tags.length > 0 ? await getProductsByTags(tags) : [];
    // singleProduct auto-adds are not part of any tag query — resolve by id.
    const missing = ids.filter((id) => !products.some((p) => p.id === id));
    const byId = await Promise.all(missing.map((id) => getProductById(id)));
    return NextResponse.json({ products: [...products, ...byId], source: 'live' });
  } catch (e) {
    const products = FIXTURE_PRODUCTS.filter(
      (p) => (p._tags?.some((t) => tags.includes(t)) ?? false) || ids.includes(p.id)
    );
    return NextResponse.json({ products, source: 'fixture', error: (e as Error).message });
  }
}
