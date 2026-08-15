---
name: testing-llm-knowledge-base
description: How to run and E2E-test the llm-knowledge-base Next.js + local Supabase app
---

# Testing llm-knowledge-base locally

1. `npx supabase init` (if no supabase/config.toml), then `npx supabase start` (pulls Docker images, several minutes first time). Migrations in `supabase/migrations/` are applied automatically at start/`db reset`.
2. Copy the printed ANON_KEY / SERVICE_ROLE_KEY into `.env.local` (template: `.env.example`, URL http://127.0.0.1:54321), then `npm run dev` (port 3000).
3. Known pitfalls (as of 0001_init.sql):
   - RLS policies are `to authenticated` only and the app has NO login UI, so the browser anon client gets `permission denied` (empty card list, no realtime). Workaround for demos: `docker exec supabase_db_llm-knowledge-base psql -U postgres -d postgres -c "grant select on conversations, messages, knowledge_cards to anon; create policy anon_read_cards on knowledge_cards for select to anon using (true); ..."`
   - On current local Supabase (postgres 17.x image) even `service_role`/`authenticated` may lack table privileges → `/api/import` silently returns `{"imported":0,"cards":0}`. Fix: `grant all on all tables in schema public to service_role, authenticated;`
   - `psql` is not installed on the host; use `docker exec supabase_db_llm-knowledge-base psql -U postgres -d postgres -c "..."`.
4. Typing Chinese into inputs via computer-use `type` does not work (no IME). Workaround: `printf '缓存' | DISPLAY=:0 xclip -selection clipboard` (apt install xclip) then Ctrl+V in the field.
5. JSONL-imported standalone cards have no `conversation_id`, so no card shows 查看原对话 after a plain import; to demo that link (and Realtime), insert a card linked to an imported conversation directly in the DB.
6. Restarting the dev server after a commit: `pgrep -af "next dev|next-server"` → kill those PIDs (leave unrelated root-owned ones) → `rm -rf .next` → `setsid nohup npm run dev > /tmp/devserver.log 2>&1 < /dev/null &`, then hard reload (Ctrl+Shift+R) — an in-app `window.location.reload()` can be served a cached RSC payload with stale data.
7. Testing the structure graph (`/conversations/<id>/graph`):
   - Realtime multi-user needs two tiled Chrome windows (`wmctrl`/`xdotool`), not two tabs: a background tab can't be observed and the peer count only increments once a cursor broadcast arrives.
   - For layout/reset behaviour, first force `conversations.graph_positions` to NULL, record each node's `style.transform`, drag to create persisted state, and set a `window.__marker` before clicking 整理布局 so you can prove the restore was client-side.
   - When hover seems broken, check `document.elementFromPoint` for `path.react-flow__edge-interaction` over every node centre. React Flow applies edge props like `interactionWidth` automatically only to built-in edge types; custom edge components must forward them to `<BaseEdge>`.
