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
        className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? '分析中…' : hasAnalysis ? '重新语义分析' : '语义分析'}
      </button>
    </span>
  );
}
