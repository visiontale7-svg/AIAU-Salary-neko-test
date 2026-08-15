import Link from 'next/link';
import { adminClient } from '@/lib/supabase';
import ConversationGraph from './graph';
import AnalyzeButton from './analyze-button';
import type { ConversationAnalysis } from '@/lib/analyze';

export const dynamic = 'force-dynamic';

export default async function GraphPage({ params }: { params: { id: string } }) {
  const supabase = adminClient();
  const [{ data: conv }, { data: messages }] = await Promise.all([
    supabase.from('conversations').select('id, title, analysis').eq('id', params.id).single(),
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
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-gray-200 px-6 py-3">
        <Link href={`/conversations/${conv.id}`} className="text-sm text-gray-500 underline">← 返回对话</Link>
        <h1 className="truncate text-sm font-semibold">{conv.title} · 结构图</h1>
        <span className="ml-auto flex items-center gap-2">
          {conv.analysis ? (
            <span className="text-xs text-emerald-600">已语义分析</span>
          ) : (
            <span className="text-xs text-gray-400">启发式布局</span>
          )}
          <AnalyzeButton conversationId={conv.id} hasAnalysis={!!conv.analysis} />
        </span>
      </header>
      <div className="flex-1">
        <ConversationGraph
          messages={messages ?? []}
          analysis={(conv.analysis as ConversationAnalysis | null) ?? null}
        />
      </div>
    </main>
  );
}
