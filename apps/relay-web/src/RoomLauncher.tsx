import { useState } from "react";
import {
  validateRelayPackage,
  type RelayPackageV1,
  type RelayRoomRepository,
} from "@dialogue-atlas/relay-contract";
import "./room-launcher.css";

export const ROOM_TITLE_MAX_LENGTH = 160;

export interface StarterPackageInput {
  title: string;
  publishId: string;
  publishedAt: string;
}

/**
 * A new room starts from a single anchor question so the star map has a trunk
 * to grow from. Everything else is created by the team inside the room.
 */
export function createStarterRelayPackage({ title, publishId, publishedAt }: StarterPackageInput): RelayPackageV1 {
  const trimmed = title.trim();
  return {
    schemaVersion: "relay-v1",
    packageId: `pkg_${publishId}`,
    clientPublishId: publishId,
    title: trimmed,
    publishedAt,
    graph: {
      nodes: [
        {
          id: "n001",
          origin: "source",
          label: trimmed,
          kind: "anchor",
          speaker: "user",
          acts: ["question"],
          modeIds: ["m001"],
          evidenceIds: [],
          importance: 1,
          primary: true,
        },
      ],
      edges: [],
      modes: [
        { id: "m001", kind: "exploration", label: "Frame", color: "#496e9e", memberNodeIds: ["n001"] },
      ],
      layout: { n001: { x: 0, y: 0 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    evidence: {},
  };
}

export function newRoomPublishId(now: number, random: number): string {
  const suffix = Math.floor(random * 0xffffff).toString(36).padStart(5, "0");
  return `room.${now.toString(36)}.${suffix}`;
}

export interface RoomLauncherProps {
  repository: RelayRoomRepository;
  onCreated(created: { roomId: string; inviteToken: string }): void;
}

export function RoomLauncher({ repository, onCreated }: RoomLauncherProps) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function createRoom(): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > ROOM_TITLE_MAX_LENGTH) {
      setError(`请填写 1-${ROOM_TITLE_MAX_LENGTH} 字的开场问题。`);
      return;
    }
    const pkg = createStarterRelayPackage({
      title: trimmed,
      publishId: newRoomPublishId(Date.now(), Math.random()),
      publishedAt: new Date().toISOString(),
    });
    const validation = validateRelayPackage(pkg);
    if (!validation.ok) {
      setError("开场问题不能包含文件路径、邮箱、标识符或密钥。");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const created = await repository.createRoomWithPackage(pkg, { maxUses: 20 });
      onCreated(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "房间创建失败。");
      setPending(false);
    }
  }

  return (
    <main className="relay-launcher">
      <section className="relay-launcher__card" aria-labelledby="relay-launcher-heading">
        <h1 id="relay-launcher-heading">新建 Dialogue Atlas 房间</h1>
        <p>房间从一个问题开始。邀请团队一起和 Devin 讨论，每完成一轮就在星图上结晶出一颗星。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createRoom();
          }}
        >
          <label htmlFor="relay-launcher-title">开场问题</label>
          <input
            id="relay-launcher-title"
            value={title}
            maxLength={ROOM_TITLE_MAX_LENGTH}
            placeholder="我们如何让个人的 AI 工作变成团队可评审的决策？"
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="submit" disabled={pending || title.trim().length === 0}>
            {pending ? "正在创建…" : "创建房间"}
          </button>
        </form>
        {error ? <p className="relay-launcher__error" role="alert">{error}</p> : null}
        <p className="relay-launcher__hint">
          已经收到邀请？直接打开房间链接或邀请链接。系统不公开任何房间列表。
        </p>
      </section>
    </main>
  );
}
