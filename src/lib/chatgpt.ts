export interface ParsedMessage {
  role: string;
  content: string;
}

export interface ParsedConversation {
  title: string;
  sourceId: string | null;
  messages: ParsedMessage[];
}

interface ExportNode {
  id: string;
  parent: string | null;
  children: string[];
  message: {
    author: { role: string };
    content: { content_type: string; parts?: unknown[]; text?: string };
    create_time: number | null;
  } | null;
}

interface ExportConversation {
  title: string | null;
  conversation_id?: string;
  id?: string;
  current_node: string;
  mapping: Record<string, ExportNode>;
}

function nodeText(node: ExportNode): string | null {
  const msg = node.message;
  if (!msg) return null;
  const c = msg.content;
  if (c.content_type === 'text' && Array.isArray(c.parts)) {
    const text = c.parts.filter((p): p is string => typeof p === 'string').join('\n').trim();
    return text || null;
  }
  if (typeof c.text === 'string' && c.text.trim()) return c.text.trim();
  return null;
}

/** Parse the official ChatGPT export (conversations.json). Walks the
 * current_node branch of each conversation tree from leaf to root. */
export function parseChatGPTExport(json: unknown): ParsedConversation[] {
  const conversations = Array.isArray(json) ? (json as ExportConversation[]) : [];
  const result: ParsedConversation[] = [];
  for (const conv of conversations) {
    if (!conv || typeof conv !== 'object' || !conv.mapping) continue;
    const messages: ParsedMessage[] = [];
    let nodeId: string | null = conv.current_node;
    while (nodeId) {
      const node: ExportNode | undefined = conv.mapping[nodeId];
      if (!node) break;
      const text = nodeText(node);
      const role = node.message?.author.role;
      if (text && role && role !== 'system' && role !== 'tool') {
        messages.push({ role, content: text });
      }
      nodeId = node.parent;
    }
    messages.reverse();
    if (messages.length === 0) continue;
    result.push({
      title: conv.title || messages[0].content.slice(0, 80),
      sourceId: conv.conversation_id ?? conv.id ?? null,
      messages,
    });
  }
  return result;
}
