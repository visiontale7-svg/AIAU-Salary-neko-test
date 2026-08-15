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

-- MVP: all authenticated team members share everything
create policy "team read conversations" on conversations for select to authenticated using (true);
create policy "team write conversations" on conversations for insert to authenticated with check (true);
create policy "team read messages" on messages for select to authenticated using (true);
create policy "team write messages" on messages for insert to authenticated with check (true);
create policy "team read cards" on knowledge_cards for select to authenticated using (true);
create policy "team write cards" on knowledge_cards for all to authenticated using (true) with check (true);

-- realtime for collaborative updates
alter publication supabase_realtime add table knowledge_cards;
alter publication supabase_realtime add table conversations;
