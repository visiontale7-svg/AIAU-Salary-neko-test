import OpenAI from 'openai';
import type { ParsedMessage } from './chatgpt';

export interface ExtractedCard {
  title: string;
  card_type: 'insight' | 'decision' | 'tradeoff' | 'rejected';
  content: string;
  tags: string[];
}

let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SYSTEM_PROMPT = `你是一个团队知识提炼助手。从一段用户与 LLM 的对话中提取高价值知识片段，输出 JSON。
只提取真正有沉淀价值的内容：
- insight: 灵光一闪的想法、洞察
- decision: 做出的决策及理由
- tradeoff: 方案权衡分析
- rejected: 被否掉的方向及原因
每张卡片要自包含（脱离对话也能看懂），content 用中文（若对话为中文），控制在 200 字内。
输出格式: {"cards": [{"title": "...", "card_type": "insight|decision|tradeoff|rejected", "content": "...", "tags": ["..."]}]}
若无值得提取的内容，输出 {"cards": []}。`;

export async function extractCards(
  title: string,
  messages: ParsedMessage[]
): Promise<ExtractedCard[]> {
  const transcript = messages
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
    .join('\n\n')
    .slice(0, 48000);
  const res = await openaiClient().chat.completions.create({
    model: process.env.EXTRACTION_MODEL || 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `对话标题: ${title}\n\n${transcript}` },
    ],
  });
  try {
    const parsed = JSON.parse(res.choices[0].message.content || '{}');
    return Array.isArray(parsed.cards) ? parsed.cards : [];
  } catch {
    return [];
  }
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openaiClient().embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}
