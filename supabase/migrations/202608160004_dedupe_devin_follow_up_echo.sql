create or replace function public.append_devin_provider_events(
  p_room_id uuid,
  p_run_id uuid,
  p_events jsonb,
  p_end_cursor text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_requester uuid;
  v_event jsonb;
  v_created_at timestamptz;
  v_max_created_at timestamptz;
  v_inserted integer := 0;
  v_row_count integer;
  v_text text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  select requested_by into v_requester
  from public.devin_runs
  where id = p_run_id
    and room_id = p_room_id
    and provider_authorized
    and provider_attempted_at is not null
    and external_session_id is not null;
  if not found then
    raise exception using errcode = '22023', message = 'devin_run_not_found';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array'
    or jsonb_array_length(p_events) > 1000
    or (p_end_cursor is not null and char_length(p_end_cursor) not between 1 and 500)
  then
    raise exception using errcode = '22023', message = 'invalid_devin_provider_events';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    perform relay_private.assert_json_keys(
      v_event,
      array['externalEventId', 'eventType', 'actorType', 'createdAt', 'text'],
      'Devin provider event'
    );
    v_text := v_event->>'text';
    begin
      v_created_at := (v_event->>'createdAt')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid_devin_provider_event_timestamp';
    end;
    if v_event->>'eventType' <> 'provider_message'
      or v_event->>'actorType' <> 'devin'
      or char_length(coalesce(v_event->>'externalEventId', '')) not between 1 and 200
      or v_event->>'externalEventId' !~ '^[A-Za-z0-9_.:-]+$'
      or char_length(coalesce(v_text, '')) not between 1 and 6000
      or v_text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
      or v_text ~ '(/Users/|/home/|/private/|/var/|/tmp/|/Volumes/|/opt/|/etc/|/srv/|/root/|/mnt/|/media/|/run/|/usr/|/Library/)'
      or v_text ~* '(sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|(api[_-]?key|authorization|bearer|token|secret|password)[[:space:]]*[:=])'
    then
      raise exception using errcode = '22023', message = 'unsanitized_devin_provider_event';
    end if;
    perform relay_private.assert_safe_shared_text(v_text, 'Devin provider event');
    -- The provider replays an owner follow-up back as one of its own messages,
    -- so the run log would otherwise show the same text twice. Only an exact
    -- replay of a follow-up already recorded on this run is dropped; a genuine
    -- Devin reply is still appended.
    insert into public.devin_events(
      room_id, run_id, external_event_id, event_type, actor_type, text, actor_id, created_at
    )
    select
      p_room_id,
      p_run_id,
      v_event->>'externalEventId',
      'provider_message',
      'devin',
      v_text,
      null,
      v_created_at
    where not exists (
      select 1
      from public.devin_events echoed
      where echoed.run_id = p_run_id
        and echoed.event_type = 'owner_follow_up_attempted'
        and echoed.text = btrim(v_text)
    )
    on conflict (run_id, external_event_id) do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
    if v_row_count > 0 then
      v_max_created_at := case
        when v_max_created_at is null or v_created_at > v_max_created_at then v_created_at
        else v_max_created_at
      end;
    end if;
  end loop;

  if v_inserted > 0 then
    perform relay_private.record_activity(
      p_room_id, 'devin_events_appended', p_run_id::text, v_requester, null
    );
  end if;
  if p_end_cursor is not null or v_max_created_at is not null then
    update public.devin_runs
    set provider_message_cursor = coalesce(p_end_cursor, provider_message_cursor),
        last_provider_event_at = case
          when v_max_created_at is null then last_provider_event_at
          when last_provider_event_at is null or v_max_created_at > last_provider_event_at then v_max_created_at
          else last_provider_event_at
        end,
        updated_at = now()
    where id = p_run_id and room_id = p_room_id;
  end if;
  return v_inserted;
end;
$$;
