import Link from 'next/link';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const supabase = adminClient();
  const [{ data: conv }, { data: messages }] = await Promise.all([
    supabase.from('conversations').select('id, title, source, created_at').eq('id', params.id).single(),
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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-gray-500 underline">← 返回知识库</Link>
      <h1 className="mb-6 mt-2 text-xl font-bold">{conv.title}</h1>
      <div className="space-y-4">
        {(messages ?? []).map((m) => (
          <div
            key={m.id}
            className={`rounded-xl p-4 text-sm whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-gray-100' : 'border border-gray-200'
            }`}
          >
            <p className="mb-1 text-xs font-semibold text-gray-400">
              {m.role === 'user' ? '用户' : 'AI'}
            </p>
            {m.content}
          </div>
        ))}
      </div>
    </main>
  );
}
