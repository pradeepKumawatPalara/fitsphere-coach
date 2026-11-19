# CF04 — Client management (SPEC-001): UI design (DRAFT, owner review)

| | |
|---|---|
| **App** | FitSphere Coach (Expo, iOS + Android) |
| **Status** | **UI approved by the owner, 2026-11-11.** Screens are in the "FitSphere Coach Screens" canvas (rows "SPEC-001 · Client management", dark and light). **Built:** client list (2.1, 2.2), invite a client (2.3, 2.4), profile (2.5), change coach (2.6), remove client (2.7), and the Invited list with Resend and Cancel. **Invite is built but switched off** (`TRAINEE_INVITES_ENABLED=false`) until Developer 1 delivers TCR-001; the server then answers "not found" and the app hides the button. **Still waiting for TCR-001:** the trainee's real name (the list shows the email, and shows the name automatically once `app.users.full_name` exists) and the Inactive filter (former-client history, C-D28). |
| **Source spec** | `spec/SPEC-001-client-management.md` (business draft). Where it disagrees with `docs/product/coach-scope.md` v0.4 or a C-D decision, the scope and the decisions win (CLAUDE.md). |
| **Depends on** | CF02 (the Head Coach exists), CF03 (Coaches exist), **TCR-001** (trainee accepts a gym invitation; Developer 1, C-D22) |
| **Scope/decisions** | coach-scope §3.4, §6; C-D12, C-D15, C-D18, C-D19, C-D20, C-D21, C-D23, C-D24, C-D26, C-D28 |

All visual values come from `docs/design/design-system.md`. UPPERCASE text is rendered by the style.

## 1. How SPEC-001 maps to the scope

| SPEC-001 says | What the product does | Why |
|---|---|---|
| "Gym Owner" and "Head Coach" are separate roles | One role: the gym owner **is** the Head Coach | coach-scope §2 |
| Staff add a client by entering a profile | Staff **invite by email**; the trainee creates their own account and accepts | C-D23 |
| Coach can be assigned to a client; maybe several | **One coach per trainee** (database rule); a Head Coach may keep a trainee under themselves | coach-scope §2, C-D21, `app.links` unique index |
| Delete or deactivate a client | **Remove** ends the link and keeps the history read-only; nothing is deleted | C-D18, C-D28 |
| Profile: date of birth, gender, address, height, goal, membership | The FitSphere app holds **no** such fields. The coach sees the trainee's **name** (new, TCR-001) and what they log: weight, targets, meals, workouts, steps, sleep | shared database (`app` schema) |
| Prevent duplicate clients | "This trainee is already added." The database allows one active coach per trainee | C-D19 |
| A Coach does not see every gym client | A Coach sees **their own** trainees; the Head Coach sees all and which Coach each belongs to | C-D12 |
| Search and filter by status and coach | Same; the coach filter shows for the Head Coach only | SPEC-001 §4.1 |

## 2. Screens

### 2.1 Client list (Head Coach shown)
Eyebrow "{Gym} · Head coach" · title "CLIENTS" · "{n} clients in your gym. Coaches see only their own." · **search** (name, email) · filter chips **All / Active / Inactive / Invited** with counts · **coach filter** ("COACH · All coaches", Head Coach only) · rows (avatar initial, name, "Logged today · Coach Ravi Kumar", status chip) · primary "INVITE CLIENT".
- **Active:** an active link. **Inactive:** removed; read-only history stays in the gym (C-D28). **Invited:** a pending invitation.
- A Coach sees the same screen without the coach filter, listing only their trainees.
- States: loading, empty (2.2), no search results ("No clients match."), offline (the cached list, read-only), error.

### 2.2 No clients yet
Tile · "NO CLIENTS / YET" · "Invite a trainee by email. When they accept in the FitSphere app, they appear here and you can see what they log." · "INVITE CLIENT".

### 2.3 Invite a client
Back "CLIENTS" · "INVITE A / CLIENT" · "Enter their email. They accept in the FitSphere app, and you see their data once they do." · **Client email** · **Add under** (Head Coach only): "Myself" or "A coach" (then a coach picker, C-D21; a Coach always adds under themselves) · info "The invite works for 7 days. You can cancel it any time." · "SEND INVITE".
- Already in the gym: error under the email, **"This trainee is already added."** (C-D19); nothing is sent.
- The email of a Coach in this gym is refused (C-D24).
- The result never reveals whether the email has a FitSphere account (invariant 3): always 2.4.

### 2.4 Invite sent
Success tile · "INVITE / SENT" · "We emailed {email}. When {name} accepts in the FitSphere app, they appear in your clients. The invite expires in 7 days." · "BACK TO CLIENTS", "INVITE ANOTHER". Pending invitations can be cancelled or resent from the Invited filter.

### 2.5 Client profile
Back · avatar, name, status chip · **Coach** card ("Ravi Kumar", "Since 3 Nov 2026"; the Head Coach sees each client's coach) · **Progress** card: latest weight, calorie target, protein target, workouts this week, last logged · **Plans and schedule** card: Training plan (CF06), Diet plan (CF07), Calendar (CF09) — each "Not set yet" until those features exist · "CHANGE COACH" (Head Coach only) · "REMOVE CLIENT".
- Nothing here is shown for a Coach's own personal training (C-D15). Notes and the full trainee tabs (nutrition, training, progress) are CF04's trainee profile views (TPRO-*).

### 2.6 Change coach (sheet, Head Coach only)
"MOVE TO A COACH" · "{Name} stays your gym's client. The new coach sees their data, and the change is recorded." · radio list: the gym's Coaches (current one marked) and "Myself" with client counts · "MOVE CLIENT", "CANCEL". No new consent is needed (C-D26).

### 2.7 Remove client (sheet)
"REMOVE {NAME}?" · "This ends your link with {Name}. You will not see anything new they log. History up to today stays in your gym, read-only. Nothing is deleted, and {Name} keeps their FitSphere account." · "REMOVE CLIENT" (danger colour), "KEEP CLIENT". A Head Coach can remove any client in the gym; a Coach only their own (C-D18).
- Removing a **Coach** is CF03: refused while the Coach still has trainees (C-D20).

### 2.8 Add a client (C-D31, proposed; built 2026-11-12) — replaces "Invite" while the invite is off
Back "CLIENTS" · "ADD A / CLIENT" · "Add them to your gym. If they have no FitSphere account, we create one. Their own calendar changes appear in your calendar." · **Client name** · **Client email** · **Add under** ("Myself" or a Coach, Head Coach only) · info "You are adding this person to your gym, and they agree to share their data with it. They set their own password with 'Forgot password' in the FitSphere app." · "ADD CLIENT".
- Success "CLIENT / ADDED" with "BACK TO CLIENTS" and "ADD ANOTHER".
- Refusals: "This trainee is already added." (C-D19); "This person can't be added to your gym." (a Coach of this gym, or someone who already has a coach elsewhere); "No FitSphere account uses this email. Ask them to sign up in the FitSphere app first." (owner decision 2026-11-12: **sign-up first**; this repo never creates sign-in accounts and needs no Supabase service key). This answer tells the Gym Owner whether an email has an account, a deliberate exception to invariant 3 for the Gym Owner only.
- **People open to joining a gym (owner decision 2026-11-12: opt-in list; coach side built, hidden until TCR-007):** above the email field, a search box and a list of FitSphere users who switched on "Open to joining a gym" in their own app (email only). Tapping one fills the email field. Hidden until Developer 1 delivers `app.users.open_to_gym` (TCR-007); the server checks the column exists. Users already in a gym and the gym's own staff are left out. An exact email can always be typed instead.
- Only the Head Coach (the gym owner until Q10 is settled) sees the button (`canAdd`).
- The client is stored in `coach.gym_clients` with `is_gym_member = true` (migration C0007) and linked in `app.links`. `app.users.is_gym_member` itself is TCR-007 (Developer 1, later); this repo does not change `app`.
- Consent: the admin's add stands as the client's consent to share data with the gym (owner, 2026-11-12). The 18+ confirmation is recorded as "gym-added-v1" for these accounts: **to be confirmed by the owner and Legal** (invariant 7).

### 2.8a Waiting for a FitSphere account (owner decision 2026-11-12; built)
- The Gym Owner can add anyone by name and email, even with no FitSphere account yet. Nothing is created in `app.users` or Supabase: the trainee API creates the `app.users` row itself when the person signs up (the email comes from Supabase's confirmed email). Until then the client is saved in `coach.waiting_clients` (migration C0010).
- **Add client** shows no "no account" error. Success: "CLIENT / ADDED. {Name} is waiting for a FitSphere account. When they sign up in the FitSphere app with this email, they join your gym automatically."
- **Clients list:** a "Waiting n" filter chip appears when any exist; a waiting row shows a WAITING badge and "Waiting for FitSphere account · {Coach}".
- **Profile (waiting):** banner "Waiting for a FitSphere account. Ask them to sign up in the FitSphere app with {email}. They join your gym automatically."; Progress and Plans are hidden; Edit, Change coach and **Cancel waiting** (deletes the waiting row) remain.
- **Link-up:** when the gym's list or a profile is read, a waiting client whose email now has an account is linked (gym row, link under the chosen Coach, `is_gym_member` if the column exists) and the waiting row is removed, in one transaction. Someone already a client elsewhere, or gym staff, stays waiting.
- One waiting row per email across gyms: a second add in the same gym says "This trainee is already added."; in another gym, "This person can't be added to your gym."
- Plans, calendar and exercises start once they have joined.

### 2.9 View and edit a client (UI approved 2026-11-12; built)
- **View:** the profile shows a **Details** card (email, phone, goal, notes, "Gym member") above Coach, Progress and Plans. The Plans card's first row is "Training plan · Exercises".
- **Edit client:** name, email (read-only: it is the login), phone (optional), fitness goal (Weight loss, Muscle gain, Strength, General fitness, Endurance, Mobility), notes (up to 500 characters; only the gym sees them) → "SAVE CHANGES". The Head Coach edits any client of the gym; a Coach only their own. Stored in `coach.gym_clients` (migration C0009), never in schema `app`.

### 2.10 Client exercises (UI approved 2026-11-12; built)
- The client's current training plan (the live one, else the draft, labelled "Draft, not published to the client yet"), a chip per day, and each exercise with sets × reps, weight, RPE and rest. Tap one to open its details from the shared library: muscles, equipment, steps, "Watch for" tip, "Watch video", and the coach's note. Read only.
- Below it, **Logged by the client**: the last 10 workouts from `app.workouts` (name, sets × reps, weight).
- **Change from the drawn UI:** no per-exercise "Logged" tick. The trainee app stores what a client logs as free-text names, not library codes, so a log cannot be matched to a plan exercise reliably. The logged workouts are shown as they were logged instead. Matching needs a trainee-app change (the log would store the exercise code).
- Exercise details come from `app.exercises` and `app.exercise_details` (read only). If an exercise is no longer in the library, its code is shown and the details say so.

### 2.11 Client food log (owner request 2026-11-12; built)
- A client's profile has a **Food log** row (not for a client still waiting for a FitSphere account). It opens what they logged in the FitSphere app, **read only**, laid out like the FitSphere app's food log: day arrows (‹ Today · Thu 12 Nov ›), calories against the target with a bar, protein / carbs / fat / fibre against their targets, each meal (Breakfast, Lunch, Dinner, Snack) with its time and each food (name, amount, kcal, "≈" when the client estimated), the meal's macros, and the last 7 days (tap a day to open it; ✓ within 10% of the calorie target, ▲ above, ▼ below).
- **Live:** the screen refreshes by itself every 20 seconds while open, with "Refresh now" and an "Updated hh:mm" line. Supabase Realtime is off by design (the coach API is the only path to the data), so this polls.
- **Data (read only):** `app.meals` (per meal: day, type, kcal and macros, `items`, `photo`) and `app.targets`. Targets are stored per day: the target in force on a day is the latest set on or before it. No migration and no trainee-app change.
- **Photos:** a public photo link is shown as a tappable link (only http and https). A stored photo lives in the private `meal-photos` bucket and needs a signed link that only the trainee API (or a Supabase secret key) can issue, so it shows "Photo saved in the FitSphere app (not viewable here yet)". Showing them needs a trainee-app change (a request for Developer 1, not yet written).
- Access is the same as the profile: a Coach sees their own clients, the Head Coach the gym's. Meal data is health data and is never logged.

## 3. Rules the server enforces (not the screens)
- Authorization is server-side: a Coach cannot open a trainee who is not theirs; the Head Coach can open any trainee of the gym.
- Invite: refuse an already-added email (C-D19), a Coach of this gym (C-D24), and more than the daily limit (`INVITES_PER_DAY`, ADR-0008). Seven-day expiry.
- Move: in one transaction end the old link (reason `switched`) and start the new one; the new upper user must be a Coach of the same gym or the Head Coach.
- Remove: end the link (reason `removed`); no data deleted.
- Every move and removal is logged with who and when.

## 4. Not in CF04
Multiple coaches per client; coach-entered profile fields (date of birth, address, membership) and notes (CF10 for notes; the rest needs a new decision); permanent deletion; a separate Gym Owner role.

## 5. Open questions for the owner
1. Is "Logged today" (last activity) the right line under the name, or would you prefer weight or adherence?
2. The Invited filter: should a pending invitation also show in the main list as a faded row?
3. Should the Head Coach also be able to **cancel** a Coach's pending invitation to a trainee? (Proposed: yes.)
4. SPEC-001's "to be confirmed" items (mandatory fields, membership) are answered by the table in §1; confirm.
