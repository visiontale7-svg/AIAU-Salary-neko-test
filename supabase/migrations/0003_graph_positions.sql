-- persisted node positions for the conversation structure graph (Miro-like drag)
alter table conversations add column if not exists graph_positions jsonb;
