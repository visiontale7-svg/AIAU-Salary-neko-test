'use client';

import { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  type Edge,
  type Node,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';

interface Message {
  id: string;
  role: string;
  content: string;
  position: number;
}

const COL_WIDTH = 380;
const ROW_HEIGHT = 170;
const COLS = 3;

function summarize(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function NodeCard({ data }: { data: { id: string; role: string; summary: string } }) {
  const isUser = data.role === 'user';
  return (
    <div className="w-72 rounded-xl border border-gray-300 bg-white p-3 shadow-sm">
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
      <p className="mb-1 font-mono text-[10px] text-gray-400">{data.id}</p>
      <p className="mb-2 text-sm font-semibold leading-snug">{data.summary}</p>
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
          isUser ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
        }`}
      >
        {isUser ? '用户' : 'GPT'}
      </span>
    </div>
  );
}

const nodeTypes = { card: NodeCard };

export default function ConversationGraph({ messages }: { messages: Message[] }) {
  const { nodes, edges } = useMemo(() => {
    // Serpentine layout: fill rows left-to-right, then right-to-left,
    // so consecutive messages stay visually adjacent.
    const nodes: Node[] = messages.map((m, i) => {
      const row = Math.floor(i / COLS);
      const colInRow = i % COLS;
      const col = row % 2 === 0 ? colInRow : COLS - 1 - colInRow;
      return {
        id: m.id,
        type: 'card',
        position: { x: col * COL_WIDTH, y: row * ROW_HEIGHT },
        data: { id: m.id.slice(0, 8), role: m.role, summary: summarize(m.content) },
      };
    });
    const edges: Edge[] = messages.slice(1).map((m, i) => ({
      id: `e-${i}`,
      source: messages[i].id,
      target: m.id,
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#94a3b8' },
    }));
    return { nodes, edges };
  }, [messages]);

  if (messages.length === 0) {
    return <p className="p-10 text-center text-sm text-gray-400">该对话没有消息</p>;
  }

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.1}>
      <Background gap={16} />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
