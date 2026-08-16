// Local stand-in for Devin API v3, used to exercise the Relay Edge Function
// end to end without spending a paid provider turn.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8799);
const sessions = new Map();
let counter = 0;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

function timeline(session) {
  const age = (Date.now() - session.createdAt) / 1000;
  if (age < 6) {
    return { status: "running", status_detail: "working", events: 1 };
  }
  if (age < 12) {
    return { status: "running", status_detail: "working", events: 3 };
  }
  return {
    status: "exit",
    status_detail: "finished",
    events: 4,
    pull_requests: [{ url: "https://github.com/visiontale7-svg/AIAU-Salary-neko/pull/42", state: "open" }],
  };
}

const EVENT_TEXTS = [
  "Session started against visiontale7-svg/AIAU-Salary-neko at the pinned baseline SHA.",
  "Read the allowed files and prepared the change set.",
  "Ran the acceptance commands: npm run typecheck and npm test.",
  "Opened pull request #42 with the approved change.",
];

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const authorized = (req.headers.authorization ?? "").startsWith("Bearer cog_");
  console.log(`${req.method} ${url.pathname}${url.search} auth=${authorized}`);
  if (!authorized) return send(res, 401, { error: "unauthorized" });

  // /v3/organizations/{org}/sessions[/{id}[/messages]]
  const [, , , resource, sessionId, sub] = parts;
  if (resource !== "sessions") return send(res, 404, { error: "not_found" });

  if (req.method === "POST" && !sessionId) {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      counter += 1;
      const id = `devin-stub${String(counter).padStart(3, "0")}`;
      sessions.set(id, { createdAt: Date.now(), prompt: body.prompt, repos: body.repos });
      console.log(`  created ${id} repos=${JSON.stringify(body.repos)} acu=${body.max_acu_limit}`);
      send(res, 200, {
        session_id: id,
        url: `https://app.devin.ai/sessions/${id}`,
        status: "new",
      });
    });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) return send(res, 404, { error: "not_found" });

  if (req.method === "GET" && !sub) {
    const state = timeline(session);
    return send(res, 200, {
      session_id: sessionId,
      url: `https://app.devin.ai/sessions/${sessionId}`,
      status: state.status,
      status_detail: state.status_detail,
      ...(state.pull_requests ? { pull_requests: state.pull_requests } : {}),
    });
  }

  if (req.method === "GET" && sub === "messages") {
    const state = timeline(session);
    const items = EVENT_TEXTS.slice(0, state.events).map((message, index) => ({
      event_id: `evt_${sessionId}_${index + 1}`,
      message,
      created_at: Math.floor((session.createdAt + index * 1000) / 1000),
    }));
    const after = url.searchParams.get("after");
    const start = after ? items.findIndex((item) => item.event_id === after) + 1 : 0;
    const page = items.slice(start);
    return send(res, 200, {
      items: page,
      has_next_page: false,
      end_cursor: page.at(-1)?.event_id ?? after ?? null,
      total: items.length,
    });
  }

  if (req.method === "POST" && sub === "messages") {
    return send(res, 204, {});
  }

  return send(res, 404, { error: "not_found" });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Devin stub listening on http://127.0.0.1:${PORT}`);
});
