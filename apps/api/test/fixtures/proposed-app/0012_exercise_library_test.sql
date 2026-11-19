-- The exercise library tables that already exist in the real shared database (app.exercises,
-- app.exercise_details; checked read-only 2026-11-12) but not in the trainee repo copy under
-- test/fixtures/app-schema. Same columns as the real tables, with a few synthetic rows, so the
-- exercise search can be tested. Test database only: never applied to Supabase.
create table app.exercises (
  code text primary key,
  name text not null,
  exercise_group text not null,
  log_type text not null,
  aliases text[] not null default '{}',
  compendium_code text,
  met numeric,
  updated_at timestamptz not null default now(),
  places jsonb not null default '[]'::jsonb
);
create table app.exercise_speed_mets (
  exercise_code text not null references app.exercises (code),
  from_kmh numeric not null,
  compendium_code text not null,
  met numeric not null
);
create table app.exercise_details (
  library_row integer not null,
  exercise_code text not null references app.exercises (code),
  category text not null,
  sub_group text,
  primary_muscle text not null,
  muscles_worked text[] not null default '{}',
  equipment text not null,
  tags text[] not null default '{}',
  how_to text[] not null default '{}',
  watch_for text not null default '',
  video_url text
);

insert into app.exercises (code, name, exercise_group, log_type, aliases) values
  ('bench-press', 'Bench Press', 'barbell', 'weight_reps', '{flat press}'),
  ('plank', 'Plank', 'bodyweight', 'time', '{}'),
  ('push-up', 'Push-up', 'bodyweight', 'reps', '{press up}'),
  ('goblet-squat', 'Goblet Squat', 'dumbbell', 'weight_reps', '{}'),
  ('mystery-move', 'Mystery Move', 'other', 'reps', '{}');
insert into app.exercise_details (library_row, exercise_code, category, primary_muscle, muscles_worked, equipment, how_to, watch_for, video_url) values
  (1, 'bench-press', 'Barbell', 'Chest', '{Triceps}', 'Barbell', '{Lie flat,Press up}', 'Keep your feet down', 'https://example.test/bench'),
  (2, 'plank', 'Core / Abs', 'Abs', '{}', 'Bodyweight', '{Hold a straight line}', '', null),
  (3, 'push-up', 'Bodyweight / Calisthenics', 'Chest', '{Triceps}', 'Bodyweight', '{}', '', null),
  (4, 'goblet-squat', 'Dumbbell', 'Quads', '{Glutes}', 'Dumbbell', '{}', '', null),
  -- The real table has exercises with two details rows; each must still appear once.
  (5, 'plank', 'Core / Abs', 'Abs', '{}', 'Mat', '{}', '', null);
