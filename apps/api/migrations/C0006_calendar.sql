-- CF09: calendar (SPEC-004; coach-scope; C-D12, C-D13, C-D18). Schema coach only (shared database
-- contract, rule 1). Every table that points at a user cascades on delete (rule 4). Row level security is
-- on with no policies. An activity points at the coach's own plan (workout or diet) and is deleted with it.
-- "Missed" and "Completed" are worked out when read (a workout is completed when the client logs one that
-- day in the FitSphere app); only a coach's "mark as done" is stored.

create table coach.calendar_activities (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references app.users (id) on delete cascade,
  gym_head_coach_id uuid not null references app.users (id) on delete cascade,
  created_by uuid not null references app.users (id) on delete cascade,
  kind text not null check (kind in ('workout', 'nutrition')),
  training_plan_id uuid references coach.training_plans (id) on delete cascade,
  diet_plan_id uuid references coach.diet_plans (id) on delete cascade,
  -- Which day of the training plan (index into its days); null for nutrition.
  day_index integer check (day_index is null or day_index between 0 and 6),
  -- A snapshot, so the calendar still reads well if the plan changes: the plan day's name, or the diet plan's name.
  title text not null check (char_length(title) between 1 and 80),
  plan_name text not null check (char_length(plan_name) between 1 and 80),
  -- India days (invariant 4). A workout has one day; a diet plan a range.
  start_date date not null,
  end_date date not null,
  time_of_day time,
  notes text not null default '' check (char_length(notes) <= 300),
  status text not null default 'assigned' check (status in ('assigned', 'completed', 'removed')),
  completed_at timestamptz,
  completed_by uuid references app.users (id) on delete set null,
  moves integer not null default 0 check (moves >= 0),
  series_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (
    (kind = 'workout' and training_plan_id is not null and diet_plan_id is null and day_index is not null and end_date = start_date)
    or (kind = 'nutrition' and diet_plan_id is not null and training_plan_id is null and day_index is null and time_of_day is null)
  ),
  check ((status = 'completed') = (completed_at is not null))
);
alter table coach.calendar_activities enable row level security;
create index calendar_activities_trainee_dates on coach.calendar_activities (trainee_id, start_date, end_date) where status <> 'removed';
create index calendar_activities_gym_dates on coach.calendar_activities (gym_head_coach_id, start_date);

-- What happened to an activity, with who and when (C-D13 spirit; SPEC-004 rule 7).
create table coach.calendar_changes (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references coach.calendar_activities (id) on delete cascade,
  action text not null check (action in ('scheduled', 'moved', 'completed', 'removed')),
  from_date date,
  to_date date,
  reason text check (reason is null or char_length(reason) <= 200),
  actor_id uuid not null references app.users (id) on delete cascade,
  actor_role text not null check (actor_role in ('head_coach', 'coach')),
  created_at timestamptz not null default now()
);
alter table coach.calendar_changes enable row level security;
create index calendar_changes_activity on coach.calendar_changes (activity_id, created_at);
