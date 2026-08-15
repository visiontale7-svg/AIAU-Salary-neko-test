# 团队 LLM 知识库

导入 JSONL 知识卡片或 ChatGPT 网页版导出的对话（conversations.json），沉淀为团队共享、可搜索、实时同步的知识卡片（灵感 / 决策 / 权衡 / 已否决）。

## 技术栈

- Next.js 14 (App Router, TypeScript, Tailwind)
- Supabase：Postgres（关键词检索）+ Realtime（协作实时更新）

## 本地开发

1. 启动本地 Supabase 并应用迁移：

```bash
supabase start
supabase db reset   # 应用 supabase/migrations
```

2. 复制 `.env.example` 为 `.env.local`，填入 `supabase start` 输出的 URL/anon key/service role key。

3. 启动：

```bash
npm install
npm run dev
```

## 使用方式

首页点击「导入 JSONL / conversations.json」，支持两种文件：

1. **JSONL**：每行一个 JSON 对象，两种格式可混用：
   - 知识卡片：`{"title": "...", "content": "...", "card_type": "insight|decision|tradeoff|rejected", "tags": ["..."]}`（`card_type`/`tags` 可省略）
   - 完整对话：`{"title": "...", "messages": [{"role": "user|assistant", "content": "..."}]}`
2. **ChatGPT 官方导出**：Settings → Data controls → Export data，取出压缩包里的 `conversations.json`（按 `conversation_id` 去重）。

用顶部搜索框按关键词搜索卡片；卡片可跳回原对话全文。多人同时使用时卡片列表通过 Supabase Realtime 实时同步。
