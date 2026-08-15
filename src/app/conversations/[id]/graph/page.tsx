import Link from 'next/link';
import { adminClient } from '@/lib/supabase';
import ConversationGraph, { type GraphPositions } from './graph';
import AnalyzeButton from './analyze-button';
import type { ConversationAnalysis } from '@/lib/analyze';

export const dynamic = 'force-dynamic';

export default async function GraphPage({ params }: { params: { id: string } }) {
  const supabase = adminClient();
  const [{ data: conv }, { data: messages }] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, title, analysis, graph_positions')
      .eq('id', params.id)
      .single(),
    supabase
      .from('messages')
      .select('id, role, content, position')
      .eq('conversation_id', params.id)
      .order('position'),
  ]);

  if (!conv) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-gray-500">对话不存在</p>
        <Link href="/" className="text-sm underline">返回</Link>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-[#faf7f0]">
      <header className="flex items-center gap-4 border-b-[1.5px] border-[#e3ddcd] bg-[#fffdf7] px-6 py-3">
        <Link href={`/conversations/${conv.id}`} className="text-sm font-semibold text-stone-500 transition hover:text-amber-600">
          ← 返回对话
        </Link>
        <h1 className="truncate text-sm font-bold text-stone-800">
          {conv.title}
          <span className="ml-2 font-medium text-stone-400">· 结构图</span>
        </h1>
        <span className="ml-auto flex items-center gap-3">
          {conv.analysis ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />已语义分析
            </span>
          ) : (
            <span className="text-xs text-stone-400">启发式布局</span>
          )}
          <AnalyzeButton conversationId={conv.id} hasAnalysis={!!conv.analysis} />
        </span>
      </header>
      <div className="flex-1">
        <ConversationGraph
          conversationId={conv.id}
          messages={messages ?? []}
          analysis={(conv.analysis as ConversationAnalysis | null) ?? null}
          savedPositions={(conv.graph_positions as GraphPositions | null) ?? null}
        />
      </div>
    </main>
  );
}
