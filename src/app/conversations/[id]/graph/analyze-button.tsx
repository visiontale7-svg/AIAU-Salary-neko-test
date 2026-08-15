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
        className="rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 shadow-[0_0_18px_rgba(56,189,248,0.35)] transition hover:shadow-[0_0_26px_rgba(168,85,247,0.5)] disabled:opacity-50"
      >
        {loading ? '分析中…' : hasAnalysis ? '重新语义分析' : '语义分析'}
      </button>
    </span>
  );
}
