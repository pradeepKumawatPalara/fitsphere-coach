-- CF04 (C-D31, proposed): clients the Gym Owner adds directly.
-- Schema coach only (shared database contract, rule 1). `app.users` has no `is_gym_member` column
-- yet (checked read-only 2026-11-12), and this repo never changes schema `app` (C-D22). So the
-- coach side keeps its own flag here; Developer 1 adds `app.users.is_gym_member` later (TCR-006)
-- and this table can then be read into it. Both references cascade on delete (rule 5).
create table coach.gym_clients (
  client_id uuid primary key references app.users (id) on delete cascade,
  gym_head_coach_id uuid not null references app.users (id) on delete cascade,
  added_by uuid not null references app.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80 and full_name = btrim(full_name)),
  is_gym_member boolean not null default true,
  created_at timestamptz not null default now()
);
alter table coach.gym_clients enable row level security;
create index gym_clients_gym_idx on coach.gym_clients (gym_head_coach_id);
