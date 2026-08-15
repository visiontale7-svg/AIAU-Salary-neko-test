# 团队 LLM 知识库

导入 ChatGPT 网页版导出的对话（conversations.json），用 LLM 自动提炼出结构化知识卡片（灵感 / 决策 / 权衡 / 已否决），支持团队共享、语义搜索与实时更新。

## 技术栈

- Next.js 14 (App Router, TypeScript, Tailwind)
- Supabase：Postgres + pgvector（语义检索）+ Realtime（协作实时更新）
- OpenAI：知识提炼（gpt-4o-mini，可配置）+ 嵌入（text-embedding-3-small）

## 本地开发

1. 启动本地 Supabase 并应用迁移：

```bash
supabase start
supabase db reset   # 应用 supabase/migrations
```

2. 复制 `.env.example` 为 `.env.local`，填入 `supabase start` 输出的 URL/anon key/service role key，以及 `OPENAI_API_KEY`。

3. 启动：

```bash
npm install
npm run dev
```

## 使用方式

1. 在 ChatGPT 网页版：Settings → Data controls → Export data，从邮件里下载压缩包，取出 `conversations.json`。
2. 打开首页，点击「导入 conversations.json」。导入会解析每个对话、按 `source_id` 去重、调用 LLM 提炼知识卡片并生成向量。
3. 用顶部搜索框做语义搜索；卡片可跳回原对话全文。多人同时使用时卡片列表通过 Supabase Realtime 实时同步。
