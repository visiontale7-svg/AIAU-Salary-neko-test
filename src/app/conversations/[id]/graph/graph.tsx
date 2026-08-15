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
import type { ConversationAnalysis } from '@/lib/analyze';

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
  { border: '#6ee7b7', label: '#059669', fill: 'rgba(52,211,153,0.03)' }, // green
  { border: '#93c5fd', label: '#2563eb', fill: 'rgba(96,165,250,0.03)' }, // blue
  { border: '#fcd34d', label: '#b45309', fill: 'rgba(251,191,36,0.035)' }, // amber
  { border: '#fca5a5', label: '#dc2626', fill: 'rgba(248,113,113,0.03)' }, // red
  { border: '#c4b5fd', label: '#7c3aed', fill: 'rgba(167,139,250,0.035)' }, // violet
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
      className="rounded-xl bg-white p-4 shadow-[0_2px_6px_rgba(15,23,42,0.1)]"
      style={{ width: CARD_W, border: '2px solid #232f52' }}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !min-w-0 !min-h-0 !h-1 !w-1" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !min-w-0 !min-h-0 !h-1 !w-1" />
      <p className="mb-2 break-all font-mono text-[10px] leading-tight text-slate-500">{data.fullId}</p>
      <p className="mb-3 text-[15px] font-bold leading-snug text-slate-900">{data.summary}</p>
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
      className="rounded-[28px] border-[1.5px] border-dashed"
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

export default function ConversationGraph({
  messages,
  analysis,
}: {
  messages: Message[];
  analysis: ConversationAnalysis | null;
}) {
  const { nodes, edges } = useMemo(() => {
    const messageNodes: Node[] = [];
    const clusterNodes: Node[] = [];
    const edges: Edge[] = [];

    // cluster membership: semantic analysis if available, else fixed-size chunks
    const clusterOf: number[] = new Array(messages.length).fill(-1);
    let clusterLabels: (string | null)[] = [];
    if (analysis) {
      const sorted = [...analysis.clusters].sort(
        (a, b) => Math.min(...a.message_indices) - Math.min(...b.message_indices)
      );
      sorted.forEach((c, ci) => c.message_indices.forEach((i) => {
        if (i >= 0 && i < messages.length && clusterOf[i] === -1) clusterOf[i] = ci;
      }));
      clusterLabels = sorted.map((c) => c.label);
      // any unassigned message joins the previous message's cluster
      for (let i = 0; i < clusterOf.length; i++) {
        if (clusterOf[i] === -1) clusterOf[i] = i > 0 ? clusterOf[i - 1] : 0;
      }
    } else {
      for (let i = 0; i < messages.length; i++) clusterOf[i] = Math.floor(i / CLUSTER_SIZE);
      clusterLabels = new Array(Math.ceil(messages.length / CLUSTER_SIZE)).fill(null);
    }
    const clusterCount = clusterLabels.length;

    const titleOf = new Map<number, string>();
    const tagsOf = new Map<number, string[]>();
    analysis?.messages.forEach((m) => {
      titleOf.set(m.index, m.title);
      if (Array.isArray(m.tags)) tagsOf.set(m.index, m.tags.slice(0, 3));
    });

    // pack clusters into a wide 2D grid so fit-view fills the screen
    const clusterSizes = new Array(clusterCount).fill(0);
    clusterOf.forEach((c) => clusterSizes[c]++);
    const gridCols = Math.max(2, Math.ceil(Math.sqrt(clusterCount * 1.8)));
    const clusterW = CLUSTER_PAD * 2 + CARD_W * 2 + 90;
    const clusterOrigins: { x: number; y: number }[] = [];
    let rowY = 0;
    let rowMaxH = 0;
    for (let c = 0; c < clusterCount; c++) {
      const gc = c % gridCols;
      if (gc === 0 && c > 0) {
        rowY += rowMaxH + 160;
        rowMaxH = 0;
      }
      const rows = Math.max(1, Math.ceil(clusterSizes[c] / 2));
      const h = CLUSTER_PAD * 2 + rows * (CARD_H + 58);
      rowMaxH = Math.max(rowMaxH, h);
      clusterOrigins.push({
        x: gc * (clusterW + 140) + jitter(c * 7 + 1, 60),
        y: rowY + jitter(c * 13 + 5, 50),
      });
    }

    const posInCluster: number[] = new Array(messages.length).fill(0);
    const counters: number[] = new Array(clusterCount).fill(0);
    for (let i = 0; i < messages.length; i++) posInCluster[i] = counters[clusterOf[i]]++;

    messages.forEach((m, i) => {
      const c = clusterOf[i];
      const j = posInCluster[i];
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
        data: {
          fullId: m.id,
          role: m.role,
          summary: titleOf.get(i) ?? summarize(m.content),
          tags: tagsOf.get(i) ?? actionTags(m),
        },
        zIndex: 1,
      });
    });

    // cluster boxes sized to their nodes
    for (let c = 0; c < clusterCount; c++) {
      const members = messageNodes.filter((_, i) => clusterOf[i] === c);
      if (members.length === 0) continue;
      const minX = Math.min(...members.map((n) => n.position.x));
      const minY = Math.min(...members.map((n) => n.position.y));
      const maxX = Math.max(...members.map((n) => n.position.x + CARD_W));
      const maxY = Math.max(...members.map((n) => n.position.y + CARD_H));
      const color = CLUSTER_COLORS[c % CLUSTER_COLORS.length];
      const firstUser = messages.find((m, i) => clusterOf[i] === c && m.role === 'user');
      clusterNodes.push({
        id: `cluster-${c}`,
        type: 'cluster',
        position: { x: minX - CLUSTER_PAD, y: minY - CLUSTER_PAD },
        data: {
          label:
            clusterLabels[c] ??
            (firstUser ? summarize(firstUser.content, 16) : `话题 ${c + 1}`),
          color,
          w: maxX - minX + CLUSTER_PAD * 2,
          h: maxY - minY + CLUSTER_PAD * 2,
        },
        selectable: false,
        draggable: false,
        zIndex: 0,
      });
    }

    // semantic non-linear edges (reference / correction)
    const flowLabelOf = new Map<number, string>();
    analysis?.edges.forEach((e, k) => {
      if (e.kind === 'flow') {
        if (e.label && e.target === e.source + 1) flowLabelOf.set(e.source, e.label);
        return;
      }
      const correction = e.kind === 'correction';
      const color = correction ? '#ef4444' : '#8b5cf6';
      edges.push({
        id: `sem-${k}`,
        source: messages[e.source].id,
        target: messages[e.target].id,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 2 },
        label: e.label,
        labelBgStyle: { fill: '#ffffff', stroke: color },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 8,
        labelStyle: { fontSize: 10, fill: color, fontWeight: 600 },
        zIndex: 3,
      });
    });

    messages.slice(1).forEach((m, i) => {
      const prev = messages[i];
      const crossCluster = clusterOf[i] !== clusterOf[i + 1];
      const color = crossCluster ? '#f8a29a' : EDGE_COLORS[(i * 7) % EDGE_COLORS.length];
      const semLabel = flowLabelOf.get(i);
      const labelled = semLabel != null || (!analysis && prev.role === 'user' && (crossCluster || i % 3 === 0));
      edges.push({
        id: `e-${i}`,
        source: prev.id,
        target: m.id,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: crossCluster ? 2 : 1.5 },
        label: labelled ? (semLabel ?? summarize(prev.content, 14)) : undefined,
        labelBgStyle: { fill: '#ffffff', stroke: '#e2e8f0' },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 8,
        labelStyle: { fontSize: 10, fill: '#475569', fontWeight: 600 },
        zIndex: 2,
      });
    });

    return { nodes: [...clusterNodes, ...messageNodes], edges };
  }, [messages, analysis]);

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
