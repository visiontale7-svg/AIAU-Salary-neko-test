import OpenAI from 'openai';

export interface AnalysisMessage {
  index: number;
  title: string;
  tags: string[];
}

export interface AnalysisCluster {
  label: string;
  message_indices: number[];
}

export interface AnalysisEdge {
  source: number;
  target: number;
  label?: string;
  kind: 'flow' | 'reference' | 'correction';
}

export interface ConversationAnalysis {
  messages: AnalysisMessage[];
  clusters: AnalysisCluster[];
  edges: AnalysisEdge[];
}

let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-5.6-luna';

const SYSTEM_PROMPT = `你是一个对话结构分析器。输入是一段编号的用户与AI的对话，输出 JSON，用于绘制对话结构图。
要求：
1. messages: 为每条消息生成一个精炼标题（≤20字，概括该消息做了什么）和1-3个动作标签。标签词汇：请求/提问/回答/陈述/任务/证据/纠正/撤回/约束/解释/承接/假设检验/建议/确认/其他。
2. clusters: 把消息按语义主题分组（每组给一个≤18字的主题短语，如"核对时间、通知与公开资料证据"）。每条消息只属于一个组，组内消息不必连续但通常连续。
3. edges: 消息间的关系边。必须包含相邻消息的顺序边(kind="flow")；另外识别非相邻的语义引用（某消息回应/引用/纠正更早的消息）输出 kind="reference" 或 kind="correction"，并给这些边一个≤14字的关系标签(label)。flow 边可选标签。
输出格式：
{"messages":[{"index":0,"title":"...","tags":["..."]}],"clusters":[{"label":"...","message_indices":[0,1]}],"edges":[{"source":0,"target":1,"kind":"flow"},{"source":5,"target":2,"kind":"correction","label":"撤回制作网页的请求"}]}
只输出 JSON。`;

export async function analyzeConversation(
  title: string,
  messages: { role: string; content: string }[]
): Promise<ConversationAnalysis> {
  const transcript = messages
    .map((m, i) => `[${i}] ${m.role === 'user' ? '用户' : 'AI'}: ${m.content.replace(/\s+/g, ' ').slice(0, 800)}`)
    .join('\n')
    .slice(0, 60000);
  const res = await openaiClient().chat.completions.create({
    model: ANALYSIS_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `对话标题: ${title}\n\n${transcript}` },
    ],
  });
  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  const n = messages.length;
  const valid = (i: unknown): i is number => typeof i === 'number' && i >= 0 && i < n;
  const analysis: ConversationAnalysis = {
    messages: Array.isArray(parsed.messages)
      ? parsed.messages.filter((m: AnalysisMessage) => valid(m?.index) && typeof m?.title === 'string')
      : [],
    clusters: Array.isArray(parsed.clusters)
      ? parsed.clusters.filter(
          (c: AnalysisCluster) => typeof c?.label === 'string' && Array.isArray(c?.message_indices)
        )
      : [],
    edges: Array.isArray(parsed.edges)
      ? parsed.edges.filter((e: AnalysisEdge) => valid(e?.source) && valid(e?.target))
      : [],
  };
  if (analysis.messages.length === 0 || analysis.clusters.length === 0) {
    throw new Error('analysis result incomplete');
  }
  return analysis;
}
