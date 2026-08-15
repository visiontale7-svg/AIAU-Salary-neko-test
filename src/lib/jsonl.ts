import type { ParsedMessage } from './chatgpt';

export interface JsonlCard {
  title: string;
  content: string;
  card_type: 'insight' | 'decision' | 'tradeoff' | 'rejected';
  tags: string[];
}

export interface JsonlConversation {
  title: string;
  messages: ParsedMessage[];
  sourceId?: string | null;
}

export interface ParsedJsonl {
  cards: JsonlCard[];
  conversations: JsonlConversation[];
  errors: number;
}

const CARD_TYPES = new Set(['insight', 'decision', 'tradeoff', 'rejected']);

/** Parse a JSONL file. Supported line formats:
 * - knowledge card: {"title","content","card_type?","tags?"}
 * - inline conversation: {"title","messages":[{"role","content"}]}
 * - flat thread export: a {"record_type":"conversation","thread_id","title"}
 *   header line followed by {"role","text"} message lines. */
export function parseJsonl(text: string): ParsedJsonl {
  const result: ParsedJsonl = { cards: [], conversations: [], errors: 0 };
  let openThread: JsonlConversation | null = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      result.errors++;
      continue;
    }
    if (obj.record_type === 'conversation') {
      openThread = {
        title: typeof obj.title === 'string' && obj.title ? obj.title : '未命名对话',
        sourceId: typeof obj.thread_id === 'string' ? obj.thread_id : null,
        messages: [],
      };
      result.conversations.push(openThread);
    } else if (openThread && typeof obj.role === 'string' && typeof obj.text === 'string') {
      openThread.messages.push({ role: obj.role, content: obj.text });
    } else if (Array.isArray(obj.messages)) {
      const messages = (obj.messages as Record<string, unknown>[])
        .filter((m) => typeof m?.role === 'string' && typeof m?.content === 'string')
        .map((m) => ({ role: m.role as string, content: m.content as string }));
      if (messages.length === 0) {
        result.errors++;
        continue;
      }
      openThread = null;
      result.conversations.push({
        title: typeof obj.title === 'string' && obj.title ? obj.title : messages[0].content.slice(0, 80),
        messages,
      });
    } else if (typeof obj.title === 'string' && typeof obj.content === 'string') {
      openThread = null;
      const rawType = typeof obj.card_type === 'string' ? obj.card_type : 'insight';
      result.cards.push({
        title: obj.title,
        content: obj.content,
        card_type: (CARD_TYPES.has(rawType) ? rawType : 'insight') as JsonlCard['card_type'],
        tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [],
      });
    } else {
      result.errors++;
    }
  }
  result.conversations = result.conversations.filter((c) => c.messages.length > 0);
  return result;
}
