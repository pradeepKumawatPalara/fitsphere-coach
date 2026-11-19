-- TCR-007 as proposed (docs/handoff/trainee-app/TCR-007-gym-member-and-open-to-gym.md): the "open to joining a
-- gym" switch, so the Add client picker can be tested before Developer 1 delivers the real column.
-- Test database only: never applied to Supabase.
alter table app.users
  add column is_gym_member boolean not null default false,
  add column open_to_gym boolean not null default false;
