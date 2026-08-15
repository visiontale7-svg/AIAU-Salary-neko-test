create table conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text not null default 'chatgpt',
  source_id text,
  imported_by uuid references auth.users(id),
  message_count int not null default 0,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  position int not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on messages(conversation_id, position);

create table knowledge_cards (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete set null,
  title text not null,
  card_type text not null default 'insight', -- insight | decision | tradeoff | rejected
  content text not null,
  tags text[] not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_cards_title_idx on knowledge_cards using gin (to_tsvector('simple', title || ' ' || content));

alter table conversations enable row level security;
alter table messages enable row level security;
alter table knowledge_cards enable row level security;

-- MVP has no login UI yet: allow reads from the anon browser client.
-- Writes go through server API routes using the service role.
grant usage on schema public to anon, authenticated, service_role;
grant select on conversations, messages, knowledge_cards to anon, authenticated;
grant all on conversations, messages, knowledge_cards to service_role;

create policy "read conversations" on conversations for select to anon, authenticated using (true);
create policy "read messages" on messages for select to anon, authenticated using (true);
create policy "read cards" on knowledge_cards for select to anon, authenticated using (true);

-- realtime for collaborative updates
alter publication supabase_realtime add table knowledge_cards;
alter publication supabase_realtime add table conversations;
