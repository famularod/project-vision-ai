alter table if exists public.project_updates
  add column if not exists idempotency_key text;

update public.project_updates
set idempotency_key = coalesce(
  nullif(update_data ->> 'idempotencyKey', ''),
  nullif(update_data ->> 'stableSendId', ''),
  nullif(id, '')
)
where idempotency_key is null;

create unique index if not exists project_updates_idempotency_key_unique
  on public.project_updates (idempotency_key)
  where idempotency_key is not null;

comment on column public.project_updates.idempotency_key is
  'Stable client-generated send id for idempotent offline queued update retries.';

comment on index public.project_updates_idempotency_key_unique is
  'Prevents duplicate project update sends when an offline retry repeats the same idempotency key.';
