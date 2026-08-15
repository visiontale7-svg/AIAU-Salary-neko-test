'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { browserClient } from '@/lib/supabase';

interface Card {
  id: string;
  conversation_id: string | null;
  title: string;
  card_type: string;
  content: string;
  tags: string[];
  created_at: string;
  similarity?: number;
}

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  insight: { label: '灵感', cls: 'bg-amber-100 text-amber-800' },
  decision: { label: '决策', cls: 'bg-emerald-100 text-emerald-800' },
  tradeoff: { label: '权衡', cls: 'bg-sky-100 text-sky-800' },
  rejected: { label: '已否决', cls: 'bg-rose-100 text-rose-800' },
};

export default function Home() {
  const [cards, setCards] = useState<Card[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [isSearchResult, setIsSearchResult] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const supabase = useRef(browserClient()).current;

  const loadLatest = useCallback(async () => {
    const { data } = await supabase
      .from('knowledge_cards')
      .select('id, conversation_id, title, card_type, content, tags, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    setCards(data ?? []);
    setIsSearchResult(false);
  }, [supabase]);

  useEffect(() => {
    loadLatest();
    const channel = supabase
      .channel('cards-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'knowledge_cards' },
        () => loadLatest()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, loadLatest]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      loadLatest();
      return;
    }
    setSearching(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setCards(data.results ?? []);
      setIsSearchResult(true);
    } finally {
      setSearching(false);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    setStatus('正在导入并提炼知识卡片（可能需要几分钟）…');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/import', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok) {
        setStatus(`导入 ${data.imported} 个对话（跳过重复 ${data.skipped} 个），生成 ${data.cards} 张知识卡片`);
        loadLatest();
      } else {
        setStatus(`导入失败: ${data.error}`);
      }
    } catch (err) {
      setStatus(`导入失败: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">团队 LLM 知识库</h1>
          <p className="text-sm text-gray-500">导入 ChatGPT 对话，自动提炼可搜索的团队知识卡片</p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {importing ? '导入中…' : '导入 conversations.json'}
          </button>
        </div>
      </header>

      {status && <p className="mb-4 rounded bg-gray-100 px-3 py-2 text-sm">{status}</p>}

      <form onSubmit={handleSearch} className="mb-6 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="语义搜索：比如“三周前聊过的缓存方案”"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-black focus:outline-none"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {searching ? '搜索中…' : '搜索'}
        </button>
        {isSearchResult && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              loadLatest();
            }}
            className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-black"
          >
            清除
          </button>
        )}
      </form>

      {cards.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">
          {isSearchResult ? '没有匹配的知识卡片' : '还没有知识卡片，先导入一份 ChatGPT 导出文件吧'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.map((c) => {
            const t = TYPE_LABEL[c.card_type] ?? TYPE_LABEL.insight;
            return (
              <div key={c.id} className="rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.cls}`}>{t.label}</span>
                  {typeof c.similarity === 'number' && (
                    <span className="text-xs text-gray-400">{(c.similarity * 100).toFixed(0)}% 匹配</span>
                  )}
                </div>
                <h2 className="mb-1 font-semibold">{c.title}</h2>
                <p className="mb-3 whitespace-pre-wrap text-sm text-gray-700">{c.content}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  {c.tags?.map((tag) => (
                    <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5">#{tag}</span>
                  ))}
                  {c.conversation_id && (
                    <Link href={`/conversations/${c.conversation_id}`} className="ml-auto underline hover:text-black">
                      查看原对话
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
