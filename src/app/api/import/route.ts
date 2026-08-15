import { NextRequest, NextResponse } from 'next/server';
import { parseChatGPTExport, type ParsedConversation } from '@/lib/chatgpt';
import { parseJsonl, type JsonlCard } from '@/lib/jsonl';
import { adminClient } from '@/lib/supabase';

export const maxDuration = 300;

async function insertConversation(
  supabase: ReturnType<typeof adminClient>,
  conv: ParsedConversation | { title: string; messages: { role: string; content: string }[]; sourceId?: string | null }
): Promise<{ id: string | null; error?: string }> {
  const sourceId = 'sourceId' in conv ? conv.sourceId : null;
  if (sourceId) {
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('source_id', sourceId)
      .maybeSingle();
    if (existing) return { id: null };
  }
  const { data: convRow, error } = await supabase
    .from('conversations')
    .insert({
      title: conv.title,
      source: sourceId ? 'chatgpt' : 'jsonl',
      source_id: sourceId ?? null,
      message_count: conv.messages.length,
    })
    .select('id')
    .single();
  if (error || !convRow) return { id: null, error: error?.message ?? 'insert failed' };
  const { error: msgErr } = await supabase.from('messages').insert(
    conv.messages.map((m, i) => ({
      conversation_id: convRow.id,
      role: m.role,
      content: m.content,
      position: i,
    }))
  );
  if (msgErr) return { id: convRow.id, error: msgErr.message };
  return { id: convRow.id };
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 });
  }
  const text = await file.text();
  const supabase = adminClient();

  let conversations: { title: string; messages: { role: string; content: string }[]; sourceId?: string | null }[] = [];
  let cards: JsonlCard[] = [];
  let parseErrors = 0;

  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) {
    // ChatGPT official export (conversations.json)
    try {
      conversations = parseChatGPTExport(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
    }
  } else {
    const parsed = parseJsonl(text);
    conversations = parsed.conversations;
    cards = parsed.cards;
    parseErrors = parsed.errors;
  }

  if (conversations.length === 0 && cards.length === 0) {
    return NextResponse.json({ error: 'no conversations or cards found in file' }, { status: 400 });
  }

  const dbErrors: string[] = [];
  let imported = 0;
  for (const conv of conversations) {
    const res = await insertConversation(supabase, conv);
    if (res.id) imported++;
    if (res.error) dbErrors.push(res.error);
  }

  let cardsCreated = 0;
  if (cards.length > 0) {
    const { error } = await supabase.from('knowledge_cards').insert(
      cards.map((c) => ({
        title: c.title,
        card_type: c.card_type,
        content: c.content,
        tags: c.tags,
      }))
    );
    if (error) dbErrors.push(error.message);
    else cardsCreated = cards.length;
  }

  if (imported === 0 && cardsCreated === 0 && dbErrors.length > 0) {
    return NextResponse.json({ error: dbErrors[0] }, { status: 500 });
  }

  return NextResponse.json({
    imported,
    skipped: conversations.length - imported,
    cards: cardsCreated,
    parse_errors: parseErrors,
    db_errors: dbErrors,
  });
}
