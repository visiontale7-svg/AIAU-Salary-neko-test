'use client';

import { useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
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

const CARD_W = 300;
const CARD_H = 150;
const CLUSTER_SIZE = 6; // messages per topic cluster
const CLUSTER_PAD = 48;

// palette for cluster boxes / dots, mirroring the reference mock
const CLUSTER_COLORS = [
  { border: '#34d399', label: '#059669', fill: 'rgba(52,211,153,0.06)' }, // green
  { border: '#60a5fa', label: '#2563eb', fill: 'rgba(96,165,250,0.06)' }, // blue
  { border: '#fbbf24', label: '#b45309', fill: 'rgba(251,191,36,0.07)' }, // amber
  { border: '#f87171', label: '#dc2626', fill: 'rgba(248,113,113,0.06)' }, // red
  { border: '#a78bfa', label: '#7c3aed', fill: 'rgba(167,139,250,0.07)' }, // violet
];

const EDGE_COLORS = ['#94a3b8', '#93c5fd', '#c4b5fd', '#86efac'];

function summarize(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

// deterministic pseudo-random jitter so layout is stable across renders
function jitter(seed: number, range: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * range;
}

function actionTags(m: Message): string[] {
  const tags: string[] = [];
  if (m.role === 'user') {
    tags.push(/[?？]/.test(m.content) ? '提问' : '请求');
    if (/(制作|生成|整理|检索|修改|添加|删除|调整|帮我)/.test(m.content)) tags.push('任务');
    if (/(不对|不是|错|纠正|改成|撤回)/.test(m.content)) tags.push('纠正');
  } else {
    tags.push('回答');
    if (/(已完成|已添加|完成了|如下|以下是)/.test(m.content)) tags.push('陈述');
    if (/(链接|http|来源|根据)/.test(m.content)) tags.push('证据');
  }
  return tags.slice(0, 2);
}

function MessageNode({ data }: { data: { fullId: string; role: string; summary: string; tags: string[] } }) {
  const isUser = data.role === 'user';
  return (
    <div
      className="rounded-2xl border bg-white p-3.5 shadow-[0_1px_4px_rgba(15,23,42,0.08)]"
      style={{ width: CARD_W, borderColor: '#cbd5e1' }}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !min-w-0 !min-h-0 !h-1 !w-1" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !min-w-0 !min-h-0 !h-1 !w-1" />
      <p className="mb-1.5 break-all font-mono text-[9px] leading-tight text-slate-400">{data.fullId}</p>
      <p className="mb-2.5 text-[13px] font-bold leading-snug text-slate-800">{data.summary}</p>
      <div className="flex items-center">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
            isUser ? 'bg-blue-100 text-blue-600' : 'bg-violet-100 text-violet-600'
          }`}
        >
          {isUser ? '用户' : 'GPT'}
        </span>
        <span className="ml-auto flex gap-1.5">
          {data.tags.map((t) => (
            <span key={t} className="text-[9px] text-slate-400">{t}</span>
          ))}
        </span>
      </div>
    </div>
  );
}

function ClusterNode({ data }: { data: { label: string; color: (typeof CLUSTER_COLORS)[0]; w: number; h: number } }) {
  return (
    <div
      className="rounded-3xl border-2 border-dashed"
      style={{ width: data.w, height: data.h, borderColor: data.color.border, background: data.color.fill }}
    >
      <div
        className="absolute -top-4 left-6 flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-[11px] font-semibold shadow-sm"
        style={{ borderColor: '#e2e8f0', color: '#334155' }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: data.color.label }} />
        {data.label}
      </div>
    </div>
  );
}

const nodeTypes = { message: MessageNode, cluster: ClusterNode };

export default function ConversationGraph({ messages }: { messages: Message[] }) {
  const { nodes, edges } = useMemo(() => {
    const messageNodes: Node[] = [];
    const clusterNodes: Node[] = [];
    const edges: Edge[] = [];
    const clusterCount = Math.ceil(messages.length / CLUSTER_SIZE);

    // stagger clusters diagonally with jitter so the flow feels organic
    let cursorY = 0;
    const clusterOrigins: { x: number; y: number }[] = [];
    for (let c = 0; c < clusterCount; c++) {
      const x = (c % 2 === 0 ? 0 : 520) + jitter(c * 7 + 1, 120);
      clusterOrigins.push({ x, y: cursorY });
      const rows = Math.ceil(Math.min(CLUSTER_SIZE, messages.length - c * CLUSTER_SIZE) / 2);
      cursorY += rows * (CARD_H + 60) + 180 + jitter(c * 13 + 5, 40);
    }

    messages.forEach((m, i) => {
      const c = Math.floor(i / CLUSTER_SIZE);
      const j = i % CLUSTER_SIZE;
      const col = j % 2;
      const row = Math.floor(j / 2);
      const origin = clusterOrigins[c];
      messageNodes.push({
        id: m.id,
        type: 'message',
        position: {
          x: origin.x + CLUSTER_PAD + col * (CARD_W + 90) + jitter(i * 3 + 2, 36),
          y: origin.y + CLUSTER_PAD + 12 + row * (CARD_H + 58) + jitter(i * 5 + 3, 22),
        },
        data: { fullId: m.id, role: m.role, summary: summarize(m.content), tags: actionTags(m) },
        zIndex: 1,
      });
    });

    // cluster boxes sized to their nodes
    for (let c = 0; c < clusterCount; c++) {
      const members = messageNodes.filter((_, i) => Math.floor(i / CLUSTER_SIZE) === c);
      if (members.length === 0) continue;
      const minX = Math.min(...members.map((n) => n.position.x));
      const minY = Math.min(...members.map((n) => n.position.y));
      const maxX = Math.max(...members.map((n) => n.position.x + CARD_W));
      const maxY = Math.max(...members.map((n) => n.position.y + CARD_H));
      const color = CLUSTER_COLORS[c % CLUSTER_COLORS.length];
      const firstUser = messages
        .slice(c * CLUSTER_SIZE, (c + 1) * CLUSTER_SIZE)
        .find((m) => m.role === 'user');
      clusterNodes.push({
        id: `cluster-${c}`,
        type: 'cluster',
        position: { x: minX - CLUSTER_PAD, y: minY - CLUSTER_PAD },
        data: {
          label: firstUser ? summarize(firstUser.content, 16) : `话题 ${c + 1}`,
          color,
          w: maxX - minX + CLUSTER_PAD * 2,
          h: maxY - minY + CLUSTER_PAD * 2,
        },
        selectable: false,
        draggable: false,
        zIndex: 0,
      });
    }

    messages.slice(1).forEach((m, i) => {
      const prev = messages[i];
      const crossCluster = Math.floor(i / CLUSTER_SIZE) !== Math.floor((i + 1) / CLUSTER_SIZE);
      const color = crossCluster ? '#f8a29a' : EDGE_COLORS[(i * 7) % EDGE_COLORS.length];
      const labelled = prev.role === 'user' && (crossCluster || i % 3 === 0);
      edges.push({
        id: `e-${i}`,
        source: prev.id,
        target: m.id,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: crossCluster ? 2 : 1.5 },
        label: labelled ? summarize(prev.content, 14) : undefined,
        labelBgStyle: { fill: '#ffffff', stroke: '#e2e8f0' },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 8,
        labelStyle: { fontSize: 10, fill: '#475569', fontWeight: 600 },
        zIndex: 2,
      });
    });

    return { nodes: [...clusterNodes, ...messageNodes], edges };
  }, [messages]);

  if (messages.length === 0) {
    return <p className="p-10 text-center text-sm text-gray-400">该对话没有消息</p>;
  }

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.05} style={{ background: '#f6f8fb' }}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#d3dbe6" />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
