# Relay 生产部署：Supabase Cloud + Vercel

前端是 `apps/relay-web` 的静态产物（Vercel），后端是 Supabase 云项目（Postgres/Auth/Realtime）加一个
Edge Function `devin-relay`。Devin API key 只存在于 Edge Function secrets，永远不进 Vite 环境变量。

仓库根目录已有 `vercel.json`（`npm run build:relay` → `apps/relay-web/dist`，`/room/*` 回退到
`index.html`，安全响应头）。因此 Vercel 侧不需要在控制台里再配置构建命令。

一次性准备：

- Supabase 云项目一个（建议 staging 与 production 分开），拿到 `<project-ref>`；
- Vercel 项目一个，绑定本仓库；
- Devin service user API key（生产用，与本地调试的 key 分开），org id `org-...`。

## 0. 发布前本地检查

    npm ci
    npm run typecheck:relay
    npm run test:relay
    npm run build:relay
    npm run check:relay-boundaries
    npm run relay:supabase:test

## 1. 数据库与配置

    supabase login
    supabase link --project-ref <project-ref>
    supabase db push --linked --dry-run
    supabase db push --linked
    supabase config push

推完确认 migration history 里 `supabase/migrations` 下的 12 个迁移全部出现，尤其是最后三个：

    202608160002_devin_provider_health.sql
    202608160003_devin_enterprise_session_identity.sql
    202608160004_dedupe_devin_follow_up_echo.sql

顺序不能乱：`202608160003/4` 重建的是 `202608160002` 定义的函数体，倒过来会把 provider health
和去重逻辑覆盖掉。

Dashboard 里还要确认：Anonymous Sign-ins 已开启；Site URL 指向 Vercel 域名；Anonymous Auth 有速率限制。

## 2. Edge Function

先设 secrets（**不要**把这些值写进仓库、CI 日志或 Vite 变量）：

    supabase secrets set --project-ref <project-ref> \
      DEVIN_API_KEY='<production-key>' \
      DEVIN_ORG_ID='org-...' \
      DEVIN_API_BASE_URL='https://api.devinenterprise.com/v3' \
      DEVIN_REPO='visiontale7-svg/AIAU-Salary-neko' \
      DEVIN_MAX_ACU_LIMIT='1' \
      RELAY_ALLOWED_ORIGINS='https://<relay-domain>'

再部署：

    supabase functions deploy devin-relay --project-ref <project-ref>

要点：

- `DEVIN_API_BASE_URL` 只接受 `api.devin.ai` 或 `api.devinenterprise.com` 上的 `https://.../v3`，
  写错时 provider 直接停在 `not_configured`，不会把 key 发到别的 origin；
- `DEVIN_LOCAL_STUB_BASE_URL` 只用于本地，生产不要设；
- `RELAY_ALLOWED_ORIGINS` 是逗号分隔的精确 origin 列表。Vercel 的 preview 域名每次都不同，
  预览环境要么单独列出，要么就让预览环境不启用 Devin；
- entitlement（谁能跑 Devin、每天几次、ACU 上限）在 `relay_private.devin_entitlements` 里按用户配置，
  生产上线时至少给房主一行，`max_acu_limit` 从小往大调。

## 3. 前端（Vercel）

项目环境变量只有两个，两个都是可公开值：

    VITE_SUPABASE_URL=https://<project-ref>.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

绝不要在 Vercel 上设置 service-role key、`sb_secret_...`、数据库密码、任何 Devin 变量，也不要设
`VITE_RELAY_LOCAL_INTEGRATION=1`。

部署：

    vercel link
    vercel env add VITE_SUPABASE_URL production
    vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production
    vercel deploy --prod

拿到正式域名后回到第 2 步把 `RELAY_ALLOWED_ORIGINS` 改成该域名并重新 `supabase secrets set`
（secrets 改动即时生效，不必重新 deploy function）。

## 4. 部署后验收

1. 打开 `https://<relay-domain>/`，落在新建房间页；填一个开场问题 → 应跳到 `/room/<id>` 并渲染星图；
2. 复制邀请链接，用另一个浏览器（无痕）打开 → 能加入、Presence 显示 2 人、拖动/表态双向同步；
3. 直接访问一个不属于自己的 `/room/<id>` → 应当 fail closed；
4. 房主在「执行」tab 走 提案 → 采纳 → Action Brief → 发起 Devin：应出现真实 session 链接、
   日志自动增长、追问只出现一次（去重生效）；
5. 浏览器控制台无 CSP / WSS 报错。

第 4 步会真实消耗 ACU，先把 entitlement 的 `max_runs_per_day` 和 `max_acu_limit` 都设成 1。

## 回滚

- 前端：Vercel 上把上一版 deployment 设为 production（即时）；
- Edge Function：重新 deploy 上一个 commit 的函数；
- 数据库：迁移都是 `create or replace`，回滚要靠部署上一版迁移文件，不要手工改线上函数。
