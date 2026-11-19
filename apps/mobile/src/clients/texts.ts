// Texts and small helpers for client management (docs/design/CF04-client-management-ui.md).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const istDay = (ms: number) => Math.floor((ms + IST_OFFSET_MS) / 86_400_000);

/** "Logged today", "Logged yesterday", "Last log 3 Nov" (India days, invariant 4). */
export function lastLoggedText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Nothing logged yet';
  const ms = new Date(iso).getTime();
  const days = istDay(now.getTime()) - istDay(ms);
  if (days <= 0) return 'Logged today';
  if (days === 1) return 'Logged yesterday';
  const shifted = new Date(ms + IST_OFFSET_MS);
  return `Last log ${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]}`;
}

/** "3 Nov 2026" in India time. */
export function sinceText(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
}

/** The coach's name as the viewer reads it: "You" for their own client. */
export function coachLabel(coachId: string, coachName: string | null, myId: string | null): string {
  if (coachId === myId) return 'You';
  return coachName ?? 'Coach';
}

export const CLIENT_TEXTS = {
  addedNoEmail: 'We couldn’t email them. Please tell them yourself.',
  addedEmailed: 'We emailed them.',
  waitingSub: 'Waiting for FitSphere account',
  waitingBanner: (email: string) => `Waiting for a FitSphere account. Ask them to sign up in the FitSphere app with ${email}. They join your gym automatically.`,
  cancelWaitingBody: (name: string) => `This removes ${name} from your waiting list. Nothing else changes. You can add them again at any time.`,
  addedWaitingSub: (name: string) => `${name} is waiting for a FitSphere account. When they sign up in the FitSphere app with this email, they join your gym automatically.`,
  candidatesNone: 'No one matches. People appear here when they switch on “Open to joining a gym” in the FitSphere app.',
  editSaved: 'Saved.',
  editInvalid: 'Check the name (2 or more letters) and the phone number.',
  editNameLabel: 'Client name',
  emailLocked: 'The email is the client’s login, so it can’t be changed here.',
  notesLabel: 'Notes (only your gym sees these)',
  exercisesEmpty: 'No training plan yet. Create one in Workouts and it appears here.',
  exercisesDraft: 'Draft, not published to the client yet',
  loggedNone: 'Nothing logged yet in the FitSphere app.',
  addSub: 'Add anyone by name and email. If they have no FitSphere account yet, they wait in your list and join your gym when they sign up. Their own calendar changes then appear in your calendar.',
  addInfo: 'You are adding this person to your gym, and they agree to share their data with it. We never create their login: they sign up in the FitSphere app themselves.',
  addNameLabel: 'Client name',
  addCannot: 'This person can’t be added to your gym.',
  addNotRegistered: 'No FitSphere account uses this email. Ask them to sign up in the FitSphere app first.',
  addInvalid: 'Enter their name and an email like name@example.com.',
  addedSub: (name: string) => `${name} is now a client of your gym. They keep using their own FitSphere account.`,
  empty: 'No clients yet',
  emptyInviteSub: 'Invite a trainee by email. When they accept in the FitSphere app, they appear here and you can see what they log.',
  inviteSub: 'Enter their email. They accept in the FitSphere app, and you see their data once they do.',
  inviteInfo: 'The invite works for 7 days. You can cancel it any time.',
  alreadyAdded: 'This trainee is already added.',
  cannotInvite: 'This email can’t be invited here.',
  inviteLimit: 'You have sent the most invites allowed today. Try again tomorrow.',
  inviteEmailFailed: 'Couldn’t send the invite. Check your connection and try again.',
  inviteInvalid: 'Enter an email address like name@example.com.',
  inviteSent: (email: string) => `We emailed ${email} if they have no FitSphere account yet; otherwise they will see the invite when they open the FitSphere app. When they accept, they appear in your clients. The invite expires in 7 days.`,
  emptySub: 'When a trainee joins your gym, they appear here and you can see what they log. Inviting clients arrives in the next update.',
  noMatch: 'No clients match.',
  removeBody: (name: string) =>
    `This ends your link with ${name}. You will not see anything new they log. History up to today stays in your gym, read-only. Nothing is deleted, and they keep their FitSphere account.`,
  moveBody: (name: string) => `${name} stays your gym's client. The new coach sees their data, and the change is recorded.`,
  notFound: 'This client is no longer available.',
  refused: "You can't do this.",
} as const;
