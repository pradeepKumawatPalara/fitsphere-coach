-- CF04 (C-D31, proposed): the details a gym keeps for a client it added (edit client). Schema coach only.
-- `app.users` has no phone, goal or notes, and this repo never changes `app` (C-D22).
alter table coach.gym_clients
  add column phone text check (phone is null or phone ~ '^[0-9+() -]{7,20}$'),
  add column fitness_goal text check (fitness_goal is null or fitness_goal in
    ('weight_loss', 'muscle_gain', 'strength', 'general_fitness', 'endurance', 'mobility')),
  add column notes text check (notes is null or char_length(notes) <= 500),
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references app.users (id) on delete set null;
