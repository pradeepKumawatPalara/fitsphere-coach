# CF09 — Calendar (SPEC-004): UI design

| | |
|---|---|
| **App** | FitSphere Coach (Expo, iOS + Android) |
| **Status** | **UI approved by the owner, 2026-11-11.** Screens are in the "FitSphere Coach Screens" canvas (rows "SPEC-004 · Calendar dashboard", dark and light). **Built:** the coach API (migration C0006, not yet applied to Supabase), the phone screens and tests. **Scheduling works as soon as a plan is published** (publishing needs no trainee-app change). **The client side waits for TCR-005** (the client's own schedule in the FitSphere app). Owner's phone check pending (`docs/operations/runbook.md` §10). |
| **Source spec** | `spec/SPEC-004-calendar-dashboard-coachrx.md` (business draft). Where it disagrees with `docs/product/coach-scope.md` v0.4 or a C-D decision, the scope and the decisions win. |
| **Depends on** | CF04 (clients), CF06 (training plans), CF07 (diet plans); **TCR-005** (`docs/handoff/trainee-app/TCR-005-calendar.md`) for the client's view |
| **Decisions** | C-D12, C-D13, C-D15, C-D18, C-D22, C-D28; ADR-0002 |

Visual values come from `docs/design/design-system.md`. A workout is a caramel **circle** with a dumbbell, nutrition a blue **square** with a fork: colour and shape, never colour alone.

## 1. How SPEC-004 maps to the product

| SPEC-004 says | What the product does | Why |
|---|---|---|
| "Gym Owner" views gym calendars | The owner **is** the Head Coach: sees the whole gym, with a coach filter. A Coach sees their own clients | coach-scope §2; C-D12 |
| Day, week, month views; client and coach filters | One screen with Day / Week / Month and the same filters; one request covers the month grid | §4.1 |
| Schedule a workout plan on a date | The client's **active** training plan, a day of the plan, a date, an optional time, notes. Drafts and ended plans cannot be scheduled | rules 2, 3 |
| Recurring schedules | **In the first release** (owner assumption): weekly on chosen weekdays for 1 to 12 weeks, the plan's training days given out in turn, every date **reviewed before saving**, any date can be taken out | §4.7 |
| Conflicts | The same client, same day, same time: a **warning**, never a block | §4.8 |
| Nutrition: full-day, by meal, or both | **Full-day plan over a range of dates** (up to 90 days). A diet plan already on those days is cut short (if it started before) or replaced (if it started inside); a warning | §4.3 |
| Statuses Assigned / Completed / Missed / Rescheduled | Worked out when read: **Completed** when a coach marks it done, or the client logs a workout that day in the FitSphere app, or (diet) the last day has passed; **Missed** when a workout's day has passed without completion; **Rescheduled** when moved and still to come | §4.6 |
| Reschedule, with a reason? | Moving a workout or a diet plan, with an **optional reason**; the old date stays in the history | §4.5 |
| Client marks complete, requests reschedule; notifications | **Not in this release.** Completion comes from the client's own log. The client's calendar and a notification need **TCR-005** | C-D22 |
| Retain a record of changes | `coach.calendar_changes`: scheduled, moved, completed, removed, with who and when | rule 7 |

## 2. Screens
1. **Calendar** (`calendar.tsx`) — **updated 2026-11-11 (owner-approved on the canvas, "SPEC-004 · Calendar update"):** the **Day** view is a table **pinned at the top** (back, title, view tabs, date and the table stay in view; the rest scrolls), one row per client (**Client | Workout | Diet | Status**; a row's status is the one needing attention first: Missed, Assigned, Rescheduled, Completed), each workout or diet plan in it opens the activity; **Add to calendar** opens a sheet to choose **Workout** or **Diet plan** and keeps the chosen client. Day / Week / Month tabs, client chips, coach chips (Head Coach), earlier and later, the month grid with a dot per kind under days that have activities, a legend, the chosen day's activities (status chip on each), a warning when a client has two workouts at the same time, **Add to calendar**.
2. **Client calendar** (`calendar-client.tsx`): the client's coach, active training and diet plans, upcoming and recent activities, schedule buttons (off when there is no active plan). Reached from the client's profile ("Calendar").
3. **Schedule workout** (`calendar-schedule-workout.tsx`): client, plan, plan day, date, time (24-hour, optional), once or weekly (weekdays, weeks), notes, **Review dates** (conflicts marked, any date removable), Save N workouts.
4. **Schedule diet plan** (`calendar-schedule-diet.tsx`): client, plan, from and to, notes, the replace warning, Save.
5. **Activity** (`calendar-activity.tsx`): the **status first**, when, plan, coach, notes, history, **Mark as done**, **Reschedule** (sheet: new date, time, reason), **Remove from calendar** (sheet).

## 3. Rules the server enforces (not the screens)
- A Coach opens and changes activities of their own clients only, the Head Coach of the gym's. Anything else is "not found", and an ended link ends the access (invariant 1).
- A workout needs the client's active training plan and a training day (not a rest day); a diet plan the client's active diet plan; the dates are today or later in India time (invariant 4).
- Dates: at most 12 weeks of repeating and 90 days of diet plan; a calendar request spans at most 92 days.
- A completed activity cannot be moved. Removing keeps the history.
- Every schedule, move, completion and removal is logged with who and when.

## 4. Built (2026-11-11)
- Migration `C0006_calendar.sql` (schema `coach`): `calendar_activities`, `calendar_changes`.
- Shared: `packages/shared/src/calendar.ts` (requests, `workoutDates`). API: `apps/api/src/calendar.ts`, `routes/calendar.ts`.
- Phone: `apps/mobile/src/app/calendar*.tsx`, `src/calendar/` (service, texts, parts).
- Tests: `apps/api/test/integration/calendar.test.ts`, `apps/mobile/src/calendar.test.tsx`, `packages/shared/src/calendar.test.ts`.

## 5. Differences from the Canva screens, for the owner to confirm
The plan day, the weekdays and the weeks are chip rows; the date is earlier and later day buttons; the client is chosen from chips (up to eight shown on the Calendar, all on the schedule screens); the reviewed dates refresh by themselves as the form changes.

## 6. Open questions for the owner
1. **A diet plan's status.** It shows Assigned while it runs and Completed once its last day has passed, and is never Missed. Should it show how many days the client logged meals instead?
2. **Nothing is sent to the client yet** (TCR-005). Until then a coach tells the client in person, or the FitSphere app shows nothing new.
3. **Time zones** are India only (invariant 4), as in the rest of Phase 1.
