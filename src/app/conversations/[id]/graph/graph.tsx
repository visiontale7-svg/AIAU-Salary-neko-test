'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
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

const CARD_W = 264;
const CARD_H = 176;
const CLUSTER_SIZE = 6; // messages per topic cluster when no semantic analysis
const CLUSTER_PAD = 56;

// marker-pen palette for the topic frames
const CLUSTER_COLORS = [
  { stroke: '#0f9d76', tint: 'rgba(16,185,129,0.045)' },
  { stroke: '#2f7fe0', tint: 'rgba(59,130,246,0.045)' },
  { stroke: '#e08a12', tint: 'rgba(245,158,11,0.05)' },
  { stroke: '#e2568c', tint: 'rgba(236,72,153,0.045)' },
  { stroke: '#7c53e0', tint: 'rgba(139,92,246,0.045)' },
];

// sticky-note colours per role
const STICKY = {
  user: {
    from: '#fff59a',
    to: '#ffe873',
    border: '#e6c94f',
    ink: '#7a5c00',
    badgeBg: '#fdf0a8',
  },
  assistant: {
    from: '#cdeeff',
    to: '#b3e2ff',
    border: '#7ec4e8',
    ink: '#0d5c80',
    badgeBg: '#e0f4ff',
  },
};

const PENCIL = '#4b5563';
const REFERENCE = '#8b5cf6';
const CORRECTION = '#ef4444';
const CROSS = '#f59e0b';

const PEER_COLORS = ['#2f7fe0', '#e2568c', '#e08a12', '#0f9d76', '#7c53e0', '#ef4444'];
const PEER_NAMES = ['星尘', '夜航', '拾光', '回声', '溯洄', '微光'];

function summarize(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

// deterministic pseudo-random in [-0.5, 0.5]
function noise(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

function jitter(seed: number, range: number): number {
  return noise(seed) * 2 * range;
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
  excerpt: string;
  tags: string[];
  index: number;
  tilt: number;
  tape: string;
  dim: boolean;
  active: boolean;
}

/** Sticky note. Outer div animates in, inner div carries the paper tilt. */
function MessageNode({ data }: { data: MessageNodeData }) {
  const isUser = data.role === 'user';
  const s = isUser ? STICKY.user : STICKY.assistant;
  return (
    <div
      className="graph-node-in"
      style={{ width: CARD_W, animationDelay: `${Math.min(data.index * 40, 1200)}ms` }}
    >
      <div
        className="relative rounded-[10px] px-4 pb-3 pt-4 transition-[opacity,transform,box-shadow] duration-200"
        style={{
          height: CARD_H,
          background: `linear-gradient(158deg, ${s.from} 0%, ${s.to} 100%)`,
          border: `1px solid ${s.border}`,
          opacity: data.dim ? 0.28 : 1,
          transform: `rotate(${data.tilt}deg) ${data.active ? 'scale(1.05)' : 'scale(1)'}`,
          boxShadow: data.active
            ? '0 18px 34px rgba(30,27,20,0.28), 0 3px 0 rgba(0,0,0,0.08)'
            : '0 8px 18px rgba(30,27,20,0.16), 0 2px 0 rgba(0,0,0,0.06)',
        }}
      >
        <Handle type="target" position={Position.Left} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
        <Handle type="source" position={Position.Right} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
        {/* washi tape in the topic colour */}
        <span
          className="absolute -top-[9px] left-1/2 h-[18px] w-[74px] -translate-x-1/2 rounded-[2px]"
          style={{
            background: data.tape,
            opacity: 0.55,
            transform: `translateX(-50%) rotate(${data.tilt * -2.2}deg)`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          }}
        />
        <div className="mb-2 flex items-center gap-2">
          <span
            className="rounded-full px-2 py-[2px] text-[10px] font-extrabold tracking-wide"
            style={{ color: s.ink, background: s.badgeBg, border: `1px solid ${s.border}` }}
          >
            {isUser ? '我' : 'GPT'}
          </span>
          <span className="text-[10px] font-bold" style={{ color: s.ink, opacity: 0.55 }}>
            #{data.index + 1}
          </span>
        </div>
        <p className="text-[15px] font-bold leading-snug text-[#2b2a24]">{data.summary}</p>
        <p
          className="mt-1.5 overflow-hidden text-[11px] leading-[1.5]"
          style={{
            color: s.ink,
            opacity: 0.75,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3,
          }}
        >
          {data.excerpt}
        </p>
        <div className="absolute inset-x-4 bottom-3 flex items-center gap-1.5">
          {data.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-white/70 px-2 py-[2px] text-[10px] font-semibold"
              style={{ color: s.ink, border: `1px dashed ${s.border}` }}
            >
              {t}
            </span>
          ))}
          <span
            className="ml-auto max-w-[92px] truncate font-mono text-[8px]"
            style={{ color: s.ink, opacity: 0.4 }}
          >
            {data.fullId}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- hand-drawn geometry helpers ----

function bez(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

interface Sketch {
  path: string;
  midX: number;
  midY: number;
  endAngle: number;
}

/** Wobbly stroke between two points — reads as a marker line rather than a vector curve. */
function sketchCurve(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  seed: number,
  amp = 7
): Sketch {
  const d = Math.max(50, Math.abs(tx - sx) / 2);
  const c1x = sx + d;
  const c2x = tx - d;
  const steps = 18;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = bez(t, sx, c1x, c2x, tx);
    const y = bez(t, sy, sy, ty, ty);
    pts.push([x, y]);
  }
  const out: [number, number][] = pts.map(([x, y], i) => {
    const t = i / steps;
    const [px, py] = pts[Math.min(i + 1, steps)];
    const [qx, qy] = pts[Math.max(i - 1, 0)];
    const dx = px - qx;
    const dy = py - qy;
    const len = Math.hypot(dx, dy) || 1;
    const w = noise(seed * 3.7 + i * 5.3) * amp * Math.sin(Math.PI * t);
    return [x + (-dy / len) * w, y + (dx / len) * w];
  });
  const path = out.reduce((acc, [x, y], i) => acc + (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`), '');
  const [ax, ay] = out[steps - 1];
  const [bx, by] = out[steps];
  return {
    path,
    midX: out[Math.floor(steps / 2)][0],
    midY: out[Math.floor(steps / 2)][1],
    endAngle: Math.atan2(by - ay, bx - ax),
  };
}

function sketchSeg(x1: number, y1: number, x2: number, y2: number, seed: number, amp = 3): string {
  const steps = 6;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  let out = '';
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const w = i === steps ? 0 : noise(seed + i * 3.1) * amp;
    out += ` L ${x1 + dx * t + (-dy / len) * w} ${y1 + dy * t + (dx / len) * w}`;
  }
  return out;
}

/** Marker-drawn rounded rectangle. */
function sketchRect(w: number, h: number, r: number, seed: number): string {
  return (
    `M ${r} 0` +
    sketchSeg(r, 0, w - r, 0, seed + 1) +
    ` Q ${w} 0 ${w} ${r}` +
    sketchSeg(w, r, w, h - r, seed + 2) +
    ` Q ${w} ${h} ${w - r} ${h}` +
    sketchSeg(w - r, h, r, h, seed + 3) +
    ` Q 0 ${h} 0 ${h - r}` +
    sketchSeg(0, h - r, 0, r, seed + 4) +
    ` Q 0 0 ${r} 0`
  );
}

interface ClusterNodeData {
  label: string;
  color: (typeof CLUSTER_COLORS)[number];
  w: number;
  h: number;
  seed: number;
  tilt: number;
  dim: boolean;
}

function ClusterNode({ data }: { data: ClusterNodeData }) {
  const path = useMemo(() => sketchRect(data.w, data.h, 34, data.seed), [data.w, data.h, data.seed]);
  return (
    <div
      className="relative transition-opacity duration-300"
      style={{
        width: data.w,
        height: data.h,
        opacity: data.dim ? 0.4 : 1,
        transform: `rotate(${data.tilt}deg)`,
      }}
    >
      <svg width={data.w} height={data.h} className="absolute inset-0 overflow-visible">
        <path d={path} fill={data.color.tint} stroke={data.color.stroke} strokeWidth={2.6} strokeLinecap="round" opacity={0.85} />
        <path
          d={sketchRect(data.w, data.h, 34, data.seed + 40)}
          fill="none"
          stroke={data.color.stroke}
          strokeWidth={1.4}
          strokeLinecap="round"
          opacity={0.4}
        />
      </svg>
      <div
        className="absolute -top-[17px] left-8 flex items-center gap-2 rounded-full px-4 py-[6px] text-[14px] font-extrabold text-white"
        style={{
          background: data.color.stroke,
          boxShadow: '0 4px 12px rgba(30,27,20,0.22)',
          transform: `rotate(${-data.tilt * 1.4}deg)`,
        }}
      >
        {data.label}
      </div>
    </div>
  );
}

interface Rect { x: number; y: number; w: number; h: number }

function labelClearOfCards(x: number, y: number, rects: Rect[]): boolean {
  const hw = 58;
  const hh = 14;
  return !rects.some((r) => x + hw > r.x && x - hw < r.x + r.w && y + hh > r.y && y - hh < r.y + r.h);
}

interface SketchEdgeData {
  label?: string;
  color: string;
  rects?: Rect[];
  dim?: boolean;
  seed: number;
  width: number;
  double?: boolean;
}

/** All edges are hand-drawn: wobbly stroke, sketched arrow head, sticker label. */
function SketchEdge(props: EdgeProps<SketchEdgeData>) {
  const { sourceX, sourceY, targetX, targetY, style, data } = props;
  const seed = data?.seed ?? 1;
  const color = data?.color ?? PENCIL;
  const dim = data?.dim ?? false;
  const main = useMemo(
    () => sketchCurve(sourceX, sourceY, targetX, targetY, seed),
    [sourceX, sourceY, targetX, targetY, seed]
  );
  const ghost = useMemo(
    () => (data?.double ? sketchCurve(sourceX, sourceY, targetX, targetY, seed + 17, 5) : null),
    [data?.double, sourceX, sourceY, targetX, targetY, seed]
  );

  // arrow head drawn as two short marker strokes
  const head = useMemo(() => {
    const a = main.endAngle;
    const l = 13;
    const w1 = a + Math.PI - 0.42 + noise(seed) * 0.16;
    const w2 = a + Math.PI + 0.42 + noise(seed + 2) * 0.16;
    return (
      `M ${targetX + Math.cos(w1) * l} ${targetY + Math.sin(w1) * l} L ${targetX} ${targetY} ` +
      `L ${targetX + Math.cos(w2) * l} ${targetY + Math.sin(w2) * l}`
    );
  }, [main.endAngle, targetX, targetY, seed]);

  let lx = main.midX;
  let ly = main.midY;
  if (data?.label) {
    const rects = data.rects ?? [];
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
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
  }

  return (
    <>
      {ghost && (
        <path
          d={ghost.path}
          fill="none"
          stroke={color}
          strokeWidth={(data?.width ?? 2) * 0.8}
          strokeLinecap="round"
          style={{ opacity: dim ? 0.05 : 0.35, pointerEvents: 'none' }}
        />
      )}
      <BaseEdge path={main.path} style={style} interactionWidth={0} />
      <path
        d={head}
        fill="none"
        stroke={color}
        strokeWidth={(data?.width ?? 2) + 0.4}
        strokeLinecap="round"
        style={{ opacity: dim ? 0.06 : 1, pointerEvents: 'none' }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-full bg-white px-2 py-[2px] text-[10px] font-bold transition-opacity duration-300"
            style={{
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px) rotate(${noise(seed) * 5}deg)`,
              color,
              border: `1.5px solid ${color}`,
              boxShadow: '0 2px 6px rgba(30,27,20,0.14)',
              opacity: dim ? 0.12 : 1,
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
const edgeTypes = { sketch: SketchEdge };

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
          <svg width="18" height="24" viewBox="0 0 18 24" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))' }}>
            <path d="M2 1 L2 19 L7 14 L11 22 L15 20 L11 12 L17 11 Z" fill={p.color} stroke="#ffffff" strokeWidth="1.4" />
          </svg>
          <span
            className="ml-3 whitespace-nowrap rounded-full px-2 py-[2px] text-[10px] font-bold text-white"
            style={{ background: p.color, boxShadow: '0 2px 8px rgba(30,27,20,0.25)' }}
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
    const build = (saved: GraphPositions | null) => {
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
      if (Array.isArray(m.tags)) tagsOf.set(m.index, m.tags.slice(0, 2));
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
        position: saved?.[m.id] ?? generated,
        data: {
          fullId: m.id,
          role: m.role,
          summary: titleOf.get(i) ?? summarize(m.content),
          excerpt: summarize(m.content, 110),
          tags: tagsOf.get(i) ?? actionTags(m),
          index: i,
          tilt: jitter(i * 11 + 7, 2.4),
          tape: CLUSTER_COLORS[c % CLUSTER_COLORS.length].stroke,
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
          seed: c * 9 + 3,
          tilt: jitter(c * 17 + 4, 0.9),
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
      const color = correction ? CORRECTION : REFERENCE;
      edges.push({
        id: `sem-${k}`,
        source: messages[e.source].id,
        target: messages[e.target].id,
        type: 'sketch',
        animated: true,
        style: { stroke: color, strokeWidth: 2.4, strokeLinecap: 'round' },
        data: { label: e.label, color, rects: cardRects, seed: k * 6 + 11, width: 2.4, double: true },
        interactionWidth: 0,
        zIndex: 3,
      });
    });

    messages.slice(1).forEach((m, i) => {
      const prev = messages[i];
      const crossCluster = clusterOf[i] !== clusterOf[i + 1];
      const color = crossCluster ? CROSS : PENCIL;
      const semLabel = flowLabelOf.get(i);
      const labelled = semLabel != null || (!analysis && prev.role === 'user' && (crossCluster || i % 3 === 0));
      const width = crossCluster ? 2.6 : 1.8;
      edges.push({
        id: `e-${i}`,
        source: prev.id,
        target: m.id,
        type: 'sketch',
        style: { stroke: color, strokeWidth: width, strokeLinecap: 'round', opacity: crossCluster ? 0.85 : 0.42 },
        data: {
          label: labelled ? semLabel ?? summarize(prev.content, 14) : undefined,
          color,
          rects: cardRects,
          seed: i * 4 + 2,
          width,
          double: crossCluster,
        },
        interactionWidth: 0,
        zIndex: 2,
      });
    });

    return { nodes: [...clusterNodes, ...messageNodes], edges };
    };

    // keep the generated layout around so 「整理布局」 can restore it client-side
    const current = build(savedPositions);
    return {
      ...current,
      generatedNodes: savedPositions ? build(null).nodes : current.nodes,
    };
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
  const generatedRef = useRef<Node[]>(base.generatedNodes);
  const me = useMemo(() => {
    const n = Math.floor(Math.random() * PEER_NAMES.length);
    return {
      id: Math.random().toString(36).slice(2, 9),
      name: PEER_NAMES[n],
      color: PEER_COLORS[n % PEER_COLORS.length],
    };
  }, []);

  useEffect(() => setNodes(base.nodes), [base.nodes]);
  useEffect(() => {
    generatedRef.current = base.generatedNodes;
  }, [base.generatedNodes]);

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
    ch.on('broadcast', { event: 'reset' }, () => setNodes(generatedRef.current));
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
          style: { ...e.style, opacity: on ? (e.style?.opacity as number | undefined) ?? 1 : 0.06 },
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
      if (m) {
        setFocusId(null);
        setSelected(m);
      }
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

  // restore the generated layout in place; a reload can be served a cached
  // RSC payload that still carries the old saved positions
  const resetLayout = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setNodes(base.generatedNodes);
    channelRef.current?.send({ type: 'broadcast', event: 'reset', payload: {} });
    await fetch(`/api/conversations/${conversationId}/positions`, { method: 'DELETE' }).catch(() => {});
  }, [conversationId, base.generatedNodes]);

  if (messages.length === 0) {
    return <p className="p-10 text-center text-sm text-stone-500">该对话没有消息</p>;
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
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.6} color="#cfc9ba" />
        <Controls className="graph-controls" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(120,113,96,0.16)"
          nodeColor={(n) =>
            n.type === 'cluster' ? 'transparent' : n.data?.role === 'user' ? '#ffe873' : '#b3e2ff'
          }
          nodeStrokeColor="#a8a29e"
          style={{ background: '#fffdf7', border: '1.5px solid #ddd6c7', borderRadius: 14 }}
        />
        <CursorLayer peers={peers} />
      </ReactFlow>

      <div className="absolute left-4 top-4 z-30">
        <div className="flex items-center gap-4 rounded-2xl border-[1.5px] border-[#e3ddcd] bg-white/95 px-4 py-2.5 text-[11px] font-semibold text-stone-600 shadow-[0_6px_18px_rgba(30,27,20,0.12)]">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rotate-[-6deg] rounded-[3px] border border-[#e6c94f] bg-[#ffe873]" />我
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rotate-[5deg] rounded-[3px] border border-[#7ec4e8] bg-[#b3e2ff]" />GPT
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2.5px] w-5 rounded-full bg-violet-500" />语义引用
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2.5px] w-5 rounded-full bg-red-500" />纠正
          </span>
          <span className="h-4 w-px bg-stone-200" />
          <button
            onClick={resetLayout}
            className="rounded-full border-[1.5px] border-stone-300 px-2.5 py-1 text-[10px] font-bold text-stone-600 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700"
          >
            整理布局
          </button>
          <span className="flex items-center gap-1.5 text-[10px] text-stone-500">
            <span className={`h-1.5 w-1.5 rounded-full ${saving ? 'bg-amber-500' : 'graph-pulse bg-emerald-500'}`} />
            {saving ? '保存位置…' : `在线 ${peers.length + 1}`}
          </span>
        </div>
      </div>

      {selected && (
        <aside className="graph-panel-in absolute right-0 top-0 z-30 flex h-full w-[380px] flex-col border-l-[1.5px] border-[#e3ddcd] bg-[#fffdf7] shadow-[-8px_0_24px_rgba(30,27,20,0.12)]">
          <div className="flex items-center gap-2 border-b border-[#eee7d8] px-4 py-3">
            <span
              className="rounded-full px-2 py-[2px] text-[10px] font-extrabold"
              style={
                selected.role === 'user'
                  ? { color: STICKY.user.ink, background: STICKY.user.from, border: `1px solid ${STICKY.user.border}` }
                  : {
                      color: STICKY.assistant.ink,
                      background: STICKY.assistant.from,
                      border: `1px solid ${STICKY.assistant.border}`,
                    }
              }
            >
              {selected.role === 'user' ? '我' : 'GPT'}
            </span>
            <span className="text-[11px] font-semibold text-stone-500">#{selected.position + 1} 原文</span>
            <button
              onClick={() => setSelected(null)}
              className="ml-auto rounded px-2 text-stone-400 transition hover:text-stone-800"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto px-4 py-4">
            <p className="mb-3 break-all font-mono text-[9px] text-stone-400">{selected.id}</p>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-stone-800">{selected.content}</p>
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
