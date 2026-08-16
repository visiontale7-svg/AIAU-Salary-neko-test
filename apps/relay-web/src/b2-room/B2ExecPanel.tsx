import { useId, useState } from "react";
import type { ActionBrief, DevinRun } from "@dialogue-atlas/relay-contract";
import type { RelayReadyRoomModel, RelayRoomCallbacks } from "@dialogue-atlas/relay-room";

const RUN_STATE_LABEL: Record<string, string> = {
  not_configured: "未接入",
  queued: "排队中",
  working: "执行中",
  needs_input: "等待输入",
  approval_needed: "等待批准",
  completed: "已完成",
  failed: "已失败",
  result_unknown: "结果未知",
};

const CHECKS_LABEL: Record<string, string> = {
  unknown: "CI 未知",
  pending: "CI 进行中",
  passing: "CI 通过",
  failing: "CI 失败",
};

const ACTIVE_STATES = ["queued", "working", "needs_input", "approval_needed"];

function runTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  } catch {
    return "";
  }
}

function DevinRunCard({ run, events, callbacks, pending }: {
  run: DevinRun;
  events: RelayReadyRoomModel["devinEvents"][string];
  callbacks: RelayRoomCallbacks;
  pending: boolean;
}) {
  const requestSeed = useId().replaceAll(":", "");
  const [messageAttempt, setMessageAttempt] = useState(0);
  const clientRequestId = `devin_message_${requestSeed}_${messageAttempt}`;
  return (
    <article className="b2-exec__run" data-run-state={run.state}>
      <header>
        <b>{RUN_STATE_LABEL[run.state] ?? run.state}</b>
        <span className="b2-exec__checks">{CHECKS_LABEL[run.checksState ?? "unknown"]}</span>
      </header>
      <p className="b2-exec__detail">{run.statusDetail ?? "服务端未报告更多状态。"}</p>
      <dl>
        <div><dt>更新</dt><dd>{runTime(run.updatedAt)}</dd></div>
        <div><dt>会话</dt><dd>{run.externalUrl
          ? <a href={run.externalUrl} target="_blank" rel="noreferrer">{run.externalSessionId ?? "打开 Devin 会话"} ↗</a>
          : run.externalSessionId ?? "尚未创建会话"}</dd></div>
        <div><dt>PR</dt><dd>{run.pullRequestUrl
          ? <a href={run.pullRequestUrl} target="_blank" rel="noreferrer">查看 Pull Request ↗</a>
          : "尚未报告 PR"}</dd></div>
      </dl>
      <div className="b2-exec__events">
        <p className="b2-live__eyebrow">执行日志 · {events?.length ?? 0}</p>
        {events?.length
          ? <ol>{events.map((event) => <li key={event.id}><time>{runTime(event.createdAt)}</time><span>{event.text}</span></li>)}</ol>
          : <p className="b2-live__empty">服务端还没有推送事件。</p>}
      </div>
      {callbacks.onSendDevinMessage && ACTIVE_STATES.includes(run.state) ? (
        <form className="b2-exec__followup" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const result = callbacks.onSendDevinMessage?.(run.id, String(data.get("message") ?? "").trim(), clientRequestId);
          const outcome = result === undefined ? "unknown" : await result;
          if (outcome === "accepted") form.reset();
          if (outcome !== "unknown") setMessageAttempt((attempt) => attempt + 1);
        }}>
          <label><span className="b2-exec__hidden">追问运行中的 Devin</span>
            <textarea name="message" required rows={2} placeholder="向运行中的 Devin 追问…" /></label>
          <button type="submit" disabled={pending}>发送</button>
        </form>
      ) : null}
    </article>
  );
}

function ActionBriefCard({ brief, model, callbacks }: {
  brief: ActionBrief;
  model: RelayReadyRoomModel;
  callbacks: RelayRoomCallbacks;
}) {
  const runs = model.bundle.devinRuns.filter((run) => run.actionBriefId === brief.id);
  const latestRun = [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const requestSeed = useId().replaceAll(":", "");
  const [startAttempt, setStartAttempt] = useState(0);
  const isOwner = model.bundle.member.role === "owner";
  const canStart = runs.length === 0 || latestRun?.state === "not_configured" || latestRun?.state === "failed";

  async function startDevinAttempt() {
    const result = callbacks.onStartDevin?.(brief.id, `devin_start_${requestSeed}_${startAttempt}`);
    if (result !== undefined && await result !== false) setStartAttempt((attempt) => attempt + 1);
  }

  return (
    <article className="b2-exec__brief">
      <header>
        <p className="b2-live__eyebrow">已批准任务书</p>
        <h3>{brief.title}</h3>
        <code>{brief.baselineSha || "缺少基线 SHA"}</code>
      </header>
      <p className="b2-exec__detail">{brief.objective}</p>
      <dl>
        <div><dt>允许文件</dt><dd>{brief.allowedFiles.join("、") || "未限定"}</dd></div>
        <div><dt>验收命令</dt><dd>{brief.acceptanceCommands.join(" · ") || "未限定"}</dd></div>
      </dl>
      {runs.map((run) => (
        <DevinRunCard key={run.id} run={run} events={model.devinEvents[run.id]} callbacks={callbacks} pending={Boolean(model.pendingMutation)} />
      ))}
      {isOwner && canStart && callbacks.onStartDevin ? (
        <button type="button" className="b2-exec__start" disabled={Boolean(model.pendingMutation)} onClick={() => { void startDevinAttempt(); }}>
          {runs.length === 0 ? "发起 Devin 任务" : "重新发起 Devin 任务"}
        </button>
      ) : null}
      {!isOwner && runs.length === 0 ? <p className="b2-live__empty">仅房主可以发起 Devin 任务。</p> : null}
    </article>
  );
}

export function B2ExecPanel({ model, callbacks }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  const briefs = model.bundle.actionBriefs;
  return (
    <section className="b2-exec" aria-label="Devin 执行">
      {briefs.length
        ? briefs.map((brief) => <ActionBriefCard key={brief.id} brief={brief} model={model} callbacks={callbacks} />)
        : <p className="b2-live__empty">还没有已批准的任务书。房主把一个已接受的决策变成有边界的任务书后，才能在这里发起 Devin。</p>}
    </section>
  );
}
