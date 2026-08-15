import { NextRequest, NextResponse } from 'next/server';
import { parseChatGPTExport } from '@/lib/chatgpt';
import { extractCards, embed } from '@/lib/extract';
import { adminClient } from '@/lib/supabase';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 });
  }
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = parseChatGPTExport(json);
  if (parsed.length === 0) {
    return NextResponse.json({ error: 'no conversations found in export' }, { status: 400 });
  }

  const supabase = adminClient();
  let imported = 0;
  let cardsCreated = 0;

  for (const conv of parsed) {
    if (conv.sourceId) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('source_id', conv.sourceId)
        .maybeSingle();
      if (existing) continue;
    }
    const { data: convRow, error } = await supabase
      .from('conversations')
      .insert({
        title: conv.title,
        source: 'chatgpt',
        source_id: conv.sourceId,
        message_count: conv.messages.length,
      })
      .select('id')
      .single();
    if (error || !convRow) continue;
    imported++;

    await supabase.from('messages').insert(
      conv.messages.map((m, i) => ({
        conversation_id: convRow.id,
        role: m.role,
        content: m.content,
        position: i,
      }))
    );

    try {
      const cards = await extractCards(conv.title, conv.messages);
      if (cards.length > 0) {
        const embeddings = await embed(cards.map((c) => `${c.title}\n${c.content}`));
        const { error: cardErr } = await supabase.from('knowledge_cards').insert(
          cards.map((c, i) => ({
            conversation_id: convRow.id,
            title: c.title,
            card_type: c.card_type,
            content: c.content,
            tags: c.tags ?? [],
            embedding: embeddings[i],
          }))
        );
        if (!cardErr) cardsCreated += cards.length;
      }
    } catch (e) {
      console.error('extraction failed for conversation', convRow.id, e);
    }
  }

  return NextResponse.json({ imported, skipped: parsed.length - imported, cards: cardsCreated });
}
