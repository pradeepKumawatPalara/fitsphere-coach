# TCR-005: The coach's schedule in the trainee app

| | |
|---|---|
| Status | **Draft** (coach side built and tested; not yet reviewed by the owner) |
| Written by | Coach team (Developer 2), 2026-11-11 |
| For | Developer 1 — trainee app (`fitsphere`) |
| Coach feature that depends on it | CF09 (calendar, SPEC-004) |
| Coach decisions | C-D13, C-D22, C-D27, C-D28; ADR-0002 (rules 2–4) |
| Needs first | TCR-001 (link), TCR-003 (training plans), TCR-004 (diet plans) |

Design source: `docs/design/CF09-calendar-ui.md`. Same pattern as TCR-003 and TCR-004.

## 1. Why
A coach schedules a client's workouts and diet plan on dates. The client sees "what do I do today and this week" in the FitSphere app, and a workout they log that day counts as done without any extra tap. Today the coach calendar shows "Completed" by reading the client's workout log (`app.workouts.day`); this change lets the client **see** the schedule.

## 2. User flow
1. The coach schedules, moves or removes an activity in FitSphere Coach. The coach server writes the client's row(s) in `app.schedule_items` (below).
2. On the next sync the client's Today and week views show the workout (name, day, time, notes) and the diet plan for the day.
3. When the client logs a workout on that India day, the calendar item shows as done.
4. A moved activity shows its new date; the old date is not shown. A removed one disappears.

## 3. Screens and states
- **Today / This week** (new section on the Training tab, or its own entry): list by day; each item: kind icon, title ("Pull"), plan name, time or "All day", coach note, status "Planned" or "Done" or "Missed". A diet-plan item reads "Diet plan: {name}" and opens the Diet plan tab.
- States: loading; nothing scheduled ("Nothing scheduled"); offline (last synced). Read-only: no edit, no reschedule, no mark-done in this release.
- Exact copy: "Scheduled by your coach" · "Planned" · "Done" · "Missed" · "Nothing scheduled" · toast "Your coach changed your schedule."

## 4. Data (schema `app`; Developer 1 writes the migration)
```sql
-- One row per scheduled workout day, and one per diet-plan range. Written by the coach server only; the
-- row's id is the coach server's activity id. Removed activities are deleted (a deleted row with no
-- content is kept for sync, like workouts).
create table app.schedule_items (
  id uuid primary key,
  user_id uuid not null references app.users (id) on delete cascade,   -- the client
  kind text not null check (kind in ('workout', 'nutrition')),
  plan_id uuid,                              -- app.training_plans.id or app.diet_plans.id
  title text not null check (char_length(title) between 1 and 80),
  plan_name text not null check (char_length(plan_name) between 1 and 80),
  start_date date not null,                  -- IST day
  end_date date not null check (end_date >= start_date),
  time_of_day time,
  notes text not null default '' check (char_length(notes) <= 300),
  done_by_coach boolean not null default false,
  change_seq bigint not null default nextval('app.change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index schedule_items_user_dates on app.schedule_items (user_id, start_date);
create index schedule_items_user_change_seq on app.schedule_items (user_id, change_seq);
create trigger schedule_items_touch before update on app.schedule_items
  for each row execute function app.touch_synced_row();
alter table app.schedule_items enable row level security;
```
The client's own log decides "Done" for a workout: a workout with `app.workouts.day = start_date` and not deleted; `done_by_coach` covers a coach's "mark as done". "Missed" is a workout whose day has passed and is not done. A diet-plan item is "Done" after its last day.

## 5. API changes in the trainee server
Sync pull includes the client's own `schedule_items`. No route lets the client change them (403 `schedule_read_only`).

## 6. Rules and permissions
Only the coach server's database role writes the table (TCR-005 of the earlier list gives it its own login). A client sees only their own rows. Rows of an ended link stay but are not shown as upcoming (C-D28). Deleting the account cascades.

## 7. Acceptance criteria
- Given a scheduled workout, when the client syncs, then it shows on its day with the copy of §3.
- Given the client logs a workout that day, then the item shows "Done".
- Given the coach moves it, then the client sees the new date at the next sync.
- Given the coach removes it, then it disappears.
- Given the client tries to change a schedule item, then the server refuses.
- Offline: the last synced schedule shows.

## 8. Tests Developer 1 should add
Migration test (constraints, cascade); API tests (read-only, cross-user isolation); sync test (add, move, remove); UI test (today, week, done from a logged workout); phone check.

## 9. How the coach side depends on it
Today the coach side keeps activities in schema `coach` only and **does not write `app.schedule_items`**. When this change is done, the coach server starts writing it (a small coach change, with the table as a test fixture like TCR-003 and TCR-004). Until then the client sees nothing new; completion already works from the client's workout log.

## 10. Rollout
1. Owner reviews and sends this to Developer 1. 2. Developer 1 merges and applies it. 3. The coach team adds the writes and turns them on. Either side may ship first safely.

## 11. Open questions
1. Should a client also be able to mark an item done, or ask to move it? (Owner answer 2026-11-11: not in this release.)
2. A notification when the schedule changes needs the trainee app's notification work; is it planned?
