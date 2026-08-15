import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { query } = await req.json();
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'missing query' }, { status: 400 });
  }
  const supabase = adminClient();
  const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`;
  const { data, error } = await supabase
    .from('knowledge_cards')
    .select('id, conversation_id, title, card_type, content, tags, created_at')
    .or(`title.ilike.${pattern},content.ilike.${pattern}`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ results: data });
}
