-- Enterprise Devin tenants return a bare Session id and a session link on the
-- tenant's own Devin host, while cloud sessions stay `devin-<id>` on
-- app.devin.ai. Both identities are accepted; every other host, and any URL
-- that does not address exactly the stored Session, is still rejected.
create or replace function public.update_devin_run_snapshot(
  p_room_id uuid,
  p_run_id uuid,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_before public.devin_runs%rowtype;
  v_row public.devin_runs%rowtype;
  v_state text;
  v_status_detail text;
  v_external_session_id text;
  v_external_url text;
  v_pull_request_url text;
  v_pull_request_state text;
  v_checks_state text;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array[
      'externalSessionId', 'externalUrl', 'state', 'statusDetail',
      'pullRequestUrl', 'pullRequestState', 'checksState'
    ],
    'Devin provider snapshot'
  );
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  select * into v_before
  from public.devin_runs
  where id = p_run_id and room_id = p_room_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'devin_run_not_found';
  end if;
  if not v_before.provider_authorized or v_before.provider_attempted_at is null then
    raise exception using errcode = '42501', message = 'provider_attempt_not_reserved';
  end if;

  v_state := coalesce(p_input->>'state', v_before.state);
  v_status_detail := case
    when p_input ? 'statusDetail' then nullif(p_input->>'statusDetail', '')
    else v_before.status_detail
  end;
  v_external_session_id := case
    when p_input ? 'externalSessionId' then nullif(p_input->>'externalSessionId', '')
    else v_before.external_session_id
  end;
  v_external_url := case
    when p_input ? 'externalUrl' then nullif(p_input->>'externalUrl', '')
    else v_before.external_url
  end;
  v_pull_request_url := case
    when p_input ? 'pullRequestUrl' then nullif(p_input->>'pullRequestUrl', '')
    else v_before.pull_request_url
  end;
  v_pull_request_state := case
    when p_input ? 'pullRequestState' then nullif(p_input->>'pullRequestState', '')
    else v_before.pull_request_state
  end;
  v_checks_state := case
    when p_input ? 'checksState' then nullif(p_input->>'checksState', '')
    else v_before.checks_state
  end;

  -- Provider polls can complete out of order across owner tabs. A stale
  -- working snapshot must never reopen a terminal run. The pre-POST blocked
  -- marker can become failed after an explicit 4xx rejection, or can attach
  -- the one reconciled/returned external Session, but cannot otherwise become
  -- active while its paid result is unknown.
  if v_before.state in ('completed', 'failed') then
    v_state := v_before.state;
    v_status_detail := v_before.status_detail;
  elsif v_before.state = 'blocked'
    and v_before.status_detail = 'provider_result_unknown'
    and v_before.external_session_id is null
    and v_external_session_id is null
    and v_state not in ('blocked', 'failed')
  then
    raise exception using errcode = '55000', message = 'provider_result_requires_reconciliation';
  end if;

  if v_state not in ('not_configured', 'queued', 'working', 'needs_input', 'approval_needed', 'completed', 'failed', 'blocked')
    or (v_status_detail is not null and char_length(v_status_detail) > 2000)
    or (v_external_session_id is not null and (
      char_length(v_external_session_id) not between 8 and 200
      or v_external_session_id !~ '^(devin-)?[A-Za-z0-9_-]+$'
    ))
    or (v_external_url is not null and (
      v_external_session_id is null
      or rtrim(v_external_url, '/') !~ (
        '^https://(app\.devin\.ai|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.devinenterprise\.com)/sessions/'
        || v_external_session_id || '$'
      )
    ))
    or (v_pull_request_url is not null and v_pull_request_url !~ '^https://github\.com/visiontale7-svg/AIAU-Salary-neko/pull/[1-9][0-9]*$')
    or (v_pull_request_state is not null and char_length(v_pull_request_state) > 80)
    or (v_checks_state is not null and v_checks_state not in ('unknown', 'pending', 'passing', 'failing'))
  then
    raise exception using errcode = '22023', message = 'invalid_devin_provider_snapshot';
  end if;
  if v_before.external_session_id is not null
    and v_external_session_id is distinct from v_before.external_session_id
  then
    raise exception using errcode = '22023', message = 'external_session_id_is_immutable';
  end if;
  if coalesce(v_status_detail, '') ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or coalesce(v_status_detail, '') ~ '(/Users/|/home/|/private/|/var/|/tmp/|/Volumes/|/opt/|/etc/|/srv/|/root/|/mnt/|/media/|/run/|/usr/|/Library/)'
    or coalesce(v_status_detail, '') ~* '(sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|(api[_-]?key|authorization|bearer|token|secret|password)[[:space:]]*[:=])'
  then
    raise exception using errcode = '22023', message = 'unsanitized_devin_status_detail';
  end if;
  if v_status_detail is not null then
    perform relay_private.assert_safe_shared_text(v_status_detail, 'Devin status detail');
  end if;

  update public.devin_runs
  set external_session_id = v_external_session_id,
      external_url = v_external_url,
      state = v_state,
      status_detail = v_status_detail,
      pull_request_url = v_pull_request_url,
      pull_request_state = v_pull_request_state,
      checks_state = v_checks_state,
      updated_at = now()
  where id = p_run_id
  returning * into v_row;

  if row(
    v_before.external_session_id, v_before.external_url, v_before.state,
    v_before.status_detail, v_before.pull_request_url,
    v_before.pull_request_state, v_before.checks_state
  ) is distinct from row(
    v_row.external_session_id, v_row.external_url, v_row.state,
    v_row.status_detail, v_row.pull_request_url,
    v_row.pull_request_state, v_row.checks_state
  ) then
    perform relay_private.record_activity(
      p_room_id, 'devin_run_updated', p_run_id::text, v_before.requested_by, null
    );
  end if;
  return relay_private.format_devin_run(v_row);
end;
$$;
