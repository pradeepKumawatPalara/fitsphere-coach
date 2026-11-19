# TCR-007: Gym member flag and "open to joining a gym"

| | |
|---|---|
| Status | **Draft** (coach side built behind this request; not yet reviewed by the owner) |
| Written by | Coach team (Developer 2), 2026-11-12 |
| For | Developer 1 — trainee app (`fitsphere`) |
| Coach feature that depends on it | CF04 (client management: add client, "find a FitSphere user") |
| Coach decisions | C-D22, C-D26, C-D31 (proposed); invariant 3 (no leaking who is registered) |
| Needs first | Nothing |

## 1. Why
A Gym Owner adds a client who already has a FitSphere account. Today the owner must type the exact
email. The owner asked for a list of FitSphere users to pick from. Showing every user to every gym would
expose people who never agreed to be seen, so the list shows **only users who switched on "open to
joining a gym"** in their own app (owner decision, 2026-11-12: opt-in list). The same request adds the
`is_gym_member` flag the owner asked for, so the trainee app knows when a user belongs to a gym.

## 2. User flow
1. In the FitSphere app the user opens Settings and switches on **Open to joining a gym**.
2. A gym owner using FitSphere Coach opens Clients → Add client and sees "People open to joining a
   gym" with a search box. The user appears (email only).
3. The owner taps the person and adds them. The coach server sets `is_gym_member = true` and
   `open_to_gym = false` for that user and links them to the gym.
4. The user can switch **Open to joining a gym** off at any time before that; they then disappear from
   the list.

## 3. Screens and states (trainee app)
- **Settings → Privacy (or Profile), new row:** a switch "Open to joining a gym" with the help text
  below. States: off (default), on, saving, offline (change queued like other settings).
- **Gym member (read only):** when `is_gym_member` is true, show "You're a member of a gym" in Settings,
  with the gym's name if available (the name comes later; not required now), and hide the switch.
- Exact copy:
  - Row title: **Open to joining a gym**
  - Help text: **"Gyms using FitSphere Coach can find you by your email and add you. They see your email
    address only. When a gym adds you, they also see what you log. Switch this off any time before that."**
  - Member row: **"You're a member of a gym."**

## 4. Data (schema `app`; Developer 1 writes the migration)
```sql
alter table app.users
  add column is_gym_member boolean not null default false,
  add column open_to_gym boolean not null default false;
-- A gym member is never listed as open to joining a gym.
alter table app.users add constraint users_member_not_open check (not (is_gym_member and open_to_gym));
```
- The coach server **writes** `is_gym_member` (and clears `open_to_gym`) when a gym owner adds the user, and
  clears `is_gym_member` when the link ends (see the coach rules below). The trainee app **writes**
  `open_to_gym` only, and only for the signed-in user.
- Sync: these are two ordinary user fields. Include them in the user object the app already syncs.

## 5. API (trainee API)
- `GET /v1/me` returns `isGymMember` and `openToGym`.
- `PATCH /v1/me/settings` (or the existing settings endpoint) accepts `openToGym: boolean`. Refuse it with
  `409` while `isGymMember` is true. Validation errors follow the existing error model.

## 6. Rules and permissions
- A user changes `open_to_gym` for themselves only.
- Nobody but the user sees `open_to_gym`, except FitSphere Coach's server, which lists users where it is
  true (email only) and nothing else about them.
- `is_gym_member` is set and cleared by the coach server only. The trainee app never lets a user set it.
- The coach server grants (ADR-0002, rule 7): `select` on `app.users`, `update (is_gym_member,
  open_to_gym)` on `app.users`.
- Account deletion is unchanged: these are columns of `app.users`.

## 7. Acceptance criteria
- A new user has both flags false; the switch is off.
- Switching it on makes the user appear in FitSphere Coach's picker within one sync; switching it off
  removes them.
- A user who is a gym member sees no switch and cannot turn `open_to_gym` on (API answers 409).
- `GET /v1/me` includes both fields; existing clients that ignore them still work.
- Existing users are unaffected by the migration (defaults).

## 8. Tests (trainee repo)
Migration defaults; the switch on and off; refusal for a member; the constraint; settings sync.

## 9. How the coach side depends on it
- The coach server already reads `open_to_gym` only if the column exists (checked at request time), so the
  picker stays hidden until this request is Done and applied.
- Until then the coach app keeps its own flag in `coach.gym_clients.is_gym_member` (migration C0007; its
  SQL comment calls this request "TCR-006", the number it had before TCR-006 was taken by the separate
  database login). After this request, the coach server also writes `app.users.is_gym_member`.

## 10. Open questions for the owner
1. Should the gym's name be shown to the user when `is_gym_member` is true? (Proposed: later.)
2. When a gym removes a client, set `is_gym_member` back to false and leave `open_to_gym` false, so the
   user must opt in again. (Proposed: yes.)
3. Does the opt-in text need Legal's review before release? (Proposed: yes; the list shares an email with
   gyms.)
