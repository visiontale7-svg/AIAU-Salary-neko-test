import { NextRequest, NextResponse } from 'next/server';
import { analyzeConversation } from '@/lib/analyze';
import { adminClient } from '@/lib/supabase';

export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = adminClient();
  const [{ data: conv }, { data: messages }] = await Promise.all([
    supabase.from('conversations').select('id, title').eq('id', params.id).single(),
    supabase
      .from('messages')
      .select('role, content, position')
      .eq('conversation_id', params.id)
      .order('position'),
  ]);
  if (!conv || !messages || messages.length === 0) {
    return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
  }
  try {
    const analysis = await analyzeConversation(conv.title, messages);
    const { error } = await supabase
      .from('conversations')
      .update({ analysis })
      .eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ analysis });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
