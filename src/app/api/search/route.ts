import { NextRequest, NextResponse } from 'next/server';
import { embed } from '@/lib/extract';
import { adminClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { query } = await req.json();
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'missing query' }, { status: 400 });
  }
  const [queryEmbedding] = await embed([query]);
  const supabase = adminClient();
  const { data, error } = await supabase.rpc('match_knowledge_cards', {
    query_embedding: queryEmbedding,
    match_count: 20,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ results: data });
}
