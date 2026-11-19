// CF09 calendar: the views, scheduling a workout (with review and conflicts) and a diet plan, and one activity.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { useAccount } from './account/AccountProvider';
import Calendar from './app/calendar';
import CalendarActivity from './app/calendar-activity';
import CalendarClient from './app/calendar-client';
import CalendarScheduleDiet from './app/calendar-schedule-diet';
import CalendarScheduleWorkout from './app/calendar-schedule-workout';
import { addDays, dayTableRows, dayTitle, monthGrid, monthTitle, timeText, weekStart, weekTitle, whenText } from './calendar/texts';
import { deps, errorBody, fakeApi, fakeClient, Providers, session } from './testing/fakes';
import { todayIst } from './workouts/texts';

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
const ARJUN = '33333333-3333-4333-8333-333333333333';
const PLAN = '66666666-6666-4666-8666-666666666666';
const ACT = '88888888-8888-4888-8888-888888888888';
const me = (roles: string[]) => ({ user: { id: ME, email: 'coach@example.test', createdAt: '2026-11-03T08:00:00Z' }, roles, coach: { fullName: 'Asha Rao' } });
const TODAY = todayIst();

const activity = (over: object = {}) => ({
  id: ACT, kind: 'workout', traineeId: ARJUN, traineeName: 'Arjun Mehta', coachId: ME, coachName: 'Asha Rao', title: 'Pull', planName: 'Push / Pull / Legs',
  startDate: TODAY, endDate: TODAY, time: '07:00', notes: 'Warm up', status: 'assigned', ...over,
});
const diet = (over: object = {}) => activity({ id: 'n1', kind: 'nutrition', title: 'Lean 1,800', planName: 'Lean 1,800', time: null, endDate: addDays(TODAY, 20), ...over });
const clients = {
  clients: [{ id: ARJUN, name: 'arjun@example.test', coachId: ME, coachName: 'Asha Rao', startedAt: '2026-11-03T08:00:00.000Z', lastLoggedAt: null }],
  coaches: [], canInvite: false, invitations: [],
};
const options = (over: object = {}) => ({
  workoutPlan: { id: PLAN, name: 'Push / Pull / Legs', days: [{ index: 0, name: 'Push' }, { index: 2, name: 'Pull' }] },
  dietPlan: { id: 'd1', name: 'Lean 1,800' },
  ...over,
});
const detail = (over: object = {}) => ({
  ...activity(),
  history: [{ action: 'scheduled', fromDate: null, toDate: TODAY, reason: null, actorName: 'Ravi Kumar', actorRole: 'coach', at: '2026-11-09T13:10:00.000Z' }],
  ...over,
});

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

describe('calendar texts', () => {
  it('builds the Monday-first grid of whole weeks for a month', () => {
    const cells = monthGrid('2026-11-11');
    expect(cells[0]).toBe('2026-10-26');
    expect(cells.at(-1)).toBe('2026-12-06');
    expect(cells).toHaveLength(42);
    expect(monthGrid('2027-02-10')).toHaveLength(28); // 1 Feb 2027 is a Monday
    expect(monthGrid('2026-02-10')).toHaveLength(35);
    expect(weekStart('2026-11-11')).toBe('2026-11-09');
  });
  it('writes titles, times and ranges the way coaches read them', () => {
    expect(monthTitle('2026-11-11')).toBe('November 2026');
    expect(dayTitle('2026-11-11')).toBe('Wed, 11 Nov');
    expect(weekTitle('2026-11-11')).toBe('9 – 15 Nov');
    expect(weekTitle('2026-11-25')).toBe('23 – 29 Nov');
    expect(weekTitle('2026-11-30')).toBe('30 Nov – 6 Dec');
    expect(timeText('07:00')).toBe('7:00 am');
    expect(timeText('18:30')).toBe('6:30 pm');
    expect(timeText('12:05')).toBe('12:05 pm');
    expect(timeText(null)).toBe('All day');
    expect(whenText({ kind: 'workout', startDate: '2026-11-12', endDate: '2026-11-12', time: '07:00' })).toBe('Thu 12 Nov · 7:00 am');
    expect(whenText({ kind: 'nutrition', startDate: '2026-11-17', endDate: '2026-12-14', time: null })).toBe('17 Nov to 14 Dec');
  });
});

describe('day table rows', () => {
  const a = (over: object) => activity(over) as never;
  it('groups a day into one row per client, by name, with the status that needs attention first', () => {
    const rows = dayTableRows([
      a({ id: '1', traineeId: 'z', traineeName: 'Zoya Khan', status: 'completed' }),
      a({ id: '2', traineeId: 'a', traineeName: 'Arjun Mehta', time: '18:30', status: 'completed' }),
      a({ id: '3', traineeId: 'a', traineeName: 'Arjun Mehta', time: '07:00', status: 'missed' }),
      a({ id: '4', traineeId: 'a', traineeName: 'Arjun Mehta', kind: 'nutrition', time: null, status: 'assigned' }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Arjun Mehta', 'Zoya Khan']);
    expect(rows[0]?.workouts.map((w) => w.id)).toEqual(['3', '2']);
    expect(rows[0]?.diets.map((d) => d.id)).toEqual(['4']);
    expect(rows[0]?.status).toBe('missed');
    expect(rows[1]?.status).toBe('completed');
  });
});

describe('Calendar', () => {
  it('shows the day as a table: a row per client with the workout, the diet plan and one status', async () => {
    await open(<Calendar />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: { activities: [activity(), diet(), activity({ id: 'p1', traineeId: 'p', traineeName: 'Priya Nair', kind: 'nutrition', title: 'Cut', time: null, status: 'completed' })], coaches: [] } },
    ]);
    await screen.findByText('Pull');
    await fireEvent.press(screen.getByRole('radio', { name: 'Day' }));
    const table = await screen.findByLabelText('Day table');
    expect(table).toBeTruthy();
    expect(screen.getAllByText('Arjun Mehta').length).toBeGreaterThan(0);
    expect(screen.getByText('Priya Nair')).toBeTruthy();
    expect(screen.getAllByLabelText('None')).toHaveLength(1);
    await fireEvent.press(screen.getAllByRole('button', { name: /^Nutrition: Lean 1,800, Arjun Mehta/ })[0] as never);
    expect(mockRouter.push).toHaveBeenCalledWith('/calendar-activity?id=n1');
  });

  it('asks whether to add a workout or a diet plan, and keeps the chosen client', async () => {
    await open(<Calendar />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: { activities: [], coaches: [] } },
      { status: 200, body: { activities: [], coaches: [] } },
    ]);
    await screen.findByText('Nothing scheduled');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(await screen.findByText('What do you want to schedule?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Diet plan' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/calendar-schedule-diet');
    await fireEvent.press(screen.getByRole('button', { name: 'Clients: All clients' }));
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'arjun@example.test' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add to calendar' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Workout' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/calendar-schedule-workout?traineeId=${ARJUN}`);
  });

  it('shows the month, with the day’s activities and their status, and asks the server for the whole grid', async () => {
    const api = await open(<Calendar />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: { activities: [activity(), diet()], coaches: [] } },
    ]);
    expect(await screen.findByText('Pull')).toBeTruthy();
    expect(screen.getByText('Lean 1,800')).toBeTruthy();
    expect(screen.getAllByLabelText('Status: Assigned')).toHaveLength(2);
    expect(screen.getByText(monthTitle(TODAY).toUpperCase())).toBeTruthy();
    const call = api.requests.find((r) => r.url.includes('/calendar?'));
    const cells = monthGrid(TODAY);
    expect(call?.url).toBe(`http://api.test/v1/calendar?from=${cells[0]}&to=${cells.at(-1)}`);
    await fireEvent.press(screen.getByRole('button', { name: /^Workout: Pull, Arjun Mehta, Assigned/ }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/calendar-activity?id=${ACT}`);
  });

  it('switches to the week and day views without asking again', async () => {
    const api = await open(<Calendar />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: { activities: [activity({ status: 'completed' })], coaches: [] } },
    ]);
    await screen.findByText('Pull');
    const before = api.requests.length;
    await fireEvent.press(screen.getByRole('radio', { name: 'Week' }));
    expect(screen.getByText('Pull')).toBeTruthy();
    expect(screen.getByLabelText('Status: Completed')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Day' }));
    expect(screen.getByText(/today · 1 activity/i)).toBeTruthy();
    expect(api.requests.length).toBe(before);
  });

  it('warns, without blocking, when a client has two workouts at the same time', async () => {
    await open(<Calendar />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: { activities: [activity(), activity({ id: 'x2', title: 'Legs' })], coaches: [] } },
    ]);
    await screen.findByText('Pull');
    await fireEvent.press(screen.getByRole('radio', { name: 'Day' }));
    expect(await screen.findByText(/two workouts at the same time/)).toBeTruthy();
  });

  it('filters by client and by coach (Head Coach only) on the server', async () => {
    const api = await open(<Calendar />, ['head_coach', 'personal'], [
      { status: 200, body: clients },
      { status: 200, body: { activities: [], coaches: [{ id: 'c9', name: 'Meera Joshi' }] } },
      { status: 200, body: { activities: [], coaches: [{ id: 'c9', name: 'Meera Joshi' }] } },
      { status: 200, body: { activities: [], coaches: [{ id: 'c9', name: 'Meera Joshi' }] } },
    ]);
    await screen.findByRole('radio', { name: 'Meera Joshi' });
    await fireEvent.press(screen.getByRole('radio', { name: 'Meera Joshi' }));
    await screen.findByRole('radio', { name: 'Meera Joshi', selected: true });
    expect(api.requests.at(-1)?.url).toContain('coachId=c9');
    await fireEvent.press(screen.getByRole('button', { name: 'Clients: All clients' }));
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'arjun@example.test' }));
    await screen.findByRole('button', { name: 'Clients: arjun@example.test' });
    expect(api.requests.at(-1)?.url).toContain(`traineeId=${ARJUN}`);
  });

  it('gives a Coach no coach filter, and says when nothing is scheduled', async () => {
    await open(<Calendar />, ['coach'], [{ status: 200, body: clients }, { status: 200, body: { activities: [], coaches: [] } }]);
    expect(await screen.findByText('Nothing scheduled')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'All coaches' })).toBeNull();
  });

  it('shows a calm message when the server is unavailable', async () => {
    await open(<Calendar />, ['coach'], [{ status: 200, body: clients }, { status: 500, body: null }]);
    expect(await screen.findByText('Something went wrong. Try again later.')).toBeTruthy();
  });
});

describe('Schedule a workout', () => {
  const previewBody = { dates: [{ date: addDays(TODAY, 1), dayIndex: 0, dayName: 'Push', conflict: false }, { date: addDays(TODAY, 3), dayIndex: 2, dayName: 'Pull', conflict: true }] };

  async function ready() {
    mockParams = { traineeId: ARJUN };
    const api = await open(<CalendarScheduleWorkout />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: options() },
      { status: 200, body: previewBody },
      { status: 200, body: { dates: previewBody.dates.slice(0, 1) } },
      { status: 201, body: { count: 1, conflicts: [] } },
    ]);
    await screen.findByText(/review dates · 2 workouts/i);
    return api;
  }

  it('offers the client’s active plan, previews the dates with a conflict warning, and saves them', async () => {
    const api = await ready();
    expect(screen.getByText('Push / Pull / Legs')).toBeTruthy();
    expect(screen.getByText(/already has a workout at the same time/)).toBeTruthy();
    expect(api.requests.find((r) => r.url.endsWith('/preview'))?.body).toMatchObject({ traineeId: ARJUN, planId: PLAN, dayIndex: 0, time: '07:00', repeat: null, skipDates: [] });
    await fireEvent.press(screen.getByRole('radio', { name: 'Pull' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save 2 workouts' }));
    await screen.findByRole('button', { name: /^Save/ });
    const post = api.requests.find((r) => r.url.endsWith('/calendar/workouts') && r.method === 'POST');
    expect(post?.body).toMatchObject({ planId: PLAN, dayIndex: 2, time: '07:00' });
    expect(mockRouter.replace).toHaveBeenCalledWith('/calendar');
  });

  it('repeats weekly on chosen days, and lets a reviewed date be taken out', async () => {
    mockParams = { traineeId: ARJUN };
    const api = await open(<CalendarScheduleWorkout />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: options() },
      { status: 200, body: { dates: previewBody.dates.slice(0, 1) } },
      { status: 200, body: previewBody },
      { status: 200, body: { dates: previewBody.dates.slice(1) } },
    ]);
    await screen.findByText(/review dates · 1 workout/i);
    await fireEvent.press(screen.getByRole('radio', { name: 'Weekly' }));
    await screen.findByText(/review dates · 2 workouts/i);
    const previews = () => api.requests.filter((r) => r.url.endsWith('/preview')).map((r) => r.body as { repeat: { weekdays: number[]; weeks: number } | null; skipDates: string[] });
    expect(previews().at(-1)?.repeat).toMatchObject({ weeks: 4 });
    expect(previews().at(-1)?.repeat?.weekdays).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: `Remove ${dayTitle(previewBody.dates[0]!.date)}` }));
    await screen.findByText(/review dates · 1 workout/i);
    expect(previews().at(-1)?.skipDates).toEqual([previewBody.dates[0]!.date]);
  });

  it('says what to do when the client has no active workout plan, and refuses a bad time without asking the server', async () => {
    mockParams = { traineeId: ARJUN };
    await open(<CalendarScheduleWorkout />, ['coach'], [{ status: 200, body: clients }, { status: 200, body: options({ workoutPlan: null }) }]);
    expect(await screen.findByText(/no active workout plan/)).toBeTruthy();
  });

  it('gives the client a template as their plan, then offers its days to schedule, when they have no active workout plan', async () => {
    mockParams = { traineeId: ARJUN };
    const template = { id: 'tpl1', name: 'Starter 3-day', goal: 'general_fitness', difficulty: 'beginner', visibility: 'gym', active: true, days: 3, exercises: 9, canEdit: true, updatedAt: '2026-11-09T10:00:00.000Z' };
    const api = await open(<CalendarScheduleWorkout />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: options({ workoutPlan: null }) },
      { status: 200, body: { templates: [template] } },
      { status: 201, body: { plans: [{ id: PLAN }] } },
      { status: 200, body: options() },
      { status: 200, body: previewBody },
    ]);
    await fireEvent.press(await screen.findByRole('button', { name: /^Workout template:/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Starter 3-day' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Use this template' }));
    expect(await screen.findByRole('radio', { name: 'Push' })).toBeTruthy();
    const assign = api.requests.find((r) => r.method === 'POST' && r.url === 'http://api.test/v1/training-plans');
    expect(assign?.body).toMatchObject({ templateId: 'tpl1', traineeIds: [ARJUN], startDate: addDays(TODAY, 1), publish: true });
  });

  it('shows the server answer when the dates are refused', async () => {
    mockParams = { traineeId: ARJUN };
    await open(<CalendarScheduleWorkout />, ['coach'], [{ status: 200, body: clients }, { status: 200, body: options() }, { status: 400, body: errorBody('VALIDATION_FAILED') }]);
    expect(await screen.findByText(/Check the date, the time/)).toBeTruthy();
  });

  it('checks the time before asking the server', async () => {
    const api = await ready();
    await fireEvent.changeText(screen.getByLabelText('Time (optional)'), '7am');
    expect(await screen.findByText(/Use 24-hour time like 07:00/)).toBeTruthy();
    const asked = api.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.requests.length).toBe(asked);
  });
});

describe('Schedule a diet plan', () => {
  it('schedules the active diet plan over a range, with the replace warning', async () => {
    mockParams = { traineeId: ARJUN };
    const api = await open(<CalendarScheduleDiet />, ['coach'], [{ status: 200, body: clients }, { status: 200, body: options() }, { status: 201, body: { count: 1, conflicts: [] } }]);
    expect(await screen.findByText(/28 days/)).toBeTruthy();
    expect(screen.getByText(/cut short or replaced/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save schedule' }));
    await screen.findByRole('button', { name: 'Save schedule' });
    const post = api.requests.at(-1);
    expect(post).toMatchObject({ method: 'POST', url: 'http://api.test/v1/calendar/nutrition' });
    expect(post?.body).toMatchObject({ traineeId: ARJUN, planId: 'd1', from: addDays(TODAY, 1), to: addDays(TODAY, 28) });
    expect(mockRouter.replace).toHaveBeenCalledWith('/calendar');
  });

  it('says what to do when the client has no active diet plan', async () => {
    mockParams = { traineeId: ARJUN };
    await open(<CalendarScheduleDiet />, ['coach'], [{ status: 200, body: clients }, { status: 200, body: options({ dietPlan: null }) }]);
    expect(await screen.findByText(/no active diet plan/)).toBeTruthy();
  });

  it('gives the client a template as their plan, then schedules it, when they have no active diet plan', async () => {
    mockParams = { traineeId: ARJUN };
    const template = { id: 'tpl1', name: 'Lean 1,800', goal: 'weight_loss', visibility: 'gym', active: true, slots: 2, options: 2, calorieTarget: 1800, canEdit: true, updatedAt: '2026-11-09T10:00:00.000Z' };
    const api = await open(<CalendarScheduleDiet />, ['coach'], [
      { status: 200, body: clients },
      { status: 200, body: options({ dietPlan: null }) },
      { status: 200, body: { templates: [template] } },
      { status: 201, body: { plans: [{ id: 'newplan' }] } },
      { status: 201, body: { count: 1, conflicts: [] } },
    ]);
    expect(screen.queryByRole('button', { name: 'Save schedule' })).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: /^Diet template:/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Lean 1,800' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/calendar'));
    const [assign, schedule] = api.requests.slice(-2);
    expect(assign).toMatchObject({ method: 'POST', url: 'http://api.test/v1/diet-plans' });
    expect(assign?.body).toMatchObject({ templateId: 'tpl1', traineeIds: [ARJUN], startDate: addDays(TODAY, 1), publish: true });
    expect(schedule).toMatchObject({ method: 'POST', url: 'http://api.test/v1/calendar/nutrition' });
    expect(schedule?.body).toMatchObject({ traineeId: ARJUN, planId: 'newplan' });
  });
});

describe('Activity', () => {
  beforeEach(() => {
    mockParams = { id: ACT };
  });

  it('shows the status first, then when, plan, coach, notes and the history', async () => {
    await open(<CalendarActivity />, ['coach'], [{ status: 200, body: { activity: detail() } }]);
    expect(await screen.findByLabelText('Status: Assigned')).toBeTruthy();
    expect(screen.getByText('Push / Pull / Legs')).toBeTruthy();
    expect(screen.getByText('Warm up')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar (Coach) · 9 Nov, 6:40 pm')).toBeTruthy();
    expect(screen.getByText(/Completed automatically when the client logs this workout/)).toBeTruthy();
  });

  it('marks it done', async () => {
    const api = await open(<CalendarActivity />, ['coach'], [
      { status: 200, body: { activity: detail() } },
      { status: 200, body: { activity: detail({ status: 'completed' }) } },
    ]);
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark as done' }));
    expect(await screen.findByLabelText('Status: Completed')).toBeTruthy();
    expect(api.requests.at(-1)).toMatchObject({ method: 'POST', url: `http://api.test/v1/calendar/activities/${ACT}/complete` });
    expect(screen.queryByRole('button', { name: 'Mark as done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });

  it('reschedules with a new date, time and reason, and shows it as rescheduled', async () => {
    const api = await open(<CalendarActivity />, ['coach'], [
      { status: 200, body: { activity: detail() } },
      { status: 200, body: { activity: detail({ status: 'rescheduled', startDate: addDays(TODAY, 1), history: [{ action: 'moved', fromDate: TODAY, toDate: addDays(TODAY, 1), reason: 'Client is travelling', actorName: 'Ravi Kumar', actorRole: 'coach', at: '2026-11-10T09:02:00.000Z' }] }) } },
    ]);
    await fireEvent.press(await screen.findByRole('button', { name: 'Reschedule' }));
    expect(await screen.findByText(/sees the new date next time they open the FitSphere app/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Later day' }));
    await fireEvent.changeText(screen.getByLabelText('Reason (optional)'), 'Client is travelling');
    await fireEvent.press(screen.getByRole('button', { name: 'Move workout' }));
    expect(await screen.findByLabelText('Status: Rescheduled')).toBeTruthy();
    expect(api.requests.at(-1)).toMatchObject({ method: 'PUT', url: `http://api.test/v1/calendar/activities/${ACT}`, body: { date: addDays(TODAY, 1), time: '07:00', reason: 'Client is travelling' } });
    expect(screen.getByText(/Moved from/)).toBeTruthy();
    expect(screen.getByText(/"Client is travelling"/)).toBeTruthy();
  });

  it('removes only after confirming, then returns to the calendar', async () => {
    const api = await open(<CalendarActivity />, ['coach'], [{ status: 200, body: { activity: detail() } }, { status: 204, body: null }]);
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove from calendar' }));
    expect(await screen.findByText(/The plan itself is not changed, and the history is kept/)).toBeTruthy();
    expect(api.requests.some((r) => r.url.endsWith('/remove'))).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByLabelText('Status: Assigned');
    expect(api.requests.at(-1)).toMatchObject({ method: 'POST', url: `http://api.test/v1/calendar/activities/${ACT}/remove` });
    expect(mockRouter.replace).toHaveBeenCalledWith('/calendar');
  });

  it('says it is no longer available when it is not this coach’s', async () => {
    await open(<CalendarActivity />, ['coach'], [{ status: 404, body: errorBody('NOT_FOUND') }]);
    expect(await screen.findByText('This is no longer available.')).toBeTruthy();
  });
});

describe('Client calendar', () => {
  it('shows the coach, the active plans, what is coming up and what happened lately', async () => {
    mockParams = { id: ARJUN };
    await open(<CalendarClient />, ['coach'], [
      { status: 200, body: { id: ARJUN, name: 'arjun@example.test', coachId: 'c9', coachName: 'Ravi Kumar', startedAt: '2026-11-03T08:00:00.000Z', lastLoggedAt: null, latestWeightKg: null, targets: { calories: null, proteinG: null, weeklyWorkouts: null }, workoutsThisWeek: 0 } },
      { status: 200, body: options() },
      { status: 200, body: { activities: [activity({ id: 'u', title: 'Pull', startDate: addDays(TODAY, 2), endDate: addDays(TODAY, 2) }), activity({ id: 'p', title: 'Legs', startDate: addDays(TODAY, -3), endDate: addDays(TODAY, -3), status: 'missed' })], coaches: [] } },
    ]);
    expect(await screen.findByText('Coach Ravi Kumar')).toBeTruthy();
    expect(screen.getByText('Push / Pull / Legs · Active')).toBeTruthy();
    expect(screen.getByLabelText('Status: Assigned')).toBeTruthy();
    expect(screen.getByLabelText('Status: Missed')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Schedule a workout' }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/calendar-schedule-workout?traineeId=${ARJUN}`);
  });

  it('turns the schedule buttons off when the client has no active plan', async () => {
    mockParams = { id: ARJUN };
    await open(<CalendarClient />, ['coach'], [
      { status: 200, body: { id: ARJUN, name: 'arjun@example.test', coachId: ME, coachName: 'Asha Rao', startedAt: '2026-11-03T08:00:00.000Z', lastLoggedAt: null, latestWeightKg: null, targets: { calories: null, proteinG: null, weeklyWorkouts: null }, workoutsThisWeek: 0 } },
      { status: 200, body: options({ workoutPlan: null, dietPlan: null }) },
      { status: 200, body: { activities: [], coaches: [] } },
    ]);
    expect(await screen.findByRole('button', { name: 'Schedule a workout', disabled: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schedule a diet plan', disabled: true })).toBeTruthy();
  });
});
