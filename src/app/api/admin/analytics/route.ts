import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

type Rank = { label: string; count: number; revenue?: number };

type AnalyticsCard = {
  title?: string | null;
  group_name?: string | null;
  album_era?: string | null;
};

type AnalyticsItem = {
  unit_price_snapshot?: number | string | null;
  card_title_snapshot?: string | null;
  group_name_snapshot?: string | null;
  album_era_snapshot?: string | null;
  cards?: AnalyticsCard | null;
};

type AnalyticsWishlist = {
  id: string;
  status?: string | null;
  total_price?: number | string | null;
  wishlist_items?: AnalyticsItem[] | null;
};

function positiveMoney(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function addCount(map: Map<string, { count: number; revenue: number }>, value: unknown, revenue: number) {
  const label = String(value ?? '').trim() || 'Unspecified';
  const current = map.get(label) ?? { count: 0, revenue: 0 };
  current.count += 1;
  current.revenue += revenue;
  map.set(label, current);
}

function ranks(map: Map<string, { count: number; revenue: number }>): Rank[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, count: value.count, revenue: Math.round(value.revenue * 100) / 100 }))
    .sort((left, right) => right.count - left.count || right.revenue - left.revenue || left.label.localeCompare(right.label))
    .slice(0, 10);
}

function searchRanks(events: Array<{ normalized_query?: string | null; result_count?: number | null }>, zeroOnly: boolean): Rank[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (zeroOnly && Number(event.result_count) !== 0) continue;
    const label = String(event.normalized_query ?? '').trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const rawDays = Number(request.nextUrl.searchParams.get('days'));
    const days = rawDays === 7 || rawDays === 90 ? rawDays : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [searchResult, wishlistResult] = await Promise.all([
      auth.supabaseAdmin
        .from('storefront_search_events')
        .select('normalized_query, result_count')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .range(0, 9_999),
      auth.supabaseAdmin
        .from('wishlists')
        .select('id, status, total_price, wishlist_items(unit_price_snapshot, card_title_snapshot, group_name_snapshot, album_era_snapshot, cards(title, group_name, album_era))')
        .gte('created_at', since)
        .neq('status', 'cancelled')
        .range(0, 9_999),
    ]);
    if (searchResult.error) throw searchResult.error;
    if (wishlistResult.error) throw wishlistResult.error;

    const wishlists = (wishlistResult.data ?? []) as AnalyticsWishlist[];
    const allGroups = new Map<string, { count: number; revenue: number }>();
    const allAlbums = new Map<string, { count: number; revenue: number }>();
    const allCards = new Map<string, { count: number; revenue: number }>();
    const completedGroups = new Map<string, { count: number; revenue: number }>();
    let itemCount = 0;
    let requestRevenue = 0;
    let completedOrderCount = 0;
    let completedRevenue = 0;

    for (const wishlist of wishlists) {
      const isCompleted = String(wishlist.status ?? '').toLowerCase() === 'completed';
      if (isCompleted) {
        completedOrderCount += 1;
        completedRevenue += positiveMoney(wishlist.total_price);
      }
      for (const item of wishlist.wishlist_items ?? []) {
        const revenue = positiveMoney(item.unit_price_snapshot);
        const card = item.cards;
        const title = item.card_title_snapshot || card?.title;
        const group = item.group_name_snapshot || card?.group_name;
        const album = item.album_era_snapshot || card?.album_era;
        itemCount += 1;
        requestRevenue += revenue;
        addCount(allGroups, group, revenue);
        addCount(allAlbums, album, revenue);
        addCount(allCards, title, revenue);
        if (isCompleted) addCount(completedGroups, group, revenue);
      }
    }

    return NextResponse.json({
      days,
      overview: {
        request_orders: wishlists.length,
        requested_items: itemCount,
        request_value: Math.round(requestRevenue * 100) / 100,
        completed_orders: completedOrderCount,
        completed_value: Math.round(completedRevenue * 100) / 100,
      },
      searches: {
        total: searchResult.data?.length ?? 0,
        top_queries: searchRanks(searchResult.data ?? [], false),
        zero_result_queries: searchRanks(searchResult.data ?? [], true),
      },
      requests: {
        top_groups: ranks(allGroups),
        top_albums: ranks(allAlbums),
        top_cards: ranks(allCards),
      },
      completed: {
        top_groups: ranks(completedGroups),
      },
    });
  } catch (error: unknown) {
    console.error('Could not load admin analytics:', error);
    return NextResponse.json({ error: 'Could not load analytics.' }, { status: 500 });
  }
}
