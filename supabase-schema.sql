-- Jiwon Heo homepage board schema for Supabase
--
-- How to run:
--   1. Open the Supabase dashboard for this project.
--   2. Go to SQL Editor -> New query.
--   3. Paste this entire file and choose Run.
--
-- This file contains no API keys or client secrets and is safe to keep with the
-- static site. It can be run again after a successful first run.

create table if not exists public.board_messages (
    id uuid primary key default gen_random_uuid(),
    client_request_id uuid not null,
    parent_id uuid references public.board_messages (id) on delete cascade,
    author_id uuid not null references auth.users (id) on delete cascade,
    author_name text not null,
    author_email text,
    body text not null,
    image_path text,
    status text not null default 'published',
    created_at timestamptz not null default now(),
    edited_at timestamptz,
    deleted_at timestamptz,

    constraint board_messages_not_own_parent
        check (parent_id is null or parent_id <> id),
    constraint board_messages_author_name_length
        check (
            char_length(btrim(author_name)) between 1 and 320
            and octet_length(author_name) <= 1280
        ),
    constraint board_messages_body_length
        check (
            char_length(
                regexp_replace(body, '^[[:space:]]+|[[:space:]]+$', '', 'g')
            ) between 1 and 2000
            and octet_length(body) <= 8000
        ),
    constraint board_messages_status
        check (status in ('published', 'hidden')),
    constraint board_messages_author_email
        check (
            author_email is null
            or (
                char_length(author_email) between 3 and 320
                and author_email !~ '[[:space:]]'
                and author_email like '%@%'
            )
        ),
    constraint board_messages_edit_dates
        check (
            (edited_at is null or edited_at >= created_at)
            and (deleted_at is null or deleted_at >= created_at)
        ),
    constraint board_messages_deleted_tombstone
        check (
            deleted_at is null
            or (
                parent_id is null
                and author_name = 'Deleted'
                and author_email is null
                and body = '(Deleted message)'
                and image_path is null
            )
        )
);

-- Keep this file safe to re-run if an earlier version of the table already
-- exists. Legacy rows receive a request id before the column becomes required.
alter table public.board_messages
    add column if not exists client_request_id uuid;
update public.board_messages
set client_request_id = gen_random_uuid()
where client_request_id is null;
alter table public.board_messages
    alter column client_request_id set not null;

alter table public.board_messages
    add column if not exists image_path text;

alter table public.board_messages
    add column if not exists author_email text;
alter table public.board_messages
    add column if not exists edited_at timestamptz;
alter table public.board_messages
    add column if not exists deleted_at timestamptz;

alter table public.board_messages
    drop constraint if exists board_messages_author_name_length;
alter table public.board_messages
    add constraint board_messages_author_name_length
    check (
        char_length(btrim(author_name)) between 1 and 320
        and octet_length(author_name) <= 1280
    );

-- Legacy comments keep author_email null because those authors posted before
-- the public mail-link notice existed. Only new comments created through the
-- updated RPC publish a verified Google email.

alter table public.board_messages
    drop constraint if exists board_messages_author_email;
alter table public.board_messages
    add constraint board_messages_author_email
    check (
        author_email is null
        or (
            char_length(author_email) between 3 and 320
            and author_email !~ '[[:space:]]'
            and author_email like '%@%'
        )
    );

alter table public.board_messages
    drop constraint if exists board_messages_edit_dates;
alter table public.board_messages
    add constraint board_messages_edit_dates
    check (
        (edited_at is null or edited_at >= created_at)
        and (deleted_at is null or deleted_at >= created_at)
    );

alter table public.board_messages
    drop constraint if exists board_messages_body_length;
alter table public.board_messages
    add constraint board_messages_body_length
    check (
        char_length(
            regexp_replace(body, '^[[:space:]]+|[[:space:]]+$', '', 'g')
        ) between 1 and 2000
        and octet_length(body) <= 8000
    );

-- An attachment is allowed only on a top-level message, and its path is tied
-- to a server-issued opaque path. Ownership and the request id remain in the
-- private reservation table; the extension is selected by that function.
alter table public.board_messages
    drop constraint if exists board_messages_image_path;
alter table public.board_messages
    add constraint board_messages_image_path
    check (
        image_path is null
        or (
            parent_id is null
            and image_path ~ '^requests/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
        )
    );

alter table public.board_messages
    drop constraint if exists board_messages_deleted_tombstone;
alter table public.board_messages
    add constraint board_messages_deleted_tombstone
    check (
        deleted_at is null
        or (
            parent_id is null
            and author_name = 'Deleted'
            and author_email is null
            and body = '(Deleted message)'
            and image_path is null
        )
    );

comment on table public.board_messages is
    'Public homepage board messages. A null parent_id is a post; a non-null parent_id is a reply.';

create index if not exists board_messages_created_at_idx
    on public.board_messages (created_at);

create index if not exists board_messages_parent_created_at_idx
    on public.board_messages (parent_id, created_at);

create index if not exists board_messages_author_created_at_idx
    on public.board_messages (author_id, created_at desc);

create unique index if not exists board_messages_author_request_idx
    on public.board_messages (author_id, client_request_id);

create unique index if not exists board_messages_image_path_idx
    on public.board_messages (image_path)
    where image_path is not null;

alter table public.board_messages enable row level security;

-- Start from a deny-by-default privilege state. Public clients receive only the
-- columns required to render the board; author_id remains server-side.
revoke all on table public.board_messages from public, anon, authenticated;
revoke select (id, client_request_id, parent_id, author_id, author_name, author_email, body, image_path, status, created_at, edited_at, deleted_at),
       insert (id, client_request_id, parent_id, author_id, author_name, author_email, body, image_path, status, created_at, edited_at, deleted_at),
       update (id, client_request_id, parent_id, author_id, author_name, author_email, body, image_path, status, created_at, edited_at, deleted_at),
       references (id, client_request_id, parent_id, author_id, author_name, author_email, body, image_path, status, created_at, edited_at, deleted_at)
    on table public.board_messages from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select (id, parent_id, author_name, author_email, body, image_path, created_at, edited_at, deleted_at)
    on table public.board_messages to anon, authenticated;

drop policy if exists board_messages_public_read on public.board_messages;
create policy board_messages_public_read
    on public.board_messages
    for select
    to anon, authenticated
    using (status = 'published');

-- Moderation is controlled by a private, server-side allowlist. Matching is
-- performed against the confirmed Auth email and an actual Google identity;
-- browser-supplied names, emails, JWT user metadata, and UI state are never
-- trusted for administrator authorization.
create table if not exists public.board_admin_allowlist (
    email text primary key,
    created_at timestamptz not null default now(),

    constraint board_admin_allowlist_email
        check (
            email = pg_catalog.lower(pg_catalog.btrim(email))
            and char_length(email) between 3 and 320
            and email !~ '[[:space:]]'
            and email like '%@%'
        )
);

alter table public.board_admin_allowlist enable row level security;
revoke all on table public.board_admin_allowlist
    from public, anon, authenticated;

-- Site-owner account advertised by this homepage. Add or remove rows in this
-- table from the Supabase SQL Editor to transfer or share moderation access.
insert into public.board_admin_allowlist (email)
values ('4865sj@gmail.com')
on conflict (email) do nothing;

-- Keep moderation exclusive to the site-owner account on every schema rerun.
-- Remove this DELETE if multiple moderators are intentionally added later.
delete from public.board_admin_allowlist
where email <> '4865sj@gmail.com';

create or replace function public.is_board_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select auth.uid() is not null
       and exists (
            select 1
            from auth.users as account
            join lateral (
                select google_identity.identity_data
                from auth.identities as google_identity
                where google_identity.user_id = account.id
                  and google_identity.provider = 'google'
                order by google_identity.last_sign_in_at desc nulls last,
                         google_identity.created_at asc
                limit 1
            ) as google_account on true
            join public.board_admin_allowlist as administrator
              on administrator.email = pg_catalog.lower(
                    pg_catalog.btrim(
                        google_account.identity_data ->> 'email'
                    )
                 )
            where account.id = auth.uid()
              and account.email_confirmed_at is not null
       );
$function$;

comment on function public.is_board_admin() is
    'Checks the private allowlist against the current verified Google account.';

revoke all on function public.is_board_admin()
    from public, anon, authenticated;
grant execute on function public.is_board_admin()
    to authenticated;

-- Store public puzzle-request images outside PostgreSQL. Bucket restrictions
-- are authoritative; the browser-side accept and size checks are only UX.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'board-images',
    'board-images',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- A short-lived reservation gives a signed-in user one exact object path. It
-- keeps the Storage policy independent of user-supplied file names and also
-- provides an account-level rate limit before any bytes are accepted.
create table if not exists public.board_image_uploads (
    author_id uuid not null references auth.users (id) on delete cascade,
    request_id uuid not null,
    object_path text not null,
    mime_type text not null,
    created_at timestamptz not null default now(),
    consumed_at timestamptz,

    primary key (author_id, request_id),

    constraint board_image_uploads_mime_type
        check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
    constraint board_image_uploads_path
        check (
            object_path ~ '^requests/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
            and object_path like '%' || case mime_type
                when 'image/jpeg' then '.jpg'
                when 'image/png' then '.png'
                when 'image/webp' then '.webp'
            end
        )
);

-- Replace the path rule when re-running this pre-deployment schema. If an
-- author-id-based upload schema was ever used in production, migrate its
-- objects through the Storage API before applying this opaque-path version.
alter table public.board_image_uploads
    drop constraint if exists board_image_uploads_path;
alter table public.board_image_uploads
    add constraint board_image_uploads_path
    check (
        object_path ~ '^requests/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
        and object_path like '%' || case mime_type
            when 'image/jpeg' then '.jpg'
            when 'image/png' then '.png'
            when 'image/webp' then '.webp'
        end
    );

create unique index if not exists board_image_uploads_path_idx
    on public.board_image_uploads (object_path);

create index if not exists board_image_uploads_author_created_idx
    on public.board_image_uploads (author_id, created_at desc);

alter table public.board_image_uploads enable row level security;
revoke all on table public.board_image_uploads
    from public, anon, authenticated;

-- Durable cleanup queue for attachments unlinked by message deletion. The
-- browser may lose the delete RPC response, so the path must remain recoverable
-- server-side until the Storage API confirms removal.
create table if not exists public.board_image_cleanup_queue (
    object_path text primary key,
    requested_by uuid not null references auth.users (id) on delete cascade,
    requested_at timestamptz not null default now(),

    constraint board_image_cleanup_queue_path
        check (
            object_path ~ '^requests/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
        )
);

alter table public.board_image_cleanup_queue enable row level security;
revoke all on table public.board_image_cleanup_queue
    from public, anon, authenticated;

drop function if exists public.get_board_image_cleanup_queue();
create function public.get_board_image_cleanup_queue()
returns table (image_path text)
language sql
stable
security definer
set search_path = ''
as $function$
    select cleanup.object_path
    from public.board_image_cleanup_queue as cleanup
    where cleanup.requested_by = auth.uid()
       or public.is_board_admin()
    order by cleanup.requested_at
    limit 100;
$function$;

revoke all on function public.get_board_image_cleanup_queue()
    from public, anon;
grant execute on function public.get_board_image_cleanup_queue()
    to authenticated;

drop function if exists public.confirm_board_image_cleanup(text);
create function public.confirm_board_image_cleanup(p_image_path text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_deleted boolean;
begin
    delete from public.board_image_cleanup_queue as cleanup
    where cleanup.object_path = p_image_path
      and (cleanup.requested_by = auth.uid() or public.is_board_admin())
      and not exists (
            select 1
            from storage.objects as stored_object
            where stored_object.bucket_id = 'board-images'
              and stored_object.name = p_image_path
      );
    v_deleted := found;
    return v_deleted;
end;
$function$;

revoke all on function public.confirm_board_image_cleanup(text)
    from public, anon;
grant execute on function public.confirm_board_image_cleanup(text)
    to authenticated;

drop function if exists public.prepare_board_image_upload(uuid, text);
create function public.prepare_board_image_upload(
    p_request_id uuid,
    p_mime_type text
)
returns table (
    image_path text,
    mime_type text,
    already_consumed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_mime_type text;
    v_extension text;
    v_path text;
    v_existing_mime text;
    v_existing_created_at timestamptz;
    v_existing_consumed_at timestamptz;
begin
    if v_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Google sign-in is required to upload an image.';
    end if;

    if p_request_id is null then
        raise exception using
            errcode = '22023',
            message = 'A request id is required.';
    end if;

    -- Match the posting RPC: enabling another Auth provider later must not
    -- accidentally grant board-upload access.
    if not exists (
        select 1
        from auth.users as u
        join auth.identities as google_identity
          on google_identity.user_id = u.id
         and google_identity.provider = 'google'
        where u.id = v_user_id
          and u.email_confirmed_at is not null
    ) then
        raise exception using
            errcode = '42501',
            message = 'A verified Google account is required to upload an image.';
    end if;

    v_mime_type := lower(btrim(coalesce(p_mime_type, '')));
    v_extension := case v_mime_type
        when 'image/jpeg' then '.jpg'
        when 'image/png' then '.png'
        when 'image/webp' then '.webp'
        else null
    end;

    if v_extension is null then
        raise exception using
            errcode = '22023',
            message = 'Only JPEG, PNG, and WebP images are allowed.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('board-image:' || v_user_id::text, 0)
    );

    select
        upload.object_path,
        upload.mime_type,
        upload.created_at,
        upload.consumed_at
    into
        v_path,
        v_existing_mime,
        v_existing_created_at,
        v_existing_consumed_at
    from public.board_image_uploads as upload
    where upload.author_id = v_user_id
      and upload.request_id = p_request_id;

    -- Retrying a reservation is safe. A completed request tells the client to
    -- skip a duplicate upload and call create_board_message idempotently.
    if found then
        if v_existing_mime <> v_mime_type then
            raise exception using
                errcode = '22023',
                message = 'This request id is already reserved for another image type.';
        end if;

        if v_existing_consumed_at is null
           and v_existing_created_at <= now() - interval '20 minutes' then
            raise exception using
                errcode = 'P0001',
                message = 'The image upload reservation expired.';
        end if;

        return query
        select
            v_path,
            v_existing_mime,
            v_existing_consumed_at is not null;
        return;
    end if;

    if (
        select count(*)
        from public.board_image_uploads as recent_upload
        where recent_upload.author_id = v_user_id
          and recent_upload.created_at > now() - interval '1 hour'
    ) >= 3
    or (
        select count(*)
        from public.board_image_uploads as recent_upload
        where recent_upload.author_id = v_user_id
          and recent_upload.created_at > now() - interval '24 hours'
    ) >= 10 then
        raise exception using
            errcode = 'P0001',
            message = 'Please wait before uploading another image.';
    end if;

    -- The public object URL must not expose the stable Auth user UUID. The
    -- reservation table remains the server-side owner mapping.
    v_path := 'requests/' || gen_random_uuid()::text || v_extension;

    return query
    insert into public.board_image_uploads as upload (
        author_id,
        request_id,
        object_path,
        mime_type
    )
    values (
        v_user_id,
        p_request_id,
        v_path,
        v_mime_type
    )
    returning
        upload.object_path,
        upload.mime_type,
        false;
end;
$function$;

comment on function public.prepare_board_image_upload(uuid, text) is
    'Reserves one short-lived, owner-bound Storage path for a board image.';

revoke all on function public.prepare_board_image_upload(uuid, text) from public;
revoke all on function public.prepare_board_image_upload(uuid, text) from anon;
grant execute on function public.prepare_board_image_upload(uuid, text)
    to authenticated;

-- Drop our policies before replacing their helper functions so this file can
-- be run repeatedly without dependency errors.
drop policy if exists board_images_reserved_insert on storage.objects;
drop policy if exists board_images_select_linked_or_owner on storage.objects;
drop policy if exists board_images_owner_select_for_delete on storage.objects;
drop policy if exists board_images_owner_delete_unlinked on storage.objects;
drop policy if exists board_images_no_update on storage.objects;

drop function if exists public.can_upload_board_image(text);
drop function if exists public.can_select_board_image(text, text);
drop function if exists public.can_delete_unlinked_board_image(text, text);

create function public.can_upload_board_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select auth.uid() is not null
        and exists (
            select 1
            from public.board_image_uploads as upload
            where upload.author_id = auth.uid()
              and upload.object_path = p_name
              and upload.consumed_at is null
              and upload.created_at > now() - interval '20 minutes'
       );
$function$;

create function public.can_delete_unlinked_board_image(
    p_name text,
    p_owner_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select auth.uid() is not null
       and (
            p_owner_id = auth.uid()::text
            or public.is_board_admin()
       )
       and exists (
            select 1
            from public.board_image_uploads as upload
            where upload.object_path = p_name
              and (
                    upload.author_id = auth.uid()
                    or public.is_board_admin()
              )
              and (
                    upload.consumed_at is null
                    or exists (
                        select 1
                        from public.board_image_cleanup_queue as cleanup
                        where cleanup.object_path = p_name
                          and (
                                cleanup.requested_by = auth.uid()
                                or public.is_board_admin()
                          )
                    )
              )
       )
       and not exists (
            select 1
            from public.board_messages as message
            where message.image_path = p_name
       );
$function$;

revoke all on function public.can_upload_board_image(text)
    from public, anon, authenticated;
revoke all on function public.can_delete_unlinked_board_image(text, text)
    from public, anon, authenticated;

grant execute on function public.can_upload_board_image(text)
    to authenticated;
grant execute on function public.can_delete_unlinked_board_image(text, text)
    to authenticated;

create policy board_images_reserved_insert
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'board-images'
        and owner_id = auth.uid()::text
        and public.can_upload_board_image(name)
    );

-- Supabase's delete endpoints read and return the matching object row. Permit
-- SELECT only while the Storage API is performing a delete operation; this
-- does not allow listing the bucket or reading object metadata separately.
create policy board_images_owner_select_for_delete
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'board-images'
        and storage.allow_any_operation(array[
            'storage.object.delete',
            'storage.object.delete_many'
        ])
        and public.can_delete_unlinked_board_image(name, owner_id)
    );

create policy board_images_owner_delete_unlinked
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'board-images'
        and public.can_delete_unlinked_board_image(name, owner_id)
    );

-- The deletion RPC first removes the database reference and returns the former
-- path. Its caller then removes the bytes through the Storage API. The helper
-- above permits that cleanup for the original owner or a verified board admin,
-- including attachments that had already been consumed by a published post.

-- There is intentionally no UPDATE policy. Uploads must use x-upsert=false,
-- so even the owner cannot replace an image after receiving its path.

-- There is deliberately no INSERT, UPDATE, or DELETE policy on board_messages.
-- Posts are created
-- only through this function, so clients cannot forge author_id, author_name,
-- publication status, or timestamps. The function also restricts replies to
-- one level beneath a published top-level post.
drop function if exists public.create_board_message(text, uuid);
drop function if exists public.create_board_message(text, uuid, uuid);
drop function if exists public.create_board_message(text, uuid, uuid, text);
drop function if exists public.create_board_message(text, uuid, uuid, text, text);

create function public.create_board_message(
    p_body text,
    p_parent_id uuid,
    p_request_id uuid,
    p_image_path text,
    p_author_name text
)
returns table (
    id uuid,
    parent_id uuid,
    author_name text,
    author_email text,
    body text,
    image_path text,
    created_at timestamptz,
    edited_at timestamptz,
    deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_author_name text;
    v_author_email text;
    v_requested_name text;
    v_body text;
    v_message_id uuid;
    v_existing_message public.board_messages%rowtype;
begin
    if v_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Google sign-in is required to post.';
    end if;

    if p_request_id is null then
        raise exception using
            errcode = '22023',
            message = 'A request id is required.';
    end if;

    v_body := regexp_replace(
        p_body,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
    );

    if p_body is null
       or char_length(v_body) < 1
       or char_length(v_body) > 2000
       or octet_length(v_body) > 8000 then
        raise exception using
            errcode = '22023',
            message = 'A message must contain between 1 and 2000 characters.';
    end if;

    -- The public mailto target comes only from the provider-owned Google
    -- identity. It is never accepted as an RPC argument or read from editable
    -- user metadata.
    select pg_catalog.lower(
        pg_catalog.btrim(google_account.identity_data ->> 'email')
    )
    into v_author_email
    from auth.users as u
    join lateral (
        select google_identity.identity_data
        from auth.identities as google_identity
        where google_identity.user_id = u.id
          and google_identity.provider = 'google'
        order by google_identity.last_sign_in_at desc nulls last,
                 google_identity.created_at asc
        limit 1
    ) as google_account on true
    where u.id = v_user_id
      and u.email_confirmed_at is not null;

    if v_author_email is null
       or octet_length(v_author_email) not between 3 and 320
       or v_author_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
       or v_author_email ~ '[[:cntrl:]]' then
        raise exception using
            errcode = '42501',
            message = 'A verified Google email is required to post.';
    end if;

    v_requested_name := regexp_replace(
        coalesce(p_author_name, ''),
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
    );

    -- A blank field deliberately falls back to the verified public email. A
    -- supplied display name follows the leaderboard's public-name rules.
    if v_requested_name = '' then
        v_author_name := v_author_email;
    elsif char_length(v_requested_name) not between 1 and 40
       or octet_length(v_requested_name) > 160
       or v_requested_name ~ '[[:cntrl:]]'
       or strpos(v_requested_name, '@') > 0 then
        raise exception using
            errcode = '22023',
            message = 'Enter a public name of 1 to 40 characters without an email address.';
    else
        v_author_name := v_requested_name;
    end if;

    -- Serialize posts from the same account and apply a modest write limit.
    -- This is not a substitute for moderation, but it prevents accidental or
    -- scripted bursts from one signed-in account.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text, 0)
    );

    -- Retrying the same browser request returns the original row instead of
    -- creating a duplicate after a slow or interrupted network response.
    select existing_message.*
    into v_existing_message
    from public.board_messages as existing_message
    where existing_message.author_id = v_user_id
      and existing_message.client_request_id = p_request_id;

    if found then
        if v_existing_message.parent_id is distinct from p_parent_id
           or v_existing_message.body is distinct from v_body
           or v_existing_message.image_path is distinct from p_image_path
           or v_existing_message.author_name is distinct from v_author_name then
            raise exception using
                errcode = '22023',
                message = 'This request id was already used for a different message.';
        end if;

        return query
        select
            v_existing_message.id,
            v_existing_message.parent_id,
            v_existing_message.author_name,
            v_existing_message.author_email,
            v_existing_message.body,
            v_existing_message.image_path,
            v_existing_message.created_at,
            v_existing_message.edited_at,
            v_existing_message.deleted_at;
        return;
    end if;

    if (
        select count(*)
        from public.board_messages as recent_message
        where recent_message.author_id = v_user_id
          and recent_message.created_at > now() - interval '5 minutes'
    ) >= 5 then
        raise exception using
            errcode = 'P0001',
            message = 'Please wait a few minutes before posting again.';
    end if;

    if p_parent_id is not null then
        -- Serialize reply creation with deletion of the same thread. Either
        -- the reply commits first and the root becomes a tombstone, or the
        -- root is removed first and this request is rejected cleanly.
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'board-thread:' || p_parent_id::text,
                0
            )
        );
    end if;

    if p_parent_id is not null
       and not exists (
           select 1
           from public.board_messages as parent
           where parent.id = p_parent_id
             and parent.parent_id is null
             and parent.status = 'published'
             and parent.deleted_at is null
       ) then
        raise exception using
            errcode = '23503',
            message = 'Replies must reference a published top-level message.';
    end if;

    if p_image_path is not null and p_parent_id is not null then
        raise exception using
            errcode = '22023',
            message = 'Images can only be attached to top-level messages.';
    end if;

    -- The browser supplies only the path returned by the reservation RPC.
    -- Re-check the reservation, Storage-owned owner_id, MIME metadata, and
    -- byte size here so forged RPC arguments can never attach another user's
    -- object or a non-image object.
    if p_image_path is not null
       and not exists (
            select 1
            from public.board_image_uploads as upload
            join storage.objects as object
              on object.bucket_id = 'board-images'
             and object.name = upload.object_path
            where upload.author_id = v_user_id
              and upload.request_id = p_request_id
              and upload.object_path = p_image_path
              and upload.consumed_at is null
              and upload.created_at > now() - interval '20 minutes'
              and object.owner_id = v_user_id::text
              and coalesce((object.metadata ->> 'size')::bigint, 0)
                    between 1 and 5242880
              and lower(coalesce(object.metadata ->> 'mimetype', ''))
                    = upload.mime_type
       ) then
        raise exception using
            errcode = '22023',
            message = 'The uploaded image is missing or invalid.';
    end if;

    insert into public.board_messages as message (
        client_request_id,
        parent_id,
        author_id,
        author_name,
        author_email,
        body,
        image_path,
        status
    )
    values (
        p_request_id,
        p_parent_id,
        v_user_id,
        v_author_name,
        v_author_email,
        v_body,
        p_image_path,
        'published'
    )
    returning message.id into v_message_id;

    if p_image_path is not null then
        update public.board_image_uploads as upload
        set consumed_at = now()
        where upload.author_id = v_user_id
          and upload.request_id = p_request_id
          and upload.object_path = p_image_path
          and upload.consumed_at is null;

        if not found then
            raise exception using
                errcode = 'P0001',
                message = 'The image upload reservation has already been used.';
        end if;
    end if;

    return query
    select
        message.id,
        message.parent_id,
        message.author_name,
        message.author_email,
        message.body,
        message.image_path,
        message.created_at,
        message.edited_at,
        message.deleted_at
    from public.board_messages as message
    where message.id = v_message_id;
end;
$function$;

comment on function public.create_board_message(text, uuid, uuid, text, text) is
    'Creates a published board post or reply, optionally consuming a verified top-level image upload.';

-- PostgreSQL grants function execution to PUBLIC by default, so remove it and
-- allow only authenticated API requests. No secret or service-role key belongs
-- in browser code; the public publishable key plus a user access token is enough.
revoke all on function public.create_board_message(text, uuid, uuid, text, text) from public;
revoke all on function public.create_board_message(text, uuid, uuid, text, text) from anon;
grant execute on function public.create_board_message(text, uuid, uuid, text, text)
    to authenticated;

-- Compatibility wrapper for clients deployed before custom public names were
-- added. A missing name is intentionally rendered as the verified email.
create function public.create_board_message(
    p_body text,
    p_parent_id uuid,
    p_request_id uuid,
    p_image_path text
)
returns table (
    id uuid,
    parent_id uuid,
    author_name text,
    author_email text,
    body text,
    image_path text,
    created_at timestamptz,
    edited_at timestamptz,
    deleted_at timestamptz
)
language sql
security invoker
set search_path = ''
as $function$
    select
        created_message.id,
        created_message.parent_id,
        created_message.author_name,
        created_message.author_email,
        created_message.body,
        created_message.image_path,
        created_message.created_at,
        created_message.edited_at,
        created_message.deleted_at
    from public.create_board_message(
        $1,
        $2,
        $3,
        $4,
        null::text
    ) as created_message;
$function$;

comment on function public.create_board_message(text, uuid, uuid, text) is
    'Compatibility wrapper that creates a board message using the verified email as its public name.';

revoke all on function public.create_board_message(text, uuid, uuid, text) from public;
revoke all on function public.create_board_message(text, uuid, uuid, text) from anon;
grant execute on function public.create_board_message(text, uuid, uuid, text)
    to authenticated;

-- Compatibility wrapper for the existing text-only client. It deliberately
-- exposes no image-path argument and delegates to the same protected function.
create function public.create_board_message(
    p_body text,
    p_parent_id uuid,
    p_request_id uuid
)
returns table (
    id uuid,
    parent_id uuid,
    author_name text,
    body text,
    created_at timestamptz
)
language sql
security invoker
set search_path = ''
as $function$
    select
        created_message.id,
        created_message.parent_id,
        created_message.author_name,
        created_message.body,
        created_message.created_at
    from public.create_board_message(
        $1,
        $2,
        $3,
        null::text
    ) as created_message;
$function$;

comment on function public.create_board_message(text, uuid, uuid) is
    'Compatibility wrapper that creates a text-only board message.';

revoke all on function public.create_board_message(text, uuid, uuid) from public;
revoke all on function public.create_board_message(text, uuid, uuid) from anon;
grant execute on function public.create_board_message(text, uuid, uuid)
    to authenticated;

-- Only the author can edit a live message. Authorization is derived from the
-- access token inside the database; author ids never need to be exposed to the
-- browser. Attachments, identity, threading, and creation time are immutable.
drop function if exists public.update_board_message(uuid, text);
create function public.update_board_message(
    p_message_id uuid,
    p_body text
)
returns table (
    id uuid,
    parent_id uuid,
    author_name text,
    author_email text,
    body text,
    image_path text,
    created_at timestamptz,
    edited_at timestamptz,
    deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_body text;
    v_message public.board_messages%rowtype;
begin
    if v_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Google sign-in is required to edit a message.';
    end if;

    if p_message_id is null then
        raise exception using
            errcode = '22023',
            message = 'A message id is required.';
    end if;

    v_body := regexp_replace(
        p_body,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
    );

    if p_body is null
       or char_length(v_body) < 1
       or char_length(v_body) > 2000
       or octet_length(v_body) > 8000 then
        raise exception using
            errcode = '22023',
            message = 'A message must contain between 1 and 2000 characters.';
    end if;

    select message.*
    into v_message
    from public.board_messages as message
    where message.id = p_message_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'The message no longer exists.';
    end if;

    if v_message.author_id <> v_user_id then
        raise exception using
            errcode = '42501',
            message = 'Only the author can edit this message.';
    end if;

    if v_message.status <> 'published'
       or v_message.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'A deleted or hidden message cannot be edited.';
    end if;

    update public.board_messages as message
    set body = v_body,
        edited_at = pg_catalog.clock_timestamp()
    where message.id = p_message_id;

    return query
    select
        message.id,
        message.parent_id,
        message.author_name,
        message.author_email,
        message.body,
        message.image_path,
        message.created_at,
        message.edited_at,
        message.deleted_at
    from public.board_messages as message
    where message.id = p_message_id;
end;
$function$;

comment on function public.update_board_message(uuid, text) is
    'Edits the current author''s live board message and records edited_at.';

revoke all on function public.update_board_message(uuid, text)
    from public, anon, authenticated;
grant execute on function public.update_board_message(uuid, text)
    to authenticated;

-- Return only the controls the current viewer is authorized to use. This keeps
-- author_id private while allowing the UI to expose owner edit/delete actions
-- and site-owner moderation actions without guessing from display data.
drop function if exists public.get_board_message_permissions();
create function public.get_board_message_permissions()
returns table (
    message_id uuid,
    can_edit boolean,
    can_delete boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
    select
        message.id,
        message.author_id = auth.uid(),
        message.author_id = auth.uid() or public.is_board_admin()
    from public.board_messages as message
    where auth.uid() is not null
      and message.status = 'published'
      and message.deleted_at is null
      and (
            message.author_id = auth.uid()
            or public.is_board_admin()
      );
$function$;

comment on function public.get_board_message_permissions() is
    'Returns edit/delete capabilities for visible messages without exposing author ids.';

revoke all on function public.get_board_message_permissions()
    from public, anon, authenticated;
grant execute on function public.get_board_message_permissions()
    to authenticated;

-- Owners and allowlisted administrators share one deletion path. A message
-- without replies is removed completely. A top-level message with replies is
-- anonymized into a visible tombstone so its replies retain their context.
-- The former image path is returned for a follow-up Storage API deletion.
drop function if exists public.delete_board_message(uuid);
create function public.delete_board_message(p_message_id uuid)
returns table (
    message_id uuid,
    deletion_mode text,
    image_path text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_is_admin boolean;
    v_thread_id uuid;
    v_message public.board_messages%rowtype;
    v_image_path text;
    v_has_replies boolean;
begin
    if v_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Google sign-in is required to delete a message.';
    end if;

    if p_message_id is null then
        raise exception using
            errcode = '22023',
            message = 'A message id is required.';
    end if;

    select coalesce(message.parent_id, message.id)
    into v_thread_id
    from public.board_messages as message
    where message.id = p_message_id;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'The message no longer exists.';
    end if;

    -- Reply creation and every deletion within a thread take the same lock.
    -- This makes the hard-delete/tombstone decision deterministic.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'board-thread:' || v_thread_id::text,
            0
        )
    );

    select message.*
    into v_message
    from public.board_messages as message
    where message.id = p_message_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'The message no longer exists.';
    end if;

    v_is_admin := public.is_board_admin();
    if v_message.author_id <> v_user_id and not v_is_admin then
        raise exception using
            errcode = '42501',
            message = 'Only the author or site owner can delete this message.';
    end if;

    if v_message.status <> 'published' then
        raise exception using
            errcode = '55000',
            message = 'This message is not available for deletion.';
    end if;

    if v_message.deleted_at is not null then
        return query
        select v_message.id, 'tombstoned'::text, null::text;
        return;
    end if;

    v_image_path := v_message.image_path;
    select exists (
        select 1
        from public.board_messages as reply
        where reply.parent_id = v_message.id
    )
    into v_has_replies;

    if v_has_replies then
        if v_message.parent_id is not null then
            raise exception using
                errcode = '23514',
                message = 'Nested board replies require administrator repair.';
        end if;

        update public.board_messages as message
        set author_name = 'Deleted',
            author_email = null,
            body = '(Deleted message)',
            image_path = null,
            edited_at = null,
            deleted_at = pg_catalog.clock_timestamp()
        where message.id = v_message.id;

        if v_image_path is not null then
            insert into public.board_image_cleanup_queue (
                object_path,
                requested_by,
                requested_at
            ) values (
                v_image_path,
                v_user_id,
                pg_catalog.clock_timestamp()
            )
            on conflict (object_path) do update
            set requested_by = excluded.requested_by,
                requested_at = excluded.requested_at;
        end if;

        return query
        select v_message.id, 'tombstoned'::text, v_image_path;
        return;
    end if;

    delete from public.board_messages as message
    where message.id = v_message.id;

    if v_image_path is not null then
        insert into public.board_image_cleanup_queue (
            object_path,
            requested_by,
            requested_at
        ) values (
            v_image_path,
            v_user_id,
            pg_catalog.clock_timestamp()
        )
        on conflict (object_path) do update
        set requested_by = excluded.requested_by,
            requested_at = excluded.requested_at;
    end if;

    -- If the last remaining reply beneath an existing tombstone is removed,
    -- no conversation context remains and the tombstone can disappear too.
    if v_message.parent_id is not null then
        delete from public.board_messages as parent
        where parent.id = v_message.parent_id
          and parent.deleted_at is not null
          and not exists (
                select 1
                from public.board_messages as sibling
                where sibling.parent_id = parent.id
          );
    end if;

    return query
    select v_message.id, 'hard_deleted'::text, v_image_path;
end;
$function$;

comment on function public.delete_board_message(uuid) is
    'Deletes an owned/admin-selected message, preserving a tombstone only while replies exist.';

revoke all on function public.delete_board_message(uuid)
    from public, anon, authenticated;
grant execute on function public.delete_board_message(uuid)
    to authenticated;

-- Sliding-puzzle leaderboard -------------------------------------------------
--
-- Playing never requires authentication. For the current version the browser
-- first asks the database for a short-lived, opaque challenge containing a
-- server-generated solvable board, then keeps its own U/D/L/R blank-move
-- transcript. After solving, a user may authenticate with Google and submit
-- that exact challenge. The server replays the transcript from its private
-- copy of the board and derives the move count. A score is public only after
-- explicit consent to publish the verified Google email so the displayed
-- player name can act as a mailto link.
--
-- Hosted activation: run this section through the end of the file as one
-- script in the Supabase SQL Editor. The statements are upgrade-safe and
-- retain legacy puzzle runs and best scores.

create or replace function public.is_valid_puzzle_board(p_board smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $function$
    select coalesce(
        pg_catalog.array_ndims(p_board) = 1
        and pg_catalog.array_lower(p_board, 1) = 1
        -- Versions 1, 3, and 4 use 6x6 boards, while version 2 used 5x5.
        -- Keep both array sizes valid so legacy runs remain readable. The
        -- submission RPC below accepts new records only for version 4.
        and pg_catalog.cardinality(p_board) in (25, 36)
        and (
            select pg_catalog.count(*) = pg_catalog.cardinality(p_board)
               and pg_catalog.count(distinct tile) =
                   pg_catalog.cardinality(p_board)
               and pg_catalog.min(tile) = 0
               and pg_catalog.max(tile) =
                   pg_catalog.cardinality(p_board) - 1
            from pg_catalog.unnest(p_board) as board_tile(tile)
        ),
        false
    );
$function$;

revoke all on function public.is_valid_puzzle_board(smallint[])
    from public, anon, authenticated;

create table if not exists public.puzzle_images (
    image_key text primary key,
    title text not null,
    asset_path text not null unique,
    active boolean not null default true,
    leaderboard_enabled boolean not null default true,
    board_version integer not null default 4,
    start_board smallint[] not null,

    constraint puzzle_images_key
        check (image_key ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
    constraint puzzle_images_title
        check (char_length(btrim(title)) between 1 and 80),
    constraint puzzle_images_asset
        check (asset_path ~ '^puzzle-images/[A-Za-z0-9._-]+$'),
    constraint puzzle_images_board_version
        check (board_version between 1 and 2147483647),
    constraint puzzle_images_start_valid
        check (public.is_valid_puzzle_board(start_board))
);

-- Upgrade the earlier leaderboard schema without replacing registered boards
-- or deleting any runs or scores.
alter table public.puzzle_images
    add column if not exists board_version integer;
update public.puzzle_images
set board_version = 1
where board_version is null;
alter table public.puzzle_images
    alter column board_version set default 4;
alter table public.puzzle_images
    alter column board_version set not null;
alter table public.puzzle_images
    drop constraint if exists puzzle_images_board_version;
alter table public.puzzle_images
    add constraint puzzle_images_board_version
    check (board_version between 1 and 2147483647);

-- These version-4 registry rows identify the current ruleset. Their stored
-- start_board is a valid fallback/registration sentinel; ranked play uses a
-- fresh private challenge board generated by create_puzzle_challenge().
-- A future registry change must be deployed as an explicit migration. In
-- particular, increment board_version whenever start_board changes. Conflict
-- rows are intentionally left untouched so a schema re-run cannot undo an
-- operational disable, rename, asset change, or version migration.
insert into public.puzzle_images (
    image_key,
    title,
    asset_path,
    active,
    leaderboard_enabled,
    board_version,
    start_board
)
values
    (
        'speaki',
        'Speaki',
        'puzzle-images/Speaki.png',
        true,
        true,
        4,
        array[18,9,35,11,21,15,19,12,6,16,5,8,13,22,30,34,32,10,23,26,1,4,33,17,29,27,14,0,20,3,2,24,7,28,25,31]::smallint[]
    ),
    (
        'furina',
        'Furina',
        'puzzle-images/Furina.jpg',
        true,
        true,
        4,
        array[18,9,35,11,21,15,19,12,6,16,5,8,13,22,30,34,32,10,23,26,1,4,33,17,29,27,14,0,20,3,2,24,7,28,25,31]::smallint[]
    ),
    (
        'doro-doro-dororong',
        'DoroDoroDororong',
        'puzzle-images/DoroDoroDororong.png',
        true,
        true,
        4,
        array[18,9,35,11,21,15,19,12,6,16,5,8,13,22,30,34,32,10,23,26,1,4,33,17,29,27,14,0,20,3,2,24,7,28,25,31]::smallint[]
    ),
    (
        'jjiho',
        'Jjiho',
        'puzzle-images/Jjiho.png',
        true,
        true,
        4,
        array[18,9,35,11,21,15,19,12,6,16,5,8,13,22,30,34,32,10,23,26,1,4,33,17,29,27,14,0,20,3,2,24,7,28,25,31]::smallint[]
    ),
    (
        'twiing',
        'Twiing',
        'puzzle-images/Twiing.png',
        true,
        true,
        4,
        array[18,9,35,11,21,15,19,12,6,16,5,8,13,22,30,34,32,10,23,26,1,4,33,17,29,27,14,0,20,3,2,24,7,28,25,31]::smallint[]
    ),
    (
        'admin-test',
        'Admin test',
        'puzzle-images/Admin-test.png',
        true,
        false,
        4,
        array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,35,34]::smallint[]
    )
on conflict (image_key) do nothing;

-- Upgrade only the known version-1 6x6 registrations. Historical submission,
-- best-score, and run rows retain board_version = 1; the registry advances to
-- version 2 so current rankings and all new submissions use only the 5x5 board.
update public.puzzle_images
set board_version = 2,
    start_board =
        array[17,11,18,3,2,7,9,14,23,5,21,0,4,22,24,10,8,19,20,6,15,12,13,16,1]::smallint[]
where image_key in (
        'speaki',
        'furina',
        'doro-doro-dororong',
        'jjiho',
        'twiing'
    )
  and board_version = 1;

update public.puzzle_images
set board_version = 2,
    start_board =
        array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,23]::smallint[]
where image_key = 'admin-test'
  and board_version = 1;

-- Advance only the exact known version-2 registry to the version-3 6x6
-- board. The old rows in runs, submissions, and best scores keep their own
-- versions and remain intact; only the one current registry row advances.
update public.puzzle_images
set board_version = 3,
    start_board =
        array[18,9,35,11,21,15,19,12,6,16,5,8,13,22,30,34,32,10,23,26,1,4,33,17,29,27,14,0,20,3,2,24,7,28,25,31]::smallint[]
where image_key in (
        'speaki',
        'furina',
        'doro-doro-dororong',
        'jjiho',
        'twiing'
    )
  and board_version = 2
  and start_board =
        array[17,11,18,3,2,7,9,14,23,5,21,0,4,22,24,10,8,19,20,6,15,12,13,16,1]::smallint[];

update public.puzzle_images
set board_version = 3,
    start_board =
        array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,35,34]::smallint[]
where image_key = 'admin-test'
  and board_version = 2
  and start_board =
        array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,23]::smallint[];

-- Version 4 keeps the 6x6 rules but replaces the one shared layout with a
-- server-issued random challenge for every image click. Historical version-3
-- submissions and best-score rows retain their version; only the registry
-- advances, so current ranking queries cannot mix the two protocols.
update public.puzzle_images
set board_version = 4
where image_key in (
        'speaki',
        'furina',
        'doro-doro-dororong',
        'jjiho',
        'twiing'
    )
  and board_version = 3
  and start_board =
        array[18,9,35,11,21,15,19,12,6,16,5,8,13,22,30,34,32,10,23,26,1,4,33,17,29,27,14,0,20,3,2,24,7,28,25,31]::smallint[];

update public.puzzle_images
set board_version = 4
where image_key = 'admin-test'
  and board_version = 3
  and start_board =
        array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,35,34]::smallint[];

-- A challenge is the private server-side half of one browser playthrough. Its
-- UUID is also the submission request id, which keeps OAuth recovery and score
-- idempotency on one stable identifier. Successful submission deletes the
-- challenge atomically; the submission retains its start_board for audits and
-- safe retries after that deletion.
create table if not exists public.puzzle_challenges (
    request_id uuid primary key,
    image_key text not null references public.puzzle_images (image_key)
        on delete cascade,
    board_version integer not null,
    start_board smallint[] not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,

    constraint puzzle_challenges_version
        check (board_version between 1 and 2147483647),
    constraint puzzle_challenges_board
        check (
            board_version = 4
            and pg_catalog.cardinality(start_board) = 36
            and public.is_valid_puzzle_board(start_board)
        ),
    constraint puzzle_challenges_expiry
        check (expires_at > created_at)
);

comment on table public.puzzle_challenges is
    'Private short-lived random puzzle boards keyed by the eventual globally single-use score request UUID.';

create index if not exists puzzle_challenges_expires_idx
    on public.puzzle_challenges (expires_at);
create index if not exists puzzle_challenges_created_idx
    on public.puzzle_challenges (created_at desc);
create index if not exists puzzle_challenges_image_created_idx
    on public.puzzle_challenges (image_key, board_version, created_at desc);

alter table public.puzzle_challenges enable row level security;
revoke all on table public.puzzle_challenges
    from public, anon, authenticated;

-- Kept for legacy records created by the previous authenticated-start flow.
-- No new public RPC creates or completes these rows.
create table if not exists public.puzzle_runs (
    id uuid primary key default gen_random_uuid(),
    client_request_id uuid not null,
    user_id uuid not null references auth.users (id) on delete cascade,
    image_key text not null references public.puzzle_images (image_key),
    initial_board smallint[] not null,
    leaderboard_enabled boolean not null,
    started_at timestamptz not null default now(),
    expires_at timestamptz not null,
    completed_at timestamptz,
    completion_request_id uuid,
    move_count integer,
    elapsed_ms bigint,

    constraint puzzle_runs_board_valid
        check (public.is_valid_puzzle_board(initial_board)),
    constraint puzzle_runs_expiry
        check (expires_at > started_at),
    constraint puzzle_runs_completion
        check (
            (
                completed_at is null
                and completion_request_id is null
                and move_count is null
                and elapsed_ms is null
            )
            or (
                completed_at is not null
                and completion_request_id is not null
                and move_count between 1 and 20000
                and elapsed_ms >= 0
            )
        ),
    unique (user_id, client_request_id)
);

create index if not exists puzzle_runs_user_started_idx
    on public.puzzle_runs (user_id, started_at desc);
create index if not exists puzzle_runs_image_completed_idx
    on public.puzzle_runs (image_key, completed_at desc)
    where completed_at is not null;

alter table public.puzzle_runs enable row level security;
revoke all on table public.puzzle_runs from public, anon, authenticated;

-- Detailed submissions remain private and are never granted to browser roles.
-- Public RPCs read only the verified email copied to a best-score row after
-- explicit email_public consent.
create table if not exists public.puzzle_score_submissions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    client_request_id uuid not null,
    image_key text not null references public.puzzle_images (image_key),
    board_version integer not null,
    player_name text not null,
    google_email text not null,
    email_public boolean not null default false,
    -- Null only for legacy version-1 through version-3 records. Version 4
    -- stores the exact private challenge board used for server replay.
    start_board smallint[],
    move_path text not null,
    move_count integer not null,
    -- Retained only so legacy timed submissions remain intact. New submissions
    -- are moves-only and leave this column null.
    elapsed_ms bigint,
    submitted_at timestamptz not null default now(),

    constraint puzzle_submissions_name
        check (
            char_length(player_name) between 1 and 40
            and octet_length(player_name) <= 160
            and player_name = regexp_replace(
                player_name,
                '^[[:space:]]+|[[:space:]]+$',
                '',
                'g'
            )
            and player_name !~ '[[:cntrl:]]'
            and strpos(player_name, '@') = 0
        ),
    constraint puzzle_submissions_email
        check (
            octet_length(google_email) between 3 and 320
            and google_email = lower(btrim(google_email))
            and google_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
            and google_email !~ '[[:cntrl:]]'
        ),
    constraint puzzle_submissions_path
        check (
            char_length(move_path) between 1 and 20000
            and octet_length(move_path) <= 20000
            and move_path ~ '^[UDLR]+$'
            and move_count = char_length(move_path)
        ),
    constraint puzzle_submissions_elapsed
        check (elapsed_ms is null or elapsed_ms between 0 and 86400000),
    constraint puzzle_submissions_version
        check (board_version between 1 and 2147483647),
    constraint puzzle_submissions_start_board
        check (
            (board_version < 4 and (
                start_board is null
                or public.is_valid_puzzle_board(start_board)
            ))
            or (board_version >= 4 and (
                start_board is not null
                and pg_catalog.cardinality(start_board) = 36
                and public.is_valid_puzzle_board(start_board)
            ))
        ),
    unique (user_id, client_request_id)
);

comment on table public.puzzle_score_submissions is
    'Private authenticated puzzle submissions. email_public records explicit consent for public mailto leaderboard links.';

-- Existing rows were submitted under an email-private policy, so migration
-- must never infer public consent from the presence of google_email.
alter table public.puzzle_score_submissions
    add column if not exists email_public boolean;
update public.puzzle_score_submissions
set email_public = false
where email_public is null;
alter table public.puzzle_score_submissions
    alter column email_public set default false;
alter table public.puzzle_score_submissions
    alter column email_public set not null;
alter table public.puzzle_score_submissions
    alter column elapsed_ms drop not null;
alter table public.puzzle_score_submissions
    add column if not exists start_board smallint[];
alter table public.puzzle_score_submissions
    drop constraint if exists puzzle_submissions_start_board;
alter table public.puzzle_score_submissions
    add constraint puzzle_submissions_start_board
    check (
        (board_version < 4 and (
            start_board is null
            or public.is_valid_puzzle_board(start_board)
        ))
        or (board_version >= 4 and (
            start_board is not null
            and pg_catalog.cardinality(start_board) = 36
            and public.is_valid_puzzle_board(start_board)
        ))
    );
alter table public.puzzle_score_submissions
    drop constraint if exists puzzle_submissions_elapsed;
alter table public.puzzle_score_submissions
    add constraint puzzle_submissions_elapsed
    check (elapsed_ms is null or elapsed_ms between 0 and 86400000);

create index if not exists puzzle_submissions_user_time_idx
    on public.puzzle_score_submissions (user_id, submitted_at desc);
create index if not exists puzzle_submissions_image_time_idx
    on public.puzzle_score_submissions (
        image_key,
        board_version,
        submitted_at desc
    );
create index if not exists puzzle_submissions_version_time_idx
    on public.puzzle_score_submissions (board_version, submitted_at desc);
-- A completed browser run keeps the same UUID through Google OAuth. Make that
-- UUID globally single-use so signing into another account cannot claim it a
-- second time. In version 4 that UUID also selects the private challenge;
-- different challenges may legitimately produce the same move transcript.
-- Older schemas scoped the UUID to an account. Preserve every historical row
-- and its best-score foreign key by assigning fresh UUIDs to only the later
-- members of any cross-account collision before installing the global index.
-- This migration is run as one SQL Editor transaction; block concurrent score
-- writes until the collision repair and unique-index install both finish.
lock table public.puzzle_score_submissions in share row exclusive mode;

with repeated_request_ids as (
    select
        submission.id,
        row_number() over (
            partition by submission.client_request_id
            order by submission.submitted_at, submission.id
        ) as request_occurrence
    from public.puzzle_score_submissions as submission
), request_ids_to_refresh as (
    select repeated.id
    from repeated_request_ids as repeated
    where repeated.request_occurrence > 1
)
update public.puzzle_score_submissions as submission
set client_request_id = gen_random_uuid()
from request_ids_to_refresh as refreshed
where submission.id = refreshed.id;

drop index if exists public.puzzle_submissions_request_id_idx;
create unique index puzzle_submissions_request_id_idx
    on public.puzzle_score_submissions (client_request_id);
create index if not exists puzzle_submissions_recent_rank_idx
    on public.puzzle_score_submissions (
        image_key,
        board_version,
        submitted_at,
        user_id,
        move_count
    )
    where email_public;

alter table public.puzzle_score_submissions enable row level security;
revoke all on table public.puzzle_score_submissions
    from public, anon, authenticated;

-- One best score is retained for each user, image, and board version. Legacy
-- rows keep their run_id; new rows instead reference a private submission.
create table if not exists public.puzzle_best_scores (
    user_id uuid not null references auth.users (id) on delete cascade,
    image_key text not null references public.puzzle_images (image_key),
    board_version integer not null default 4,
    player_name text not null,
    google_email text,
    email_public boolean not null default false,
    move_count integer not null check (move_count between 1 and 20000),
    -- Retained only for legacy records; it is no longer used for ranking.
    elapsed_ms bigint,
    achieved_at timestamptz not null,
    run_id uuid unique references public.puzzle_runs (id) on delete cascade,
    submission_id uuid,

    primary key (user_id, image_key, board_version),
    constraint puzzle_best_name
        check (char_length(btrim(player_name)) between 1 and 80),
    constraint puzzle_best_source
        check (pg_catalog.num_nonnulls(run_id, submission_id) = 1),
    constraint puzzle_best_email
        check (
            google_email is null
            or (
                octet_length(google_email) between 3 and 320
                and google_email = lower(btrim(google_email))
                and google_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
                and google_email !~ '[[:cntrl:]]'
            )
        ),
    constraint puzzle_best_public_email
        check (not email_public or google_email is not null),
    constraint puzzle_best_elapsed
        check (elapsed_ms is null or elapsed_ms >= 0),
    constraint puzzle_best_submitted_name
        check (
            submission_id is null
            or (
                char_length(player_name) between 1 and 40
                and octet_length(player_name) <= 160
                and player_name = regexp_replace(
                    player_name,
                    '^[[:space:]]+|[[:space:]]+$',
                    '',
                    'g'
                )
                and player_name !~ '[[:cntrl:]]'
                and strpos(player_name, '@') = 0
                and google_email is not null
            )
        )
);

-- Migrate the previous two-column primary key and run-only source model.
alter table public.puzzle_best_scores
    add column if not exists board_version integer;
update public.puzzle_best_scores
set board_version = 1
where board_version is null;
alter table public.puzzle_best_scores
    alter column board_version set default 4;
alter table public.puzzle_best_scores
    alter column board_version set not null;
alter table public.puzzle_best_scores
    add column if not exists google_email text;
alter table public.puzzle_best_scores
    add column if not exists email_public boolean;
update public.puzzle_best_scores
set email_public = false
where email_public is null
   or (email_public and google_email is null);
alter table public.puzzle_best_scores
    alter column email_public set default false;
alter table public.puzzle_best_scores
    alter column email_public set not null;
alter table public.puzzle_best_scores
    add column if not exists submission_id uuid;
alter table public.puzzle_best_scores
    alter column run_id drop not null;
alter table public.puzzle_best_scores
    alter column elapsed_ms drop not null;

do $migration$
begin
    if not exists (
        select 1
        from pg_catalog.pg_constraint as primary_constraint
        where primary_constraint.conrelid =
                'public.puzzle_best_scores'::pg_catalog.regclass
          and primary_constraint.contype = 'p'
          and (
              select pg_catalog.array_agg(
                  attribute.attname
                  order by key_column.ordinality
              )
              from pg_catalog.unnest(primary_constraint.conkey)
                   with ordinality as key_column(attnum, ordinality)
              join pg_catalog.pg_attribute as attribute
                on attribute.attrelid = primary_constraint.conrelid
               and attribute.attnum = key_column.attnum
          ) = array['user_id', 'image_key', 'board_version']::name[]
    ) then
        alter table public.puzzle_best_scores
            drop constraint if exists puzzle_best_scores_pkey;
        alter table public.puzzle_best_scores
            add constraint puzzle_best_scores_pkey
            primary key (user_id, image_key, board_version);
    end if;
end;
$migration$;

do $migration$
begin
    if not exists (
        select 1
        from pg_catalog.pg_constraint as foreign_key
        where foreign_key.conrelid =
                'public.puzzle_best_scores'::pg_catalog.regclass
          and foreign_key.conname = 'puzzle_best_scores_submission_id_fkey'
    ) then
        alter table public.puzzle_best_scores
            add constraint puzzle_best_scores_submission_id_fkey
            foreign key (submission_id)
            references public.puzzle_score_submissions (id)
            on delete cascade;
    end if;
end;
$migration$;

alter table public.puzzle_best_scores
    drop constraint if exists puzzle_best_source;
alter table public.puzzle_best_scores
    add constraint puzzle_best_source
    check (pg_catalog.num_nonnulls(run_id, submission_id) = 1);

alter table public.puzzle_best_scores
    drop constraint if exists puzzle_best_email;
alter table public.puzzle_best_scores
    add constraint puzzle_best_email
    check (
        google_email is null
        or (
            octet_length(google_email) between 3 and 320
            and google_email = lower(btrim(google_email))
            and google_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
            and google_email !~ '[[:cntrl:]]'
        )
    );

alter table public.puzzle_best_scores
    drop constraint if exists puzzle_best_public_email;
alter table public.puzzle_best_scores
    add constraint puzzle_best_public_email
    check (not email_public or google_email is not null);

-- PostgreSQL generated the first name below for the unnamed legacy check.
-- Drop either spelling before installing the nullable, moves-only constraint.
alter table public.puzzle_best_scores
    drop constraint if exists puzzle_best_scores_elapsed_ms_check;
alter table public.puzzle_best_scores
    drop constraint if exists puzzle_best_elapsed;
alter table public.puzzle_best_scores
    add constraint puzzle_best_elapsed
    check (elapsed_ms is null or elapsed_ms >= 0);

-- Legacy rows are exempt from the stricter public-name rule so their records
-- remain intact. All rows created by the new submission RPC must satisfy it.
alter table public.puzzle_best_scores
    drop constraint if exists puzzle_best_submitted_name;
alter table public.puzzle_best_scores
    add constraint puzzle_best_submitted_name
    check (
        submission_id is null
        or (
            char_length(player_name) between 1 and 40
            and octet_length(player_name) <= 160
            and player_name = regexp_replace(
                player_name,
                '^[[:space:]]+|[[:space:]]+$',
                '',
                'g'
            )
            and player_name !~ '[[:cntrl:]]'
            and strpos(player_name, '@') = 0
            and google_email is not null
        )
    );

create unique index if not exists puzzle_best_submission_idx
    on public.puzzle_best_scores (submission_id)
    where submission_id is not null;
drop index if exists public.puzzle_best_version_rank_idx;
create index puzzle_best_version_rank_idx
    on public.puzzle_best_scores (
        image_key,
        board_version,
        move_count,
        achieved_at,
        user_id
    )
    where email_public;

alter table public.puzzle_images enable row level security;
alter table public.puzzle_best_scores enable row level security;

revoke all on table public.puzzle_images, public.puzzle_best_scores
    from public, anon, authenticated;

-- Issue one opaque, server-generated board for an anonymous or authenticated
-- browser playthrough. The request UUID is supplied by the browser only as an
-- idempotency key; it cannot influence the random board. A server-side random
-- permutation is parity-corrected for the 6x6 goal and rejected unless
-- at least 30 positions are displaced, so every returned board is solvable,
-- non-solved, and materially shuffled.
drop function if exists public.create_puzzle_challenge(text, integer, uuid);
create function public.create_puzzle_challenge(
    p_image_key text,
    p_board_version integer,
    p_request_id uuid
)
returns table (
    request_id uuid,
    image_key text,
    board_version integer,
    start_board smallint[],
    expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
    v_image_key text := pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_image_key, ''))
    );
    v_image public.puzzle_images%rowtype;
    v_existing public.puzzle_challenges%rowtype;
    v_board smallint[];
    v_solved smallint[];
    v_created_at timestamptz := pg_catalog.clock_timestamp();
    v_expires_at timestamptz;
    v_inversions integer;
    v_blank_row_from_bottom integer;
    v_misplaced integer;
    v_index integer;
    v_next_index integer;
    v_first_nonblank integer;
    v_second_nonblank integer;
    v_temporary smallint;
begin
    if p_request_id is null
       or p_board_version is distinct from 4
       or v_image_key !~ '^[a-z0-9][a-z0-9-]{0,47}$' then
        raise exception using
            errcode = '22023',
            message = 'A valid current puzzle version and request id are required.';
    end if;

    -- Serialize retries of the same UUID before inspecting either private
    -- table. The same live request returns its exact original board.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'puzzle-challenge:' || p_request_id::text,
            0
        )
    );

    select challenge.*
    into v_existing
    from public.puzzle_challenges as challenge
    where challenge.request_id = p_request_id
    for update;

    if found then
        if v_existing.image_key is distinct from v_image_key
           or v_existing.board_version is distinct from p_board_version then
            raise exception using
                errcode = '22023',
                message = 'This request id was already used for another puzzle challenge.';
        end if;
        if v_existing.expires_at <= pg_catalog.clock_timestamp() then
            raise exception using
                errcode = '55000',
                message = 'This puzzle challenge expired. Start a new puzzle.';
        end if;

        return query
        select
            v_existing.request_id,
            v_existing.image_key,
            v_existing.board_version,
            v_existing.start_board,
            v_existing.expires_at;
        return;
    end if;

    -- A successful submission consumes its challenge row. Never recreate a
    -- challenge whose globally unique request id is already a durable score.
    if exists (
        select 1
        from public.puzzle_score_submissions as submission
        where submission.client_request_id = p_request_id
    ) then
        raise exception using
            errcode = '23505',
            message = 'This completed record was already registered.';
    end if;

    select registered_image.*
    into v_image
    from public.puzzle_images as registered_image
    where registered_image.image_key = v_image_key
      and registered_image.board_version = p_board_version
      and registered_image.active
      and registered_image.leaderboard_enabled
    for share;

    if not found
       or pg_catalog.cardinality(v_image.start_board) <> 36
       or not public.is_valid_puzzle_board(v_image.start_board) then
        raise exception using
            errcode = '22023',
            message = 'This puzzle version is not available. Reload and try again.';
    end if;

    -- Anonymous database roles do not expose a trustworthy client IP. Apply a
    -- generous global circuit breaker here, while ordinary browser throttling
    -- remains UX-only. An Edge Function can add per-IP limits if needed later.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('puzzle-challenge-issuance', 0)
    );

    with expired_challenges as (
        select expired.request_id
        from public.puzzle_challenges as expired
        where expired.expires_at <= pg_catalog.clock_timestamp()
        order by expired.expires_at
        limit 500
    )
    delete from public.puzzle_challenges as expired
    using expired_challenges
    where expired.request_id = expired_challenges.request_id;

    if (
        select pg_catalog.count(*)
        from public.puzzle_challenges as recent
        where recent.created_at > pg_catalog.clock_timestamp() - interval '1 minute'
    ) + (
        -- Successful challenges are deleted, so include recent durable v4
        -- submissions in the issuance circuit breaker as consumed evidence.
        select pg_catalog.count(*)
        from public.puzzle_score_submissions as recent_submission
        where recent_submission.board_version = 4
          and recent_submission.submitted_at
                > pg_catalog.clock_timestamp() - interval '1 minute'
    ) >= 1000
       or (
        select pg_catalog.count(*)
        from public.puzzle_challenges as active_challenge
        where active_challenge.expires_at > pg_catalog.clock_timestamp()
    ) >= 20000 then
        raise exception using
            errcode = 'P0001',
            message = 'Please wait before starting another puzzle.';
    end if;

    select pg_catalog.array_agg(number::smallint order by number)
    into v_solved
    from pg_catalog.generate_series(0, 35) as solved_number(number);

    loop
        select pg_catalog.array_agg(number::smallint order by pg_catalog.random())
        into v_board
        from pg_catalog.generate_series(0, 35) as shuffled_number(number);

        -- For an even-width board with the blank represented by tile 35, the
        -- goal is reachable exactly when inversions + blank-row-from-bottom is
        -- odd. Swap two nonblank tiles whenever the random permutation has the
        -- opposite parity.
        v_inversions := 0;
        for v_index in 1..35 loop
            if v_board[v_index] = 35 then
                continue;
            end if;
            for v_next_index in (v_index + 1)..36 loop
                if v_board[v_next_index] <> 35
                   and v_board[v_index] > v_board[v_next_index] then
                    v_inversions := v_inversions + 1;
                end if;
            end loop;
        end loop;

        v_blank_row_from_bottom := 6 - (
            (pg_catalog.array_position(v_board, 35::smallint) - 1) / 6
        );

        if pg_catalog.mod(
            v_inversions + v_blank_row_from_bottom,
            2
        ) <> 1 then
            v_first_nonblank := null;
            v_second_nonblank := null;
            for v_index in 1..36 loop
                if v_board[v_index] <> 35 then
                    if v_first_nonblank is null then
                        v_first_nonblank := v_index;
                    else
                        v_second_nonblank := v_index;
                        exit;
                    end if;
                end if;
            end loop;
            v_temporary := v_board[v_first_nonblank];
            v_board[v_first_nonblank] := v_board[v_second_nonblank];
            v_board[v_second_nonblank] := v_temporary;
        end if;

        select pg_catalog.count(*)::integer
        into v_misplaced
        from pg_catalog.unnest(v_board) with ordinality
             as tile(tile_value, tile_position)
        where tile.tile_value <> tile.tile_position - 1;

        exit when v_misplaced >= 30
              and v_board is distinct from v_solved;
    end loop;

    v_expires_at := v_created_at + interval '26 hours';

    insert into public.puzzle_challenges as challenge (
        request_id,
        image_key,
        board_version,
        start_board,
        created_at,
        expires_at
    ) values (
        p_request_id,
        v_image_key,
        p_board_version,
        v_board,
        v_created_at,
        v_expires_at
    );

    return query
    select
        p_request_id,
        v_image_key,
        p_board_version,
        v_board,
        v_expires_at;
end;
$function$;

comment on function public.create_puzzle_challenge(text, integer, uuid) is
    'Idempotently issues a private, short-lived, solvable random 6x6 version-4 puzzle challenge.';

revoke all on function public.create_puzzle_challenge(text, integer, uuid)
    from public, anon, authenticated;
grant execute on function public.create_puzzle_challenge(text, integer, uuid)
    to anon, authenticated;

-- Retire the old authenticated-start protocol. Dropping these routines also
-- removes every prior EXECUTE grant; legacy tables and rows stay untouched.
drop function if exists public.start_puzzle_run(text, uuid);
drop function if exists public.complete_puzzle_run(uuid, uuid, text);

drop function if exists public.submit_puzzle_score(
    text,
    integer,
    text,
    bigint,
    text,
    uuid
);
drop function if exists public.submit_puzzle_score(
    text,
    integer,
    text,
    text,
    uuid,
    boolean
);
create function public.submit_puzzle_score(
    p_image_key text,
    p_board_version integer,
    p_player_name text,
    p_move_path text,
    p_request_id uuid,
    p_publish_email boolean
)
returns table (
    submission_id uuid,
    image_key text,
    player_name text,
    moves integer,
    email_published boolean,
    is_personal_best boolean,
    leaderboard_rank bigint,
    already_registered boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
    v_user_id uuid := auth.uid();
    v_image_key text := lower(btrim(coalesce(p_image_key, '')));
    v_player_name text := regexp_replace(
        coalesce(p_player_name, ''),
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
    );
    v_move_path text := upper(coalesce(p_move_path, ''));
    v_google_email text;
    v_image public.puzzle_images%rowtype;
    v_challenge public.puzzle_challenges%rowtype;
    v_submission public.puzzle_score_submissions%rowtype;
    v_ranking_best public.puzzle_score_submissions%rowtype;
    v_start_board smallint[];
    v_board smallint[];
    v_solved smallint[];
    v_empty integer;
    v_target integer;
    v_row integer;
    v_column integer;
    v_index integer;
    v_direction text;
    v_temporary smallint;
    v_is_best boolean := false;
    v_rank bigint := null;
    v_already_registered boolean := false;
begin
    if v_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Google sign-in is required to register a score.';
    end if;

    if p_request_id is null
       or p_board_version is null
       or p_board_version < 1
       or v_image_key !~ '^[a-z0-9][a-z0-9-]{0,47}$' then
        raise exception using
            errcode = '22023',
            message = 'A valid puzzle, version, and request id are required.';
    end if;

    -- Public names deliberately reject every @ sign. This is stricter than an
    -- email regex and prevents accidental publication of an email-like value.
    if char_length(v_player_name) not between 1 and 40
       or octet_length(v_player_name) > 160
       or v_player_name ~ '[[:cntrl:]]'
       or strpos(v_player_name, '@') > 0 then
        raise exception using
            errcode = '22023',
            message = 'Enter a public name of 1 to 40 characters without an email address.';
    end if;

    if char_length(v_move_path) not between 1 and 20000
       or octet_length(v_move_path) > 20000
       or v_move_path !~ '^[UDLR]+$' then
        raise exception using
            errcode = '22023',
            message = 'The puzzle record is invalid.';
    end if;

    if p_publish_email is distinct from true then
        raise exception using
            errcode = '22023',
            message = 'Consent to publish the verified Google email is required for leaderboard registration.';
    end if;

    -- The publishable email comes only from a verified Google identity. It is
    -- never accepted as an RPC argument or read from user-editable metadata.
    select lower(btrim(google_account.identity_data ->> 'email'))
    into v_google_email
    from auth.users as auth_user
    join lateral (
        select google_identity.identity_data
        from auth.identities as google_identity
        where google_identity.user_id = auth_user.id
          and google_identity.provider = 'google'
        order by google_identity.last_sign_in_at desc nulls last,
                 google_identity.created_at asc
        limit 1
    ) as google_account on true
    where auth_user.id = v_user_id
      and auth_user.email_confirmed_at is not null;

    if v_google_email is null
       or octet_length(v_google_email) not between 3 and 320
       or v_google_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
       or v_google_email ~ '[[:cntrl:]]' then
        raise exception using
            errcode = '42501',
            message = 'A verified Google email is required to register a score.';
    end if;

    -- Retention takes the exclusive form of this lock. A shared lock keeps a
    -- score insert and its best-score update in one side of a purge boundary.
    perform pg_catalog.pg_advisory_xact_lock_shared(
        pg_catalog.hashtextextended('puzzle-ranking-retention', 0)
    );

    -- Challenge issuance and submission take the same UUID lock. It identifies
    -- one completed browser run even if someone signs out and tries to claim
    -- the saved run with another Google account.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'puzzle-challenge:' || p_request_id::text,
            0
        )
    );

    -- Serialize all submissions from one account. Retrying the same UUID with
    -- the same normalized body returns the original row before rate limiting.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'puzzle-submit:' || v_user_id::text,
            0
        )
    );

    select existing_submission.*
    into v_submission
    from public.puzzle_score_submissions as existing_submission
    where existing_submission.client_request_id = p_request_id
    order by existing_submission.submitted_at, existing_submission.id
    limit 1;

    if found then
        if v_submission.user_id is distinct from v_user_id then
            raise exception using
                errcode = '23505',
                message = 'This completed record was already registered with another Google account.';
        end if;
        if v_submission.image_key is distinct from v_image_key
           or v_submission.board_version is distinct from p_board_version
           or v_submission.player_name is distinct from v_player_name
           or v_submission.move_path is distinct from v_move_path
           or not v_submission.email_public then
            raise exception using
                errcode = '22023',
                message = 'This request id was already used for a different score.';
        end if;
        v_already_registered := true;
    end if;

    if v_submission.id is null then
        -- Lock the registry row so a board-version migration cannot interleave
        -- with validation and create a score under the wrong version.
        select registered_image.*
        into v_image
        from public.puzzle_images as registered_image
        where registered_image.image_key = v_image_key
          and registered_image.board_version = p_board_version
          and registered_image.active
          and registered_image.leaderboard_enabled
        for share;

        if not found then
            raise exception using
                errcode = '22023',
                message = 'This puzzle version is not eligible for the leaderboard. Reload and try again.';
        end if;

        -- Every new current-version submission must consume the exact private
        -- challenge selected by its request UUID. The browser never sends a
        -- start board, so it cannot choose an easy layout or alter one tile.
        select challenge.*
        into v_challenge
        from public.puzzle_challenges as challenge
        where challenge.request_id = p_request_id
        for update;

        if not found then
            raise exception using
                errcode = 'P0002',
                message = 'The puzzle challenge is missing or expired. Start a new puzzle.';
        end if;

        if v_challenge.image_key is distinct from v_image_key
           or v_challenge.board_version is distinct from p_board_version then
            raise exception using
                errcode = '22023',
                message = 'This puzzle challenge belongs to another puzzle.';
        end if;

        if v_challenge.expires_at <= pg_catalog.clock_timestamp() then
            raise exception using
                errcode = '55000',
                message = 'This puzzle challenge expired. Start a new puzzle.';
        end if;

        if (
            select count(*)
            from public.puzzle_score_submissions as recent_submission
            where recent_submission.user_id = v_user_id
              and recent_submission.submitted_at > now() - interval '1 hour'
        ) >= 10
           or (
            select count(*)
            from public.puzzle_score_submissions as daily_submission
            where daily_submission.user_id = v_user_id
              and daily_submission.submitted_at > now() - interval '24 hours'
        ) >= 50 then
            raise exception using
                errcode = 'P0001',
                message = 'Please wait before registering another score.';
        end if;

        -- Versions 1 through 3 remain stored only as history. Never accept a
        -- new score unless both registry and challenge use the current v4 6x6
        -- rules with tile 35 as the blank.
        if v_image.board_version <> 4
           or v_challenge.board_version <> 4
           or pg_catalog.cardinality(v_challenge.start_board) <> 36
           or not public.is_valid_puzzle_board(v_challenge.start_board)
           or pg_catalog.array_position(
               v_challenge.start_board,
               35::smallint
           ) is null then
            raise exception using
                errcode = '22023',
                message = 'This puzzle does not use the current 6x6 board. Reload and try again.';
        end if;

        v_start_board := v_challenge.start_board;
        v_board := v_start_board;
        select pg_catalog.array_agg(number::smallint order by number)
        into v_solved
        from pg_catalog.generate_series(0, 35) as solved_number(number);

        for v_index in 1..char_length(v_move_path) loop
            v_empty := pg_catalog.array_position(v_board, 35::smallint);
            v_row := (v_empty - 1) / 6;
            v_column := (v_empty - 1) % 6;
            v_direction := substr(v_move_path, v_index, 1);

            if (v_direction = 'U' and v_row = 0)
               or (v_direction = 'D' and v_row = 5)
               or (v_direction = 'L' and v_column = 0)
               or (v_direction = 'R' and v_column = 5) then
                raise exception using
                    errcode = '22023',
                    message = pg_catalog.format(
                        'Illegal move at step %s.',
                        v_index
                    );
            end if;

            v_target := case v_direction
                when 'U' then v_empty - 6
                when 'D' then v_empty + 6
                when 'L' then v_empty - 1
                else v_empty + 1
            end;
            v_temporary := v_board[v_empty];
            v_board[v_empty] := v_board[v_target];
            v_board[v_target] := v_temporary;
        end loop;

        if v_board is distinct from v_solved then
            raise exception using
                errcode = '22023',
                message = 'The submitted moves do not solve this puzzle.';
        end if;

        insert into public.puzzle_score_submissions as submission (
            user_id,
            client_request_id,
            image_key,
            board_version,
            player_name,
            google_email,
            email_public,
            start_board,
            move_path,
            move_count
        )
        values (
            v_user_id,
            p_request_id,
            v_image_key,
            p_board_version,
            v_player_name,
            v_google_email,
            true,
            v_start_board,
            v_move_path,
            char_length(v_move_path)
        )
        returning submission.* into v_submission;

        -- Deletion is in the same transaction as the durable submission and
        -- best-score update. Any later error restores the challenge; after a
        -- commit, an OAuth/network retry resolves from the submission instead.
        delete from public.puzzle_challenges as consumed_challenge
        where consumed_challenge.request_id = p_request_id;

        -- Explicit consent also refreshes the public name and verified email
        -- on an older personal best even when the move count is not improved.
        update public.puzzle_best_scores as existing_best
        set player_name = v_player_name,
            google_email = v_google_email,
            email_public = true
        where existing_best.user_id = v_user_id
          and existing_best.image_key = v_image_key
          and existing_best.board_version = p_board_version;

        insert into public.puzzle_best_scores as best_score (
            user_id,
            image_key,
            board_version,
            player_name,
            google_email,
            email_public,
            move_count,
            achieved_at,
            run_id,
            submission_id
        )
        values (
            v_user_id,
            v_image_key,
            p_board_version,
            v_player_name,
            v_google_email,
            true,
            v_submission.move_count,
            v_submission.submitted_at,
            null,
            v_submission.id
        )
        on conflict (user_id, image_key, board_version) do update
        set player_name = excluded.player_name,
            google_email = excluded.google_email,
            email_public = excluded.email_public,
            move_count = excluded.move_count,
            achieved_at = excluded.achieved_at,
            run_id = null,
            submission_id = excluded.submission_id
        where excluded.move_count < best_score.move_count;
    else
        -- Repair any impossible leftover created by an interrupted older
        -- deployment. The durable globally unique submission is authoritative.
        delete from public.puzzle_challenges as consumed_challenge
        where consumed_challenge.request_id = p_request_id;
    end if;

    -- The ordinary leaderboard is a Korean-calendar-year rolling window.
    -- Compute this account's best eligible submission in that same window so
    -- the rank returned here always agrees with get_puzzle_leaderboard().
    select recent_best.*
    into v_ranking_best
    from public.puzzle_score_submissions as recent_best
    join public.puzzle_images as ranking_image
      on ranking_image.image_key = recent_best.image_key
     and ranking_image.board_version = recent_best.board_version
    where recent_best.user_id = v_user_id
      and recent_best.image_key = v_submission.image_key
      and recent_best.board_version = v_submission.board_version
      and ranking_image.active
      and ranking_image.leaderboard_enabled
      and recent_best.email_public
      and recent_best.google_email is not null
      and recent_best.submitted_at >= pg_catalog.timezone(
          'Asia/Seoul',
          (
              pg_catalog.timezone('Asia/Seoul', pg_catalog.now())::date
              - interval '1 year'
          )::timestamp
      )
    order by
        recent_best.move_count,
        recent_best.submitted_at,
        recent_best.id
    limit 1;

    if found then
        v_is_best := v_ranking_best.id = v_submission.id;

        with recent_personal_bests as (
            select distinct on (candidate.user_id)
                candidate.user_id,
                candidate.move_count,
                candidate.submitted_at,
                candidate.id
            from public.puzzle_score_submissions as candidate
            join public.puzzle_images as ranking_image
              on ranking_image.image_key = candidate.image_key
             and ranking_image.board_version = candidate.board_version
            where candidate.image_key = v_submission.image_key
              and candidate.board_version = v_submission.board_version
              and ranking_image.active
              and ranking_image.leaderboard_enabled
              and candidate.email_public
              and candidate.google_email is not null
              and candidate.submitted_at >= pg_catalog.timezone(
                  'Asia/Seoul',
                  (
                      pg_catalog.timezone(
                          'Asia/Seoul',
                          pg_catalog.now()
                      )::date
                      - interval '1 year'
                  )::timestamp
              )
            order by
                candidate.user_id,
                candidate.move_count,
                candidate.submitted_at,
                candidate.id
        )
        select 1 + count(*)
        into v_rank
        from recent_personal_bests as better_score
        where (
            better_score.move_count,
            better_score.submitted_at,
            better_score.user_id
        ) < (
            v_ranking_best.move_count,
            v_ranking_best.submitted_at,
            v_ranking_best.user_id
        );
    end if;

    return query
    select
        v_submission.id,
        v_submission.image_key,
        v_submission.player_name,
        v_submission.move_count,
        v_submission.email_public,
        v_is_best,
        v_rank,
        v_already_registered;
end;
$function$;

comment on function public.submit_puzzle_score(
    text,
    integer,
    text,
    text,
    uuid,
    boolean
) is
    'Consumes one private version-4 challenge, verifies its solved transcript, and preserves idempotent OAuth/network retries by request UUID.';

revoke all on function public.submit_puzzle_score(
    text,
    integer,
    text,
    text,
    uuid,
    boolean
) from public, anon;
grant execute on function public.submit_puzzle_score(
    text,
    integer,
    text,
    text,
    uuid,
    boolean
) to authenticated;

-- Public period metadata keeps the dedicated page label aligned with the
-- server-side cutoff. Dates are Korean civil dates, not browser-local dates.
drop function if exists public.get_puzzle_ranking_period();
create function public.get_puzzle_ranking_period()
returns table (
    period_start date,
    period_end date,
    time_zone text
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
    select
        (
            pg_catalog.timezone('Asia/Seoul', pg_catalog.now())::date
            - interval '1 year'
        )::date,
        pg_catalog.timezone('Asia/Seoul', pg_catalog.now())::date,
        'Asia/Seoul'::text;
$function$;

comment on function public.get_puzzle_ranking_period() is
    'Returns the inclusive Korean-date label for the rolling one-year per-image leaderboard window.';

revoke all on function public.get_puzzle_ranking_period()
    from public;
grant execute on function public.get_puzzle_ranking_period()
    to anon, authenticated;

drop function if exists public.get_puzzle_leaderboard(text, integer);
create function public.get_puzzle_leaderboard(
    p_image_key text,
    p_limit integer default 10
)
returns table (
    place bigint,
    player_name text,
    contact_email text,
    moves integer,
    is_you boolean,
    registered_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_image_key text := lower(btrim(coalesce(p_image_key, '')));
begin
    if p_limit is null or p_limit not between 1 and 100 then
        raise exception using
            errcode = '22023',
            message = 'Leaderboard limit must be between 1 and 100.';
    end if;

    -- Select one best submission per account from the rolling Korean-calendar
    -- year. An old Hall source may remain stored, but it never leaks back into
    -- an ordinary image ranking after it crosses this period boundary.
    return query
    with recent_personal_bests as (
        select distinct on (submission.user_id)
            submission.user_id,
            submission.player_name,
            submission.google_email,
            submission.move_count,
            submission.submitted_at,
            submission.id
        from public.puzzle_score_submissions as submission
        join public.puzzle_images as registered_image
          on registered_image.image_key = submission.image_key
         and registered_image.board_version = submission.board_version
        where registered_image.image_key = v_image_key
          and registered_image.active
          and registered_image.leaderboard_enabled
          and submission.email_public
          and submission.google_email is not null
          and submission.submitted_at >= pg_catalog.timezone(
              'Asia/Seoul',
              (
                  pg_catalog.timezone(
                      'Asia/Seoul',
                      pg_catalog.now()
                  )::date
                  - interval '1 year'
              )::timestamp
          )
        order by
            submission.user_id,
            submission.move_count,
            submission.submitted_at,
            submission.id
    )
    select
        row_number() over (
            order by
                recent_best.move_count,
                recent_best.submitted_at,
                recent_best.user_id
        ),
        recent_best.player_name,
        recent_best.google_email,
        recent_best.move_count,
        auth.uid() is not null and recent_best.user_id = auth.uid(),
        pg_catalog.timezone(
            'Asia/Seoul',
            recent_best.submitted_at
        )::date
    from recent_personal_bests as recent_best
    order by
        recent_best.move_count,
        recent_best.submitted_at,
        recent_best.user_id
    limit p_limit;
end;
$function$;

comment on function public.get_puzzle_leaderboard(text, integer) is
    'Returns each account''s best moves-only submission in the current Korean-date one-year window for an active current-version image.';

revoke all on function public.get_puzzle_leaderboard(text, integer)
    from public;
grant execute on function public.get_puzzle_leaderboard(text, integer)
    to anon, authenticated;

-- The dedicated leaderboard page builds its per-image sections from this
-- registry instead of duplicating the list in browser code.
drop function if exists public.get_puzzle_leaderboard_catalog();
create function public.get_puzzle_leaderboard_catalog()
returns table (
    image_key text,
    image_title text
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
    select
        registered_image.image_key,
        registered_image.title
    from public.puzzle_images as registered_image
    where registered_image.active
      and registered_image.leaderboard_enabled
    order by
        registered_image.title,
        registered_image.image_key;
$function$;

comment on function public.get_puzzle_leaderboard_catalog() is
    'Returns active leaderboard image keys and display titles for the dedicated leaderboard page.';

revoke all on function public.get_puzzle_leaderboard_catalog()
    from public;
grant execute on function public.get_puzzle_leaderboard_catalog()
    to anon, authenticated;

-- Hall of Fame semantics: first select each account's lowest-move result
-- across every active current-version image, then rank those representatives.
-- Thus one account cannot occupy more than one of the ten available places.
drop function if exists public.get_puzzle_hall_of_fame();
create function public.get_puzzle_hall_of_fame()
returns table (
    place bigint,
    player_name text,
    contact_email text,
    image_key text,
    image_title text,
    moves integer,
    is_you boolean,
    registered_on date
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
    with eligible_scores as (
        select
            best_score.user_id,
            best_score.player_name,
            best_score.google_email as contact_email,
            best_score.image_key,
            registered_image.title as image_title,
            best_score.move_count as moves,
            best_score.achieved_at,
            row_number() over (
                partition by best_score.user_id
                order by
                    best_score.move_count,
                    best_score.achieved_at,
                    best_score.image_key
            ) as account_choice
        from public.puzzle_best_scores as best_score
        join public.puzzle_images as registered_image
          on registered_image.image_key = best_score.image_key
         and registered_image.board_version = best_score.board_version
        where registered_image.active
          and registered_image.leaderboard_enabled
          and best_score.email_public
          and best_score.google_email is not null
    ),
    account_representatives as (
        select
            eligible_score.user_id,
            eligible_score.player_name,
            eligible_score.contact_email,
            eligible_score.image_key,
            eligible_score.image_title,
            eligible_score.moves,
            eligible_score.achieved_at
        from eligible_scores as eligible_score
        where eligible_score.account_choice = 1
    )
    select
        row_number() over (
            order by
                representative.moves,
                representative.achieved_at,
                representative.user_id
        ),
        representative.player_name,
        representative.contact_email,
        representative.image_key,
        representative.image_title,
        representative.moves,
        auth.uid() is not null and representative.user_id = auth.uid(),
        pg_catalog.timezone(
            'Asia/Seoul',
            representative.achieved_at
        )::date
    from account_representatives as representative
    order by
        representative.moves,
        representative.achieved_at,
        representative.user_id
    limit 10;
$function$;

comment on function public.get_puzzle_hall_of_fame() is
    'Returns ten distinct accounts, using each account''s best moves-only score across all active current-version images.';

revoke all on function public.get_puzzle_hall_of_fame()
    from public;
grant execute on function public.get_puzzle_hall_of_fame()
    to anon, authenticated;

-- Retention keeps only the exact ten Hall representatives outside the rolling
-- year. Their best-score rows and their single referenced source rows are
-- captured before any delete, so foreign-key cascades cannot erase the Hall.
drop function if exists public.purge_puzzle_ranking_history();
create function public.purge_puzzle_ranking_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '9min'
as $function$
declare
    v_cutoff_at timestamptz := pg_catalog.timezone(
        'Asia/Seoul',
        (
            pg_catalog.timezone('Asia/Seoul', pg_catalog.now())::date
            - interval '1 year'
        )::timestamp
    );
    v_hall_submission_ids uuid[] := array[]::uuid[];
    v_hall_run_ids uuid[] := array[]::uuid[];
    v_hall_count bigint := 0;
    v_challenges_removed bigint := 0;
    v_best_scores_removed bigint := 0;
    v_submissions_removed bigint := 0;
    v_runs_removed bigint := 0;
    v_best_scores_rebuilt bigint := 0;
begin
    -- submit_puzzle_score takes the shared form. This exclusive lock makes the
    -- Hall snapshot, deletes, and best-score rebuild one atomic retention pass.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('puzzle-ranking-retention', 0)
    );

    delete from public.puzzle_challenges as expired_challenge
    where expired_challenge.expires_at <= pg_catalog.clock_timestamp();
    get diagnostics v_challenges_removed = row_count;

    with eligible_scores as (
        select
            best_score.user_id,
            best_score.image_key,
            best_score.board_version,
            best_score.move_count,
            best_score.achieved_at,
            best_score.run_id,
            best_score.submission_id,
            row_number() over (
                partition by best_score.user_id
                order by
                    best_score.move_count,
                    best_score.achieved_at,
                    best_score.image_key
            ) as account_choice
        from public.puzzle_best_scores as best_score
        join public.puzzle_images as registered_image
          on registered_image.image_key = best_score.image_key
         and registered_image.board_version = best_score.board_version
        where registered_image.active
          and registered_image.leaderboard_enabled
          and best_score.email_public
          and best_score.google_email is not null
    ),
    account_representatives as (
        select eligible_score.*
        from eligible_scores as eligible_score
        where eligible_score.account_choice = 1
    ),
    hall_records as (
        select representative.*
        from account_representatives as representative
        order by
            representative.move_count,
            representative.achieved_at,
            representative.user_id
        limit 10
    )
    select
        coalesce(
            array_agg(hall_record.submission_id)
                filter (where hall_record.submission_id is not null),
            array[]::uuid[]
        ),
        coalesce(
            array_agg(hall_record.run_id)
                filter (where hall_record.run_id is not null),
            array[]::uuid[]
        ),
        count(*)
    into
        v_hall_submission_ids,
        v_hall_run_ids,
        v_hall_count
    from hall_records as hall_record;

    -- Remove every expired non-Hall best row explicitly before its source.
    -- This both documents intent and avoids relying on cascade side effects.
    delete from public.puzzle_best_scores as expired_best
    where not (
              expired_best.submission_id is not null
          and expired_best.submission_id = any(v_hall_submission_ids)
          or  expired_best.run_id is not null
          and expired_best.run_id = any(v_hall_run_ids)
      )
      and (
          expired_best.achieved_at < v_cutoff_at
          or exists (
              select 1
              from public.puzzle_score_submissions as source_submission
              where source_submission.id = expired_best.submission_id
                and source_submission.submitted_at < v_cutoff_at
          )
          or exists (
              select 1
              from public.puzzle_runs as source_run
              where source_run.id = expired_best.run_id
                and coalesce(
                    source_run.completed_at,
                    source_run.started_at
                ) < v_cutoff_at
          )
      );
    get diagnostics v_best_scores_removed = row_count;

    delete from public.puzzle_score_submissions as expired_submission
    where expired_submission.submitted_at < v_cutoff_at
      and not (
          expired_submission.id = any(v_hall_submission_ids)
      );
    get diagnostics v_submissions_removed = row_count;

    delete from public.puzzle_runs as expired_run
    where coalesce(expired_run.completed_at, expired_run.started_at)
            < v_cutoff_at
      and not (expired_run.id = any(v_hall_run_ids));
    get diagnostics v_runs_removed = row_count;

    -- If an expired all-time best was removed while a newer, slower submission
    -- remains, restore that account/image/version's best from retained data.
    with retained_personal_bests as (
        select distinct on (
            retained_submission.user_id,
            retained_submission.image_key,
            retained_submission.board_version
        )
            retained_submission.user_id,
            retained_submission.image_key,
            retained_submission.board_version,
            retained_submission.player_name,
            retained_submission.google_email,
            retained_submission.email_public,
            retained_submission.move_count,
            retained_submission.elapsed_ms,
            retained_submission.submitted_at,
            retained_submission.id
        from public.puzzle_score_submissions as retained_submission
        order by
            retained_submission.user_id,
            retained_submission.image_key,
            retained_submission.board_version,
            retained_submission.move_count,
            retained_submission.submitted_at,
            retained_submission.id
    )
    insert into public.puzzle_best_scores (
        user_id,
        image_key,
        board_version,
        player_name,
        google_email,
        email_public,
        move_count,
        elapsed_ms,
        achieved_at,
        run_id,
        submission_id
    )
    select
        retained_best.user_id,
        retained_best.image_key,
        retained_best.board_version,
        retained_best.player_name,
        retained_best.google_email,
        retained_best.email_public,
        retained_best.move_count,
        retained_best.elapsed_ms,
        retained_best.submitted_at,
        null,
        retained_best.id
    from retained_personal_bests as retained_best
    where not exists (
        select 1
        from public.puzzle_best_scores as existing_best
        where existing_best.user_id = retained_best.user_id
          and existing_best.image_key = retained_best.image_key
          and existing_best.board_version = retained_best.board_version
    )
    on conflict (user_id, image_key, board_version) do nothing;
    get diagnostics v_best_scores_rebuilt = row_count;

    return pg_catalog.jsonb_build_object(
        'cutoff_at', v_cutoff_at,
        'time_zone', 'Asia/Seoul',
        'challenges_removed', v_challenges_removed,
        'hall_records_preserved', v_hall_count,
        'best_scores_removed', v_best_scores_removed,
        'submissions_removed', v_submissions_removed,
        'runs_removed', v_runs_removed,
        'best_scores_rebuilt', v_best_scores_rebuilt
    );
end;
$function$;

comment on function public.purge_puzzle_ranking_history() is
    'Private idempotent retention job: removes expired challenges, preserves the exact current all-time Hall ten and their sources, then deletes other puzzle data before the Korean-date one-year cutoff and rebuilds retained personal best rows.';

-- Functions default to PUBLIC execute in PostgreSQL. Keep this maintenance
-- entry point private; pg_cron runs it as the role that installs this schema.
revoke all on function public.purge_puzzle_ranking_history()
    from public, anon, authenticated;

-- Supabase Cron uses pg_cron. Its default scheduler clock is UTC; 15:05 UTC is
-- 00:05 KST the next day, and Korea has no daylight-saving offset changes.
create extension if not exists pg_cron;

-- A named pg_cron schedule is updated rather than duplicated when this schema
-- is re-run, keeping installation idempotent.
select cron.schedule(
    'puzzle-ranking-retention-0005-kst',
    '5 15 * * *',
    'select public.purge_puzzle_ranking_history();'
);

-- Refresh PostgREST metadata after RPC return columns or overloads change.
notify pgrst, 'reload schema';
