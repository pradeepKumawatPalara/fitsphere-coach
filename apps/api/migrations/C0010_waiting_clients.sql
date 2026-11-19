-- CF04 (C-D31, proposed): clients the gym added before they have a FitSphere account. Schema coach only.
-- The trainee API creates `app.users` rows itself when a person signs up, and the email there always comes
-- from Supabase's confirmed email, so we never create `app.users` rows for clients. A waiting client lives
-- here until a user with the same email appears; the coach server then links them to the gym (see
-- apps/api/src/waitingClients.ts). Both user references cascade on delete (contract rule 5).
create table coach.waiting_clients (
  id uuid primary key default gen_random_uuid(),
  gym_head_coach_id uuid not null references app.users (id) on delete cascade,
  coach_id uuid not null references app.users (id) on delete cascade,
  added_by uuid not null references app.users (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254),
  full_name text not null check (char_length(full_name) between 2 and 80 and full_name = btrim(full_name)),
  phone text check (phone is null or phone ~ '^[0-9+() -]{7,20}$'),
  fitness_goal text check (fitness_goal is null or fitness_goal in
    ('weight_loss', 'muscle_gain', 'strength', 'general_fitness', 'endurance', 'mobility')),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users (id) on delete set null
);
alter table coach.waiting_clients enable row level security;
-- A person waits for one gym at a time (one gym per client).
create unique index waiting_clients_email_key on coach.waiting_clients (email);
create index waiting_clients_gym_idx on coach.waiting_clients (gym_head_coach_id);
