// CF04 client management: the list, the profile, moving and removing a client.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { useAccount } from './account/AccountProvider';
import ClientAdd from './app/client-add';
import ClientEdit from './app/client-edit';
import ClientExercises from './app/client-exercises';
import ClientNutrition from './app/client-nutrition';
import ClientProfileScreen from './app/client-profile';
import Clients from './app/clients';
import { coachLabel, lastLoggedText, sinceText } from './clients/texts';
import { deps, fakeApi, fakeClient, Providers, session } from './testing/fakes';

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, dismissAll: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, []),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

const ME = '0b6f2a52-6f4b-4c38-9d1f-2b8e4c1a7d10';
const RAVI = '11111111-1111-4111-8111-111111111111';
const MEERA = '22222222-2222-4222-8222-222222222222';
const ARJUN = '33333333-3333-4333-8333-333333333333';
const me = (roles: string[]) => ({
  user: { id: ME, email: 'coach@example.test', createdAt: '2026-11-03T08:00:00Z' },
  roles,
  coach: { fullName: 'Asha Rao' },
});
const client = (id: string, name: string, coachId = RAVI, coachName: string | null = 'Ravi Kumar') => ({
  id,
  name,
  coachId,
  coachName,
  startedAt: '2026-11-03T08:00:00.000Z',
  lastLoggedAt: new Date().toISOString(),
});
const list = (clients: object[], coaches: object[] = [], extra: object = {}) => ({ status: 200, body: { clients, coaches, canInvite: false, invitations: [], ...extra } });
const profile = (extra: object = {}) => ({
  status: 200,
  body: {
    ...client(ARJUN, 'arjun@example.test'),
    latestWeightKg: 82.4,
    targets: { calories: 2100, proteinG: 140, weeklyWorkouts: 4 },
    workoutsThisWeek: 2,
    ...extra,
  },
});

/** Reads the account first (as the start screen does), then shows the screen. */
function Prime({ children }: { children: ReactNode }) {
  const { refresh } = useAccount();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void refresh().then(() => setReady(true));
  }, [refresh]);
  return ready ? <>{children}</> : null;
}

async function open(element: React.ReactElement, roles: string[], responses: { status: number; body: unknown }[]) {
  const api = fakeApi([{ status: 200, body: me(roles) }, ...responses]);
  const authClient = fakeClient({ getSession: async () => ({ data: { session: session() }, error: null }) }).client;
  await render(
    <Providers authDeps={deps(authClient, api.fetchImpl)}>
      <Prime>{element}</Prime>
    </Providers>,
  );
  return api;
}

describe('client texts', () => {
  it('says when a client last logged, in India days', () => {
    const now = new Date('2026-11-12T08:00:00Z');
    expect(lastLoggedText(null, now)).toBe('Nothing logged yet');
    expect(lastLoggedText('2026-11-12T01:00:00Z', now)).toBe('Logged today');
    expect(lastLoggedText('2026-11-11T08:00:00Z', now)).toBe('Logged yesterday');
    expect(lastLoggedText('2026-11-03T08:00:00Z', now)).toBe('Last log 3 Nov');
    // 20:00 India time the evening before is "yesterday" even though it is the same UTC day.
    expect(lastLoggedText('2026-11-11T20:00:00Z', new Date('2026-11-12T03:00:00Z'))).toBe('Logged today');
    expect(sinceText('2026-11-03T08:00:00.000Z')).toBe('3 Nov 2026');
    expect(coachLabel(ME, null, ME)).toBe('You');
    expect(coachLabel(RAVI, 'Ravi Kumar', ME)).toBe('Ravi Kumar');
  });
});

describe('Client list', () => {
  it("shows each client with their last log and coach, and opens the profile", async () => {
    await open(<Clients />, ['head_coach', 'personal'], [list([client(ARJUN, 'arjun@example.test'), client('44444444-4444-4444-8444-444444444444', 'priya@example.test', ME, 'Asha Rao')])]);
    expect(await screen.findByText('Logged today · Ravi Kumar')).toBeTruthy();
    expect(screen.getByText('Logged today · You')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'arjun@example.test' }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/client-profile?id=${ARJUN}`);
  });

  it("gives the Head Coach a coach filter that asks the server for that coach's clients", async () => {
    const api = await open(<Clients />, ['head_coach', 'personal'], [
      list([client(ARJUN, 'arjun@example.test')], [{ id: RAVI, name: 'Ravi Kumar' }, { id: MEERA, name: 'Meera Joshi' }]),
      list([client(ARJUN, 'arjun@example.test')], [{ id: RAVI, name: 'Ravi Kumar' }, { id: MEERA, name: 'Meera Joshi' }]),
    ]);
    await screen.findByRole('radio', { name: 'Meera Joshi' });
    await fireEvent.press(screen.getByRole('radio', { name: 'Meera Joshi' }));
    await screen.findByRole('radio', { name: 'Meera Joshi', selected: true });
    expect(api.requests.at(-1)?.url).toBe(`http://api.test/v1/clients?coachId=${MEERA}`);
  });

  it('gives a Coach no coach filter', async () => {
    await open(<Clients />, ['coach', 'personal'], [list([client(ARJUN, 'arjun@example.test')])]);
    await screen.findByText('arjun@example.test');
    expect(screen.queryByRole('radio', { name: 'All coaches' })).toBeNull();
  });

  it('searches by what is typed', async () => {
    const api = await open(<Clients />, ['coach'], [list([client(ARJUN, 'arjun@example.test')]), list([])]);
    await screen.findByText('arjun@example.test');
    await fireEvent.changeText(screen.getByLabelText('Search clients'), 'zzz');
    expect(await screen.findByText('No clients match.')).toBeTruthy();
    expect(api.requests.at(-1)?.url).toBe('http://api.test/v1/clients?q=zzz');
  });

  it('says there are no clients yet, and that inviting arrives later', async () => {
    await open(<Clients />, ['coach'], [list([])]);
    expect(await screen.findByText(/Inviting clients arrives in the next update/)).toBeTruthy();
  });

  it('shows the offline text when the server cannot be reached', async () => {
    await open(<Clients />, ['coach'], [{ status: 500, body: null }]);
    expect(await screen.findByText('Something went wrong. Try again later.')).toBeTruthy();
  });
});

describe('Client profile', () => {
  beforeEach(() => {
    mockParams = { id: ARJUN };
  });

  it('shows the coach, the progress and the plans', async () => {
    await open(<ClientProfileScreen />, ['coach'], [profile()]);
    expect(await screen.findByText('82.4 kg')).toBeTruthy();
    expect(screen.getByText('2100 kcal')).toBeTruthy();
    expect(screen.getByText('140 g')).toBeTruthy();
    expect(screen.getByText('2 of 4')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    expect(screen.queryByText('Not set yet')).toBeNull();
    expect(screen.getByText('Open calendar')).toBeTruthy();
    expect(screen.getByText('Open nutrition')).toBeTruthy();
    expect(screen.getByText('See their exercises and what they logged')).toBeTruthy();
  });

  it('shows "Not logged" and "Not set" for a client who has done nothing', async () => {
    await open(<ClientProfileScreen />, ['coach'], [profile({ latestWeightKg: null, targets: { calories: null, proteinG: null, weeklyWorkouts: null }, workoutsThisWeek: 0, lastLoggedAt: null })]);
    expect(await screen.findByText('Not logged')).toBeTruthy();
    expect(screen.getAllByText('Not set')).toHaveLength(2);
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();
  });

  it('says so when the client is not available to this person', async () => {
    await open(<ClientProfileScreen />, ['coach'], [{ status: 404, body: { error: { code: 'NOT_FOUND', message: 'x', retryable: false, requestId: 'r', details: null } } }]);
    expect(await screen.findByText('This client is no longer available.')).toBeTruthy();
  });

  it('removes a client after confirming, then returns to the list', async () => {
    const api = await open(<ClientProfileScreen />, ['coach'], [profile(), { status: 204, body: null }]);
    await screen.findByText('82.4 kg');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove client' }));
    expect(await screen.findByText(/History up to today stays in your gym, read-only/)).toBeTruthy();
    expect(api.requests.some((request) => request.url.endsWith('/remove'))).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm remove client' }));
    await screen.findByText('82.4 kg');
    expect(api.requests.at(-1)).toMatchObject({ method: 'POST', url: `http://api.test/v1/clients/${ARJUN}/remove` });
    expect(mockRouter.replace).toHaveBeenCalledWith('/clients');
  });

  it('keeps the client when the person chooses Keep client', async () => {
    const api = await open(<ClientProfileScreen />, ['coach'], [profile()]);
    await screen.findByText('82.4 kg');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove client' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Keep client' }));
    expect(api.requests.some((request) => request.url.endsWith('/remove'))).toBe(false);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('offers Change coach only to the Head Coach', async () => {
    await open(<ClientProfileScreen />, ['coach'], [profile()]);
    await screen.findByText('82.4 kg');
    expect(screen.queryByRole('button', { name: 'Change coach' })).toBeNull();
  });

  it('lets the Head Coach move a client to another coach, and reloads the profile', async () => {
    const api = await open(<ClientProfileScreen />, ['head_coach', 'personal'], [
      profile(),
      list([], [{ id: RAVI, name: 'Ravi Kumar' }, { id: MEERA, name: 'Meera Joshi' }]),
      { status: 204, body: null },
      profile({ coachId: MEERA, coachName: 'Meera Joshi' }),
    ]);
    await screen.findByText('82.4 kg');
    await screen.findByRole('button', { name: 'Change coach' });
    await fireEvent.press(screen.getByRole('button', { name: 'Change coach' }));
    // The current coach (Ravi) is not offered; the Head Coach themselves and Meera are.
    expect(screen.queryByRole('radio', { name: 'Ravi Kumar' })).toBeNull();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Meera Joshi' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Move client' }));
    await screen.findByText('Meera Joshi');
    expect(api.requests.find((request) => request.url.endsWith('/move'))).toMatchObject({ method: 'POST', body: { coachId: MEERA } });
  });
});

const detailed = (extra: object = {}) =>
  profile({ email: 'priya@example.test', phone: '+91 98765 43210', fitnessGoal: 'weight_loss', notes: 'Mild knee pain', isGymMember: true, ...extra });

describe('Client profile details and edit', () => {
  beforeEach(() => {
    mockParams = { id: ARJUN };
  });

  it('shows the details the gym keeps and opens edit and the exercises', async () => {
    await open(<ClientProfileScreen />, ['coach'], [detailed()]);
    expect(await screen.findByText('priya@example.test')).toBeTruthy();
    expect(screen.getByText('+91 98765 43210')).toBeTruthy();
    expect(screen.getByText('Weight loss')).toBeTruthy();
    expect(screen.getByText('Mild knee pain')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Edit client' }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/client-edit?id=${ARJUN}`);
    await fireEvent.press(screen.getByRole('button', { name: /Training plan · Exercises/ }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/client-exercises?id=${ARJUN}`);
  });

  it('edits the client: the email is locked, the goal and notes are sent, and it goes back', async () => {
    const api = await open(<ClientEdit />, ['coach'], [detailed(), { status: 204, body: null }]);
    const name = await screen.findByLabelText('Client name');
    await fireEvent.changeText(name, '  Priya Nair ');
    await fireEvent.press(screen.getByRole('radio', { name: 'Muscle gain' }));
    await fireEvent.changeText(screen.getByLabelText('Notes (only your gym sees these)'), 'Avoid deep lunges');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    const put = api.requests.find((request) => request.method === 'PUT');
    expect(put).toMatchObject({ url: `http://api.test/v1/clients/${ARJUN}`, body: { fullName: 'Priya Nair', phone: '+91 98765 43210', fitnessGoal: 'muscle_gain', notes: 'Avoid deep lunges' } });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('does not save a too-short name or a bad phone number, and sends nothing', async () => {
    const api = await open(<ClientEdit />, ['coach'], [detailed({ phone: null })]);
    await fireEvent.changeText(await screen.findByLabelText('Client name'), 'P');
    expect(screen.getByRole('button', { name: 'Save changes' }).props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Client name'), 'Priya');
    await fireEvent.changeText(screen.getByLabelText('Phone (optional)'), 'abc');
    expect(await screen.findByText('Enter a phone number like +91 98765 43210.')).toBeTruthy();
    expect(api.requests.some((request) => request.method === 'PUT')).toBe(false);
  });
});

describe('Client exercises', () => {
  beforeEach(() => {
    mockParams = { id: ARJUN };
  });
  const plan = (status = 'active') => ({
    plan: {
      id: 'p1',
      name: 'Push Pull Legs',
      status,
      weeks: 8,
      days: [
        {
          name: 'Push',
          weekday: 1,
          rest: false,
          exercises: [
            {
              exerciseId: 'barbell-flat-bench-press',
              name: 'Barbell Flat Bench Press',
              sets: 4,
              repsMin: 8,
              repsMax: 10,
              weightG: 60000,
              rpe: 8,
              restS: 120,
              note: 'Pause on chest',
              detail: {
                code: 'barbell-flat-bench-press', name: 'Barbell Flat Bench Press', group: 'barbell', category: 'Barbell', primaryMuscle: 'Chest', equipment: 'Barbell', logType: 'weight_reps',
                subGroup: null, musclesWorked: ['Triceps'], tags: [], steps: ['Lie flat', 'Press up'], watchFor: 'Keep your feet down', videoUrl: 'https://example.test/bench',
              },
            },
          ],
        },
      ],
    },
    recent: [{ day: '2026-11-10', exercises: [{ name: 'Bench press', sets: 3, reps: 10, weightG: 50000, note: null }] }],
  });

  it('shows the plan, opens an exercise for its details, and lists what the client logged', async () => {
    await open(<ClientExercises />, ['coach'], [{ status: 200, body: plan() }]);
    expect(await screen.findByText('Barbell Flat Bench Press')).toBeTruthy();
    expect(screen.getByText('4 × 8–10 · 60 kg · RPE 8 · Rest 2:00')).toBeTruthy();
    expect(screen.queryByText('1. Lie flat')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /Barbell Flat Bench Press, 4 × 8–10/ }));
    expect(await screen.findByText('1. Lie flat')).toBeTruthy();
    expect(screen.getByText('Watch for: Keep your feet down')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Watch video for Barbell Flat Bench Press' })).toBeTruthy();
    expect(screen.getByText("Coach's note: Pause on chest")).toBeTruthy();
    expect(screen.getByText('Bench press · 3 × 10 · 50 kg')).toBeTruthy();
  });

  it('says a draft is not published yet, and shows an empty state without a plan', async () => {
    await open(<ClientExercises />, ['coach'], [{ status: 200, body: plan('draft') }]);
    expect(await screen.findByText('Draft, not published to the client yet')).toBeTruthy();
  });

  it('shows the empty states', async () => {
    await open(<ClientExercises />, ['coach'], [{ status: 200, body: { plan: null, recent: [] } }]);
    expect(await screen.findByText('No training plan yet. Create one in Workouts and it appears here.')).toBeTruthy();
    expect(screen.getByText('Nothing logged yet in the FitSphere app.')).toBeTruthy();
  });
});

describe('Add client: people open to joining a gym', () => {
  const candidates = (enabled: boolean, people: object[] = []) => ({ status: 200, body: { enabled, people } });

  it('shows the people who opted in, and fills the email when one is tapped', async () => {
    await open(<ClientAdd />, ['head_coach'], [list([], []), candidates(true, [{ id: ARJUN, email: 'arjun@example.test' }])]);
    expect(await screen.findByText('PEOPLE OPEN TO JOINING A GYM')).toBeTruthy();
    await fireEvent.press(await screen.findByRole('button', { name: 'Use arjun@example.test' }));
    expect(screen.getByDisplayValue('arjun@example.test')).toBeTruthy();
  });

  it('hides the list until the trainee app has the setting', async () => {
    await open(<ClientAdd />, ['head_coach'], [list([], []), candidates(false)]);
    await screen.findByLabelText('Client email');
    expect(screen.queryByText('PEOPLE OPEN TO JOINING A GYM')).toBeNull();
  });
});

describe('Waiting clients', () => {
  const waiting = (id: string, name: string) => ({ id, name, coachId: RAVI, coachName: 'Ravi Kumar', startedAt: '2026-11-12T08:00:00.000Z', lastLoggedAt: null, waiting: true });

  it('lists a waiting client with a Waiting badge and filters by Waiting', async () => {
    await open(<Clients />, ['coach'], [list([client(ARJUN, 'arjun@example.test'), waiting(MEERA, 'Waiting Wendy')])]);
    expect(await screen.findByText('Waiting Wendy')).toBeTruthy();
    expect(screen.getByText('WAITING')).toBeTruthy();
    expect(screen.getByText(/Waiting for FitSphere account · Ravi Kumar/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Waiting 1' }));
    expect(screen.queryByText('arjun@example.test')).toBeNull();
    expect(screen.getByText('Waiting Wendy')).toBeTruthy();
  });

  it('shows a waiting profile: a banner, no progress or plans, and a Cancel waiting button', async () => {
    mockParams = { id: MEERA };
    await open(<ClientProfileScreen />, ['coach'], [profile({ ...waiting(MEERA, 'Waiting Wendy'), email: 'wendy@example.test', latestWeightKg: null, targets: { calories: null, proteinG: null, weeklyWorkouts: null }, workoutsThisWeek: 0, isGymMember: false })]);
    expect(await screen.findByText(/Waiting for a FitSphere account\. Ask them to sign up in the FitSphere app with wendy@example\.test/)).toBeTruthy();
    expect(screen.queryByText('PROGRESS')).toBeNull();
    expect(screen.queryByText('PLANS AND SCHEDULE')).toBeNull();
    expect(screen.getByText('CANCEL WAITING')).toBeTruthy();
    expect(screen.queryByText('REMOVE CLIENT')).toBeNull();
  });

  it('the add screen goes to the waiting message when the client has no account yet', async () => {
    const api = await open(<ClientAdd />, ['coach'], [{ status: 201, body: { client: { id: MEERA, waiting: true } } }]);
    await fireEvent.changeText(await screen.findByLabelText('Client name'), 'Waiting Wendy');
    await fireEvent.changeText(screen.getByLabelText('Client email'), 'wendy@example.test');
    await fireEvent.press(screen.getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/client-added?name=Waiting%20Wendy&waiting=1'));
    expect(api.requests.find((request) => request.method === 'POST')).toMatchObject({ body: { email: 'wendy@example.test', fullName: 'Waiting Wendy' } });
  });
});

describe('Client food log', () => {
  beforeEach(() => {
    mockParams = { id: ARJUN };
  });
  const meal = (over: object = {}) => ({
    id: 'm1', mealType: 'lunch', recordedAt: '2026-11-12T07:50:03.000Z', kcal: 473.23, proteinG: 5, carbsG: 61.5, fatG: 23, fibreG: null,
    items: [{ name: 'Mango & Banana Fruit Clusters', amount: { value: 100, unit: 'g' }, kcal: 473.23, proteinG: 5, carbsG: 61.5, fatG: 23, estimated: false }],
    photo: null, ...over,
  });
  const nutrition = (over: object = {}) => ({
    status: 200,
    body: {
      day: '2026-11-12',
      totals: { kcal: 473.23, proteinG: 5, carbsG: 61.5, fatG: 23, fibreG: 0 },
      targets: { kcal: 1800, proteinG: 110, carbsG: null, fatG: null, fibreG: null },
      meals: [meal()],
      week: [{ day: '2026-11-12', kcal: 473, meals: 1 }, { day: '2026-11-11', kcal: 1750, meals: 3 }],
      ...over,
    },
  });

  it('shows the totals against the targets, each meal with its foods, and the last 7 days', async () => {
    await open(<ClientNutrition />, ['coach'], [nutrition()]);
    expect(await screen.findByText('LUNCH · 1:20 pm')).toBeTruthy();
    expect(screen.getByText('Mango & Banana Fruit Clusters')).toBeTruthy();
    expect(screen.getByText('100 g · 473 kcal')).toBeTruthy();
    expect(screen.getByText('473 / 1800 kcal')).toBeTruthy();
    expect(screen.getByText('5 / 110 g')).toBeTruthy();
    expect(screen.getByLabelText('Thu 12 Nov, 473 kcal')).toBeTruthy();
    expect(screen.getByLabelText('Wed 11 Nov, 1750 kcal')).toBeTruthy();
  });

  it('shows a photo link as a link and a stored photo as not viewable yet', async () => {
    await open(<ClientNutrition />, ['coach'], [nutrition({ meals: [meal({ photo: { kind: 'link', url: 'https://example.test/p' } }), meal({ id: 'm2', mealType: 'dinner', photo: { kind: 'stored' } })] })]);
    expect(await screen.findByRole('link', { name: 'Open the photo link' })).toBeTruthy();
    expect(screen.getByText('Photo saved in the FitSphere app (not viewable here yet).')).toBeTruthy();
  });

  it('says so on an empty day, and moves to the day before', async () => {
    const api = await open(<ClientNutrition />, ['coach'], [nutrition({ meals: [], totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 } }), nutrition({ day: '2026-11-11' })]);
    expect(await screen.findByText('Nothing logged on this day.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() => expect(api.requests.some((r) => r.url.endsWith('/nutrition?day=2026-11-11'))).toBe(true));
  });

  it('refreshes by itself every 20 seconds', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const api = await open(<ClientNutrition />, ['coach'], [nutrition(), nutrition({ meals: [meal({ id: 'm9', mealType: 'snack', items: [{ name: 'Banana', amount: null, kcal: 90, proteinG: 1, carbsG: 23, fatG: 0, estimated: true }] })] })]);
      await screen.findByText('Mango & Banana Fruit Clusters');
      await act(async () => {
        jest.advanceTimersByTime(20_000);
      });
      expect(await screen.findByText('Banana')).toBeTruthy();
      expect(screen.getByText('≈ 90 kcal')).toBeTruthy();
      expect(api.requests.filter((r) => r.url.includes('/nutrition')).length).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows "not available" for a client that is not theirs', async () => {
    await open(<ClientNutrition />, ['coach'], [{ status: 404, body: { error: { code: 'NOT_FOUND', message: 'x', retryable: false, requestId: 'r', details: null } } }]);
    expect(await screen.findByText('This client is no longer available.')).toBeTruthy();
  });
});
