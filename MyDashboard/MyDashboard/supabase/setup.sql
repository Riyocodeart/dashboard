-- =====================================================================
--  Desk Performance Board · Supabase backend
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
--  Safe to run again (it updates functions and keeps your data).
--
--  What it creates
--   public.dashboard_state   one row: the merged data everyone sees (read-only for visitors)
--   private.settings         the upload password, stored only as a bcrypt hash
--   private.sessions         upload sessions (12 h), stored as SHA-256 hashes
--   private.login_attempts   5 wrong passwords → 60 s lock, per IP
--   private.original_files   every uploaded .xlsx, kept byte-for-byte
--   public.upload_* / save_dashboard / get_original   the only functions visitors can call
--  The "private" schema is not exposed by the Supabase API, so the password hash,
--  sessions and original files can only be reached through the functions below.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- tables ----------
create table if not exists public.dashboard_state (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '{"v":1,"updatedAt":null,"datasets":{"map":null,"margin":null,"grey":null},"history":[]}'::jsonb,
  updated_at timestamptz
);
insert into public.dashboard_state (id) values (1) on conflict (id) do nothing;

alter table public.dashboard_state enable row level security;
drop policy if exists "Anyone can read the dashboard" on public.dashboard_state;
create policy "Anyone can read the dashboard" on public.dashboard_state for select to anon, authenticated using (true);
revoke all on public.dashboard_state from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.dashboard_state to anon, authenticated;

create table if not exists private.settings (
  id            smallint primary key default 1 check (id = 1),
  password_hash text not null
);
create table if not exists private.sessions (
  token_hash bytea primary key,
  expires_at timestamptz not null
);
create table if not exists private.login_attempts (
  ip           text primary key,
  fails        int not null default 0,
  locked_until timestamptz
);
create table if not exists private.original_files (
  id          bigserial primary key,
  kind        text not null check (kind in ('map','margin','grey')),
  name        text not null,
  size        int  not null,
  content     bytea not null,
  uploaded_at timestamptz not null default now()
);

-- ---------- helpers (private, not callable by visitors) ----------
create or replace function private.client_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(trim(split_part(coalesce(
           h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for', ''), ',', 1)), ''), 'unknown')
  from (select nullif(current_setting('request.headers', true), '')::json as h) s
$$;

create or replace function private.session_ok(p_token text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from private.sessions
                 where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
                   and expires_at > now())
$$;

create or replace function private.txt(j jsonb, n int default 200) returns text
language sql immutable set search_path = '' as $$
  select left(case when jsonb_typeof(j) in ('string','number','boolean') then trim(j #>> '{}') else '' end, n)
$$;

create or replace function private.num(j jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(j) = 'number' then j
    when jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then to_jsonb((j #>> '{}')::numeric)
    else '0'::jsonb end
$$;

-- Keeps only the expected fields, trims text, forces numbers. Mirrors the browser parser output.
create or replace function private.clean_rows(p_kind text, p_rows jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(case p_kind
    when 'map' then jsonb_build_object(
      'gl', private.txt(r->'gl'), 'tl', private.txt(r->'tl'), 'id', private.txt(r->'id'), 'name', private.txt(r->'name'),
      'uniq', private.num(r->'uniq'), 'total', private.num(r->'total'), 'opts', private.num(r->'opts'))
    when 'margin' then jsonb_build_object(
      'user', private.txt(r->'user'), 'client', private.txt(r->'client'), 'margin', private.num(r->'margin'))
    else jsonb_build_object(
      'date', private.txt(r->'date', 10), 'user', private.txt(r->'user'), 'domain', private.txt(r->'domain', 80),
      'type', private.txt(r->'type', 60), 'lang', private.txt(r->'lang', 40),
      'tasks', private.num(r->'tasks'), 'hours', private.num(r->'hours'),
      'q', case when r->'q' is null or jsonb_typeof(r->'q') = 'null' then 'null'::jsonb else private.num(r->'q') end)
    end order by ord), '[]'::jsonb)
  from jsonb_array_elements(p_rows) with ordinality as t(r, ord)
  where jsonb_typeof(r) = 'object'
$$;

-- ---------- functions visitors can call ----------

-- Check the upload password. Returns {ok:true, token, expiresAt} or {ok:false, error, retryIn}.
-- Returns instead of raising so a wrong guess is still counted.
create or replace function public.upload_login(p_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := private.client_ip();
  v_lock timestamptz;
  v_hash text;
  v_tok  text;
  v_exp  timestamptz := now() + interval '12 hours';
begin
  select locked_until into v_lock from private.login_attempts where ip = v_ip;
  if v_lock > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'retryIn', ceil(extract(epoch from v_lock - now())));
  end if;

  select password_hash into v_hash from private.settings where id = 1;
  if v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'no_password');
  end if;
  if extensions.crypt('CHANGE-THIS-PASSWORD', v_hash) = v_hash then   -- placeholder never works
    return jsonb_build_object('ok', false, 'error', 'default_password');
  end if;

  if p_password is null or length(p_password) > 200 or extensions.crypt(p_password, v_hash) <> v_hash then
    insert into private.login_attempts as a (ip, fails) values (v_ip, 1)
    on conflict (ip) do update set
      fails        = case when a.fails + 1 >= 5 then 0 else a.fails + 1 end,
      locked_until = case when a.fails + 1 >= 5 then now() + interval '60 seconds' else a.locked_until end;
    return jsonb_build_object('ok', false, 'error', 'wrong');
  end if;

  delete from private.login_attempts where ip = v_ip;
  delete from private.sessions where expires_at < now();
  v_tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sessions (token_hash, expires_at) values (extensions.digest(v_tok, 'sha256'), v_exp);
  return jsonb_build_object('ok', true, 'token', v_tok, 'expiresAt', v_exp);
end $$;

create or replace function public.upload_check(p_token text) returns boolean
language sql security definer set search_path = '' as $$
  select private.session_ok(p_token)
$$;

create or replace function public.upload_logout(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from private.sessions where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
$$;

-- Save 1–3 parsed files plus their originals in one transaction, then return the new shared state.
-- p_files: [{kind:'map'|'margin'|'grey', name, b64, rows:[...]}]
create or replace function public.save_dashboard(p_token text, p_files jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f      jsonb;
  v_kind text;
  v_seen text[] := '{}';
  v_st   jsonb;
  v_at   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_bin  bytea;
  v_rows jsonb;
  v_name text;
  v_id   bigint;
  v_meta jsonb;
begin
  if not private.session_ok(p_token) then
    raise exception using errcode = 'PT401', message = 'Your upload session has ended. Enter the password again.';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 3 then
    raise exception using errcode = 'PT400', message = 'Send between one and three files.';
  end if;

  select data into v_st from public.dashboard_state where id = 1 for update;

  for f in select value from jsonb_array_elements(p_files) loop
    v_kind := f->>'kind';
    if v_kind is null or v_kind not in ('map','margin','grey') or v_kind = any(v_seen) then
      raise exception using errcode = 'PT400', message = 'Unknown or repeated file type.';
    end if;
    v_seen := v_seen || v_kind;

    if jsonb_typeof(f->'rows') is distinct from 'array' or jsonb_array_length(f->'rows') not between 1 and 200000 then
      raise exception using errcode = 'PT400', message = format('The %s file has no usable rows or too many rows.', v_kind);
    end if;
    begin
      v_bin := decode(coalesce(f->>'b64', ''), 'base64');
    exception when others then
      raise exception using errcode = 'PT400', message = format('The %s original file could not be read.', v_kind);
    end;
    if length(v_bin) = 0 or length(v_bin) > 10 * 1024 * 1024 then
      raise exception using errcode = 'PT400', message = format('The %s file is empty or over 10 MB.', v_kind);
    end if;

    v_rows := private.clean_rows(v_kind, f->'rows');
    v_name := left(coalesce(nullif(trim(f->>'name'), ''), v_kind || '.xlsx'), 200);
    insert into private.original_files (kind, name, size, content)
      values (v_kind, v_name, length(v_bin), v_bin) returning id into v_id;

    v_meta := jsonb_build_object('kind', v_kind, 'name', v_name, 'size', length(v_bin), 'at', v_at, 'orig', v_id);
    v_st := jsonb_set(v_st, array['datasets', v_kind], jsonb_build_object('rows', v_rows, 'file', v_meta - 'kind'), true);
    -- keep the last 50 uploads listed in the page; every original stays in private.original_files
    v_st := jsonb_set(v_st, '{history}', (
      select coalesce(jsonb_agg(h order by o), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_st->'history', '[]'::jsonb) || jsonb_build_array(v_meta)) with ordinality x(h, o)
      where o > jsonb_array_length(coalesce(v_st->'history', '[]'::jsonb)) + 1 - 50), true);
  end loop;

  v_st := jsonb_set(v_st, '{updatedAt}', to_jsonb(v_at), true);
  update public.dashboard_state set data = v_st, updated_at = now() where id = 1;
  return v_st;
end $$;

-- Download one stored original (upload password required).
create or replace function public.get_original(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not private.session_ok(p_token) then
    raise exception using errcode = 'PT401', message = 'Enter the upload password to download original files.';
  end if;
  select name, replace(encode(content, 'base64'), E'\n', '') as b64 into r from private.original_files where id = p_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'File not found.';
  end if;
  return jsonb_build_object('name', r.name, 'b64', r.b64);
end $$;

-- ---------- permissions ----------
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.upload_login(text), public.upload_check(text), public.upload_logout(text),
                       public.save_dashboard(text, jsonb), public.get_original(text, bigint) from public, anon, authenticated;
grant execute on function public.upload_login(text), public.upload_check(text), public.upload_logout(text),
                          public.save_dashboard(text, jsonb), public.get_original(text, bigint) to anon, authenticated;

-- =====================================================================
--  UPLOAD PASSWORD — change the text below, then run (this file or just these lines).
--  Running it again with a new password replaces the old one and signs everyone out.
-- =====================================================================
insert into private.settings (id, password_hash)
values (1, extensions.crypt('CHANGE-THIS-PASSWORD', extensions.gen_salt('bf', 10)))
on conflict (id) do update set password_hash = excluded.password_hash;
delete from private.sessions;
