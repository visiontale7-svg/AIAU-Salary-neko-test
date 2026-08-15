'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  useViewport,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ConversationAnalysis } from '@/lib/analyze';
import { browserClient } from '@/lib/supabase';

interface Message {
  id: string;
  role: string;
  content: string;
  position: number;
}

export interface GraphPositions {
  [messageId: string]: { x: number; y: number };
}

const CARD_W = 300;
const CARD_H = 150;
const CLUSTER_SIZE = 6; // messages per topic cluster when no semantic analysis
const CLUSTER_PAD = 48;

// neon palette for cluster boxes / dots on the dark canvas
const CLUSTER_COLORS = [
  { stroke: '#34d399', glow: 'rgba(52,211,153,0.55)', fill: 'rgba(16,185,129,0.06)' },
  { stroke: '#38bdf8', glow: 'rgba(56,189,248,0.55)', fill: 'rgba(14,165,233,0.06)' },
  { stroke: '#fbbf24', glow: 'rgba(251,191,36,0.5)', fill: 'rgba(245,158,11,0.06)' },
  { stroke: '#fb7185', glow: 'rgba(251,113,133,0.5)', fill: 'rgba(244,63,94,0.06)' },
  { stroke: '#a78bfa', glow: 'rgba(167,139,250,0.55)', fill: 'rgba(139,92,246,0.06)' },
];

const PEER_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#c084fc', '#fb923c'];
const PEER_NAMES = ['星尘', '夜航', '拾光', '回声', '溯洄', '微光'];

function summarize(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

// deterministic pseudo-random jitter so the generated layout is stable
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

interface MessageNodeData {
  fullId: string;
  role: string;
  summary: string;
  tags: string[];
  index: number;
  dim: boolean;
  active: boolean;
}

function MessageNode({ data }: { data: MessageNodeData }) {
  const isUser = data.role === 'user';
  const accent = isUser ? '#22d3ee' : '#c084fc';
  const glow = isUser ? 'rgba(34,211,238,' : 'rgba(192,132,252,';
  return (
    <div
      className="graph-node-in group relative overflow-hidden rounded-2xl px-4 py-3 backdrop-blur-md transition-[opacity,transform,box-shadow] duration-300"
      style={{
        width: CARD_W,
        animationDelay: `${Math.min(data.index * 45, 1400)}ms`,
        opacity: data.dim ? 0.18 : 1,
        transform: data.active ? 'scale(1.035)' : 'scale(1)',
        background:
          'linear-gradient(155deg, rgba(30,41,59,0.94) 0%, rgba(15,23,42,0.96) 60%, rgba(2,6,23,0.96) 100%)',
        border: `1px solid ${glow}${data.active ? '0.85' : '0.32'})`,
        boxShadow: data.active
          ? `0 0 0 1px ${glow}0.5), 0 18px 46px rgba(2,6,23,0.85), 0 0 48px ${glow}0.45)`
          : `0 10px 30px rgba(2,6,23,0.6), 0 0 22px ${glow}0.14)`,
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, ${accent}, transparent)` }}
      />
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded-md px-1.5 py-[2px] text-[10px] font-bold tracking-wide"
          style={{ color: accent, background: `${glow}0.12)`, border: `1px solid ${glow}0.3)` }}
        >
          {isUser ? 'USER' : 'GPT'}
        </span>
        <span className="truncate font-mono text-[9px] tracking-tight text-slate-500">{data.fullId}</span>
      </div>
      <p className="mb-3 text-[15px] font-semibold leading-snug text-slate-50">{data.summary}</p>
      <div className="flex flex-wrap gap-1.5">
        {data.tags.map((t) => (
          <span
            key={t}
            className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-[2px] text-[9px] font-medium text-slate-300"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

interface ClusterNodeData {
  label: string;
  color: (typeof CLUSTER_COLORS)[number];
  w: number;
  h: number;
  dim: boolean;
}

function ClusterNode({ data }: { data: ClusterNodeData }) {
  return (
    <div
      className="rounded-[30px] border-[1.5px] border-dashed transition-opacity duration-300"
      style={{
        width: data.w,
        height: data.h,
        borderColor: data.color.stroke,
        background: data.color.fill,
        boxShadow: `inset 0 0 60px ${data.color.fill}, 0 0 26px ${data.color.glow}`,
        opacity: data.dim ? 0.25 : 0.85,
      }}
    >
      <div
        className="absolute -top-[14px] left-7 flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide backdrop-blur"
        style={{
          color: data.color.stroke,
          background: 'rgba(2,6,23,0.85)',
          border: `1px solid ${data.color.stroke}`,
          boxShadow: `0 0 18px ${data.color.glow}`,
        }}
      >
        <span
          className="graph-pulse h-1.5 w-1.5 rounded-full"
          style={{ background: data.color.stroke, boxShadow: `0 0 10px ${data.color.stroke}` }}
        />
        {data.label}
      </div>
    </div>
  );
}

interface Rect { x: number; y: number; w: number; h: number }

function labelClearOfCards(x: number, y: number, rects: Rect[]): boolean {
  const hw = 60;
  const hh = 14;
  return !rects.some((r) => x + hw > r.x && x - hw < r.x + r.w && y + hh > r.y && y - hh < r.y + r.h);
}

// semantic edge: glowing animated stroke + collision-aware label along the curve
function SemanticEdge(props: EdgeProps<{ label?: string; color: string; rects?: Rect[]; dim?: boolean }>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data } = props;
  const [path, midX, midY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  let lx = midX;
  let ly = midY;
  const rects = data?.rects ?? [];
  outer: for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
    for (const off of [0, 30, -30, 55, -55]) {
      const cx = sourceX + dx * t + px * off;
      const cy = sourceY + dy * t + py * off;
      if (labelClearOfCards(cx, cy, rects)) {
        lx = cx;
        ly = cy;
        break outer;
      }
    }
  }
  const color = data?.color ?? '#a855f7';
  return (
    <>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        style={{ opacity: (data?.dim ? 0.04 : 0.18), filter: 'blur(4px)' }}
      />
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-full px-2 py-[2px] text-[10px] font-semibold backdrop-blur transition-opacity duration-300"
            style={{
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              color,
              background: 'rgba(2,6,23,0.85)',
              border: `1px solid ${color}`,
              boxShadow: `0 0 14px ${color}55`,
              opacity: data.dim ? 0.12 : 1,
              zIndex: 10,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { message: MessageNode, cluster: ClusterNode };
const edgeTypes = { semantic: SemanticEdge };

interface Peer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  at: number;
}

/** Remote cursors, drawn in flow space and transformed with the viewport. */
function CursorLayer({ peers }: { peers: Peer[] }) {
  const { x, y, zoom } = useViewport();
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {peers.map((p) => (
        <div
          key={p.id}
          className="absolute transition-transform duration-100 ease-linear"
          style={{ transform: `translate(${p.x * zoom + x}px, ${p.y * zoom + y}px)` }}
        >
          <svg width="18" height="24" viewBox="0 0 18 24" style={{ filter: `drop-shadow(0 0 6px ${p.color})` }}>
            <path d="M2 1 L2 19 L7 14 L11 22 L15 20 L11 12 L17 11 Z" fill={p.color} stroke="#020617" strokeWidth="1" />
          </svg>
          <span
            className="ml-3 whitespace-nowrap rounded-full px-2 py-[2px] text-[10px] font-semibold text-slate-900"
            style={{ background: p.color, boxShadow: `0 0 12px ${p.color}` }}
          >
            {p.name}
          </span>
        </div>
      ))}
    </div>
  );
}

function GraphInner({
  conversationId,
  messages,
  analysis,
  savedPositions,
}: {
  conversationId: string;
  messages: Message[];
  analysis: ConversationAnalysis | null;
  savedPositions: GraphPositions | null;
}) {
  const base = useMemo(() => {
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
      sorted.forEach((c, ci) =>
        c.message_indices.forEach((i) => {
          if (i >= 0 && i < messages.length && clusterOf[i] === -1) clusterOf[i] = ci;
        })
      );
      clusterLabels = sorted.map((c) => c.label);
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

    const clusterSizes = new Array(clusterCount).fill(0);
    clusterOf.forEach((c) => clusterSizes[c]++);
    const cardColsOf = clusterSizes.map((s: number) => (s > 8 ? 3 : s > 2 ? 2 : Math.max(1, s)));
    const maxClusterW = CLUSTER_PAD * 2 + 3 * CARD_W + 2 * 90;
    const gridCols = Math.max(2, Math.round(Math.sqrt(clusterCount * 1.6)));
    const colY: number[] = new Array(gridCols).fill(0);
    const clusterOrigins: { x: number; y: number }[] = new Array(clusterCount);
    const heightOf = (c: number) =>
      CLUSTER_PAD * 2 + Math.max(1, Math.ceil(clusterSizes[c] / cardColsOf[c])) * (CARD_H + 58);
    const order = Array.from({ length: clusterCount }, (_, c) => c).sort((a, b) => heightOf(b) - heightOf(a));
    for (const c of order) {
      const gc = colY.indexOf(Math.min(...colY));
      clusterOrigins[c] = {
        x: gc * (maxClusterW - 60) + jitter(c * 7 + 1, 170),
        y: colY[gc] + jitter(c * 13 + 5, 110),
      };
      colY[gc] += heightOf(c) + 60 + jitter(c * 3 + 9, 60);
    }

    const posInCluster: number[] = new Array(messages.length).fill(0);
    const counters: number[] = new Array(clusterCount).fill(0);
    for (let i = 0; i < messages.length; i++) posInCluster[i] = counters[clusterOf[i]]++;

    messages.forEach((m, i) => {
      const c = clusterOf[i];
      const j = posInCluster[i];
      const cols = cardColsOf[c];
      const col = j % cols;
      const row = Math.floor(j / cols);
      const origin = clusterOrigins[c];
      const generated = {
        x: origin.x + CLUSTER_PAD + col * (CARD_W + 110) + (row % 2 === 1 ? 70 : 0) + jitter(i * 3 + 2, 85),
        y: origin.y + CLUSTER_PAD + 12 + row * (CARD_H + 70) + (col % 2 === 1 ? 45 : 0) + jitter(i * 5 + 3, 48),
      };
      messageNodes.push({
        id: m.id,
        type: 'message',
        position: savedPositions?.[m.id] ?? generated,
        data: {
          fullId: m.id,
          role: m.role,
          summary: titleOf.get(i) ?? summarize(m.content),
          tags: tagsOf.get(i) ?? actionTags(m),
          index: i,
          dim: false,
          active: false,
        },
        zIndex: 1,
      });
    });

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
          label: clusterLabels[c] ?? (firstUser ? summarize(firstUser.content, 16) : `话题 ${c + 1}`),
          color,
          w: maxX - minX + CLUSTER_PAD * 2,
          h: maxY - minY + CLUSTER_PAD * 2,
          dim: false,
        },
        selectable: false,
        draggable: false,
        zIndex: 0,
      });
    }

    const cardRects: Rect[] = messageNodes.map((n) => ({ x: n.position.x, y: n.position.y, w: CARD_W, h: CARD_H }));

    const flowLabelOf = new Map<number, string>();
    analysis?.edges.forEach((e, k) => {
      if (e.kind === 'flow') {
        if (e.label && e.target === e.source + 1) flowLabelOf.set(e.source, e.label);
        return;
      }
      const correction = e.kind === 'correction';
      const color = correction ? '#fb7185' : '#c084fc';
      edges.push({
        id: `sem-${k}`,
        source: messages[e.source].id,
        target: messages[e.target].id,
        type: 'semantic',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 2 },
        data: { label: e.label, color, rects: cardRects },
        zIndex: 3,
      });
    });

    messages.slice(1).forEach((m, i) => {
      const prev = messages[i];
      const crossCluster = clusterOf[i] !== clusterOf[i + 1];
      const color = crossCluster ? '#f0abfc' : '#334f6d';
      const semLabel = flowLabelOf.get(i);
      const labelled = semLabel != null || (!analysis && prev.role === 'user' && (crossCluster || i % 3 === 0));
      edges.push({
        id: `e-${i}`,
        source: prev.id,
        target: m.id,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: crossCluster ? 2 : 1.4 },
        label: labelled ? semLabel ?? summarize(prev.content, 14) : undefined,
        labelBgStyle: { fill: '#020617', stroke: '#1e293b' },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 8,
        labelStyle: { fontSize: 10, fill: '#94a3b8', fontWeight: 600 },
        zIndex: 2,
      });
    });

    return { nodes: [...clusterNodes, ...messageNodes], edges };
  }, [messages, analysis, savedPositions]);

  const [nodes, setNodes] = useState<Node[]>(base.nodes);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [saving, setSaving] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorAt = useRef(0);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const me = useMemo(() => {
    const n = Math.floor(Math.random() * PEER_NAMES.length);
    return {
      id: Math.random().toString(36).slice(2, 9),
      name: PEER_NAMES[n],
      color: PEER_COLORS[n % PEER_COLORS.length],
    };
  }, []);

  useEffect(() => setNodes(base.nodes), [base.nodes]);

  // realtime channel: peer cursors + live node movement
  useEffect(() => {
    const sb = browserClient();
    const ch = sb.channel(`graph:${conversationId}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const p = payload as Omit<Peer, 'at'>;
      setPeers((prev) => [...prev.filter((q) => q.id !== p.id), { ...p, at: Date.now() }]);
    });
    ch.on('broadcast', { event: 'move' }, ({ payload }) => {
      const { id, x, y } = payload as { id: string; x: number; y: number };
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, position: { x, y } } : n)));
    });
    ch.subscribe();
    channelRef.current = ch;
    const prune = setInterval(
      () => setPeers((prev) => prev.filter((p) => Date.now() - p.at < 8000)),
      2000
    );
    return () => {
      clearInterval(prune);
      sb.removeChannel(ch);
      channelRef.current = null;
    };
  }, [conversationId]);

  const persist = useCallback(
    (next: Node[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const positions: GraphPositions = {};
        next.forEach((n) => {
          if (n.type === 'message') positions[n.id] = { x: n.position.x, y: n.position.y };
        });
        setSaving(true);
        await fetch(`/api/conversations/${conversationId}/positions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positions }),
        }).catch(() => {});
        setSaving(false);
      }, 700);
    },
    [conversationId]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((prev) => {
        const next = applyNodeChanges(changes, prev);
        if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
          persist(next);
          changes.forEach((c) => {
            if (c.type === 'position' && c.dragging === false) {
              const moved = next.find((n) => n.id === c.id);
              if (moved) {
                channelRef.current?.send({
                  type: 'broadcast',
                  event: 'move',
                  payload: { id: moved.id, x: moved.position.x, y: moved.position.y },
                });
              }
            }
          });
        }
        return next;
      });
    },
    [persist]
  );

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    base.edges.forEach((e) => {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    });
    return map;
  }, [base.edges]);

  const related = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    neighbours.get(focusId)?.forEach((n) => set.add(n));
    return set;
  }, [focusId, neighbours]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const dim = related != null && n.type === 'message' && !related.has(n.id);
        const active = focusId === n.id;
        if (n.data.dim === dim && n.data.active === active && !(n.type === 'cluster' && related != null))
          return n;
        return {
          ...n,
          data: { ...n.data, dim: n.type === 'cluster' ? related != null : dim, active },
        };
      }),
    [nodes, related, focusId]
  );

  const displayEdges = useMemo(
    () =>
      base.edges.map((e) => {
        const on = related == null || (related.has(e.source) && related.has(e.target));
        return {
          ...e,
          style: { ...e.style, opacity: on ? 1 : 0.06 },
          data: e.data ? { ...e.data, dim: !on } : e.data,
          animated: e.animated && on,
        };
      }),
    [base.edges, related]
  );

  const onNodeEnter: NodeMouseHandler = useCallback((_, node) => {
    if (node.type === 'message') setFocusId(node.id);
  }, []);
  const onNodeLeave: NodeMouseHandler = useCallback(() => setFocusId(null), []);
  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const m = messages.find((x) => x.id === node.id);
      if (m) setSelected(m);
    },
    [messages]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const now = Date.now();
      if (now - cursorAt.current < 60 || !wrapper.current || !channelRef.current) return;
      cursorAt.current = now;
      const rect = wrapper.current.getBoundingClientRect();
      const vp = wrapper.current.querySelector<HTMLElement>('.react-flow__viewport');
      const m = vp ? new DOMMatrixReadOnly(getComputedStyle(vp).transform) : null;
      const zoom = m?.a || 1;
      const x = ((e.clientX - rect.left) - (m?.e ?? 0)) / zoom;
      const y = ((e.clientY - rect.top) - (m?.f ?? 0)) / zoom;
      channelRef.current.send({
        type: 'broadcast',
        event: 'cursor',
        payload: { id: me.id, name: me.name, color: me.color, x, y },
      });
    },
    [me]
  );

  const resetLayout = useCallback(async () => {
    await fetch(`/api/conversations/${conversationId}/positions`, { method: 'DELETE' }).catch(() => {});
    window.location.reload();
  }, [conversationId]);

  if (messages.length === 0) {
    return <p className="p-10 text-center text-sm text-slate-500">该对话没有消息</p>;
  }

  return (
    <div ref={wrapper} className="relative h-full w-full" onMouseMove={onMouseMove}>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeMouseEnter={onNodeEnter}
        onNodeMouseLeave={onNodeLeave}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelected(null)}
        fitView
        minZoom={0.05}
        proOptions={{ hideAttribution: false }}
        className="graph-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color="#1e3a5f" />
        <Controls className="graph-controls" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(2,6,23,0.75)"
          nodeColor={(n) => (n.type === 'cluster' ? 'transparent' : n.data?.role === 'user' ? '#22d3ee' : '#c084fc')}
          style={{ background: 'rgba(2,6,23,0.9)', border: '1px solid #1e293b', borderRadius: 12 }}
        />
        <CursorLayer peers={peers} />
      </ReactFlow>

      <div className="pointer-events-none absolute left-4 top-4 z-30 flex flex-col gap-2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-slate-950/80 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />用户
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shadow-[0_0_8px_#c084fc]" />GPT
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 bg-purple-400" />语义引用
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 bg-rose-400" />纠正
          </span>
          <button
            onClick={resetLayout}
            className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-cyan-400/60 hover:text-cyan-300"
          >
            整理布局
          </button>
          <span className="text-[10px] text-slate-500">
            {saving ? '保存位置…' : `在线 ${peers.length + 1}`}
          </span>
        </div>
      </div>

      {selected && (
        <aside className="graph-panel-in absolute right-0 top-0 z-30 flex h-full w-[380px] flex-col border-l border-white/10 bg-slate-950/92 backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <span
              className="rounded-md px-1.5 py-[2px] text-[10px] font-bold"
              style={{
                color: selected.role === 'user' ? '#22d3ee' : '#c084fc',
                border: `1px solid ${selected.role === 'user' ? '#22d3ee55' : '#c084fc55'}`,
              }}
            >
              {selected.role === 'user' ? 'USER' : 'GPT'}
            </span>
            <span className="text-[11px] text-slate-400">#{selected.position + 1} 原文</span>
            <button
              onClick={() => setSelected(null)}
              className="ml-auto rounded px-2 text-slate-400 transition hover:text-slate-100"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto px-4 py-4">
            <p className="mb-3 break-all font-mono text-[9px] text-slate-600">{selected.id}</p>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-200">{selected.content}</p>
          </div>
        </aside>
      )}
    </div>
  );
}

export default function ConversationGraph(props: {
  conversationId: string;
  messages: Message[];
  analysis: ConversationAnalysis | null;
  savedPositions: GraphPositions | null;
}) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
