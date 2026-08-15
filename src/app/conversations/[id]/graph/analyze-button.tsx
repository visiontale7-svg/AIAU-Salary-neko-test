'use client';

import { useState } from 'react';

export default function AnalyzeButton({
  conversationId,
  hasAnalysis,
}: {
  conversationId: string;
  hasAnalysis: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/analyze`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        window.location.reload();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="max-w-64 truncate text-xs text-rose-500">{error}</span>}
      <button
        onClick={run}
        disabled={loading}
        className="rounded-full border-[1.5px] border-stone-800 bg-[#ffd84d] px-3.5 py-1.5 text-xs font-bold text-stone-900 shadow-[0_3px_0_rgba(41,37,36,0.85)] transition hover:-translate-y-[1px] hover:shadow-[0_4px_0_rgba(41,37,36,0.85)] active:translate-y-[1px] active:shadow-[0_1px_0_rgba(41,37,36,0.85)] disabled:opacity-50"
      >
        {loading ? '分析中…' : hasAnalysis ? '重新语义分析' : '语义分析'}
      </button>
    </span>
  );
}
