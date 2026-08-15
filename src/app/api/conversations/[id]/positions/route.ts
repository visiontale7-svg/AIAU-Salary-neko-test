import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';

export interface GraphPositions {
  [messageId: string]: { x: number; y: number };
}

function parsePositions(input: unknown): GraphPositions | null {
  if (typeof input !== 'object' || input === null) return null;
  const out: GraphPositions = {};
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) return null;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    out[id] = { x, y };
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const positions = parsePositions((body as { positions?: unknown } | null)?.positions);
  if (!positions) return NextResponse.json({ error: 'invalid positions' }, { status: 400 });

  const { error } = await adminClient()
    .from('conversations')
    .update({ graph_positions: positions })
    .eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: Object.keys(positions).length });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await adminClient()
    .from('conversations')
    .update({ graph_positions: null })
    .eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
