// Test doubles: a fake Supabase auth client and a fake coach API, plus a wrapper with the app's
// providers. Synthetic data only.
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountProvider } from '../account/AccountProvider';
import { AuthProvider } from '../auth/AuthProvider';
import type { AuthClient, AuthDeps, MinimalSession } from '../auth/service';
import { ThemeProvider } from '../theme';

type ErrorLike = { name?: string; code?: string; status?: number } | null;

export function session(metadata: Record<string, unknown> = {}, token = 'token-1'): MinimalSession {
  return { access_token: token, user: { id: 'user-1', email: 'coach@example.test', user_metadata: metadata } };
}

export function fakeClient(overrides: Partial<AuthClient> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    <T,>(method: string, result: T) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };
  const ok = { error: null as ErrorLike };
  const client: AuthClient = {
    signUp: record('signUp', ok),
    signInWithPassword: record('signInWithPassword', { data: { session: session() }, error: null }),
    signOut: record('signOut', ok),
    getSession: record('getSession', { data: { session: null }, error: null }),
    refreshSession: record('refreshSession', { data: { session: null }, error: null }),
    updateUser: record('updateUser', ok),
    resetPasswordForEmail: record('resetPasswordForEmail', ok),
    exchangeCodeForSession: record('exchangeCodeForSession', { data: { session: session() }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    ...overrides,
  };
  return { client, calls };
}

/** Answers coach API calls from a list of responses, in order, and records the requests. */
/** Synthetic exercise library answers (CF06). Exercise calls never use up the scripted responses. */
const LIBRARY = [
  { code: 'plank', name: 'Plank', group: 'bodyweight', category: 'Core / Abs', primaryMuscle: 'Abs', equipment: 'Bodyweight', logType: 'time' },
  { code: 'bench-press', name: 'Bench press', group: 'barbell', category: 'Barbell', primaryMuscle: 'Chest', equipment: 'Barbell', logType: 'weight_reps' },
  { code: 'push-up', name: 'Push-up', group: 'bodyweight', category: 'Bodyweight / Calisthenics', primaryMuscle: 'Chest', equipment: 'Bodyweight', logType: 'reps' },
];
function exerciseReply(url: string): unknown {
  const path = new URL(url).pathname + new URL(url).search;
  if (path.startsWith('/v1/exercises/filters')) {
    return {
      categories: [{ value: 'Core / Abs', count: 1 }, { value: 'Barbell', count: 1 }],
      muscles: [{ value: 'Chest', count: 2 }],
      equipment: [{ value: 'Bodyweight', count: 2 }],
      groups: [{ value: 'bodyweight', count: 2 }],
    };
  }
  const codes = new URL(url).searchParams.get('codes');
  if (codes) return { exercises: LIBRARY.filter((exercise) => codes.split(',').includes(exercise.code)) };
  const q = (new URL(url).searchParams.get('q') ?? '').toLowerCase();
  const category = new URL(url).searchParams.get('category');
  const list = LIBRARY.filter((exercise) => exercise.name.toLowerCase().includes(q) && (!category || exercise.category === category));
  return { exercises: list, total: list.length };
}

/** Synthetic food list answers (CF07). Food calls never use up the scripted responses. */
const FOOD_LIST = [
  { id: '11111111-aaaa-4aaa-8aaa-111111111111', name: 'Paneer', group: 'Milk and Milk Products', per100g: { kcal: 265, proteinG: 18.3, carbsG: 1.2, fatG: 20.8, fibreG: 0 }, portions: [{ label: 'Slice', grams: 25 }, { label: '1 katori', grams: 150 }] },
  { id: '22222222-bbbb-4bbb-8bbb-222222222222', name: 'Banana', group: 'Fruits', per100g: { kcal: 89, proteinG: 1.1, carbsG: 23, fatG: 0.3, fibreG: 2.6 }, portions: [] },
];
function foodReply(url: string): unknown {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/v1/foods/groups')) return { groups: [{ value: 'Milk and Milk Products', count: 1 }, { value: 'Fruits', count: 1 }] };
  const q = (parsed.searchParams.get('q') ?? '').toLowerCase();
  const group = parsed.searchParams.get('group');
  const list = FOOD_LIST.filter((food) => food.name.toLowerCase().includes(q) && (!group || food.group === group));
  return { foods: list, total: list.length };
}

export function fakeApi(responses: { status: number; body: unknown }[]) {
  const requests: { url: string; method: string; body: unknown; auth: string | null }[] = [];
  const exerciseRequests: string[] = [];
  const foodRequests: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (new URL(url).pathname.startsWith('/v1/foods')) {
      foodRequests.push(url);
      return Response.json(foodReply(url));
    }
    if (new URL(url).pathname.startsWith('/v1/exercises')) {
      exerciseRequests.push(url);
      return Response.json(exerciseReply(url));
    }
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get('authorization'),
    });
    const next = responses.shift() ?? { status: 500, body: null };
    // A 204 has no body (a Response cannot carry one).
    return next.status === 204 ? new Response(null, { status: 204 }) : Response.json(next.body, { status: next.status });
  }) as typeof fetch;
  return { fetchImpl, requests, exerciseRequests, foodRequests };
}

export function errorBody(code: string) {
  return { error: { code, message: 'x', retryable: false, requestId: 'r', details: null } };
}

export function deps(client: AuthClient, fetchImpl?: typeof fetch): AuthDeps {
  return {
    client,
    apiUrl: 'http://api.test',
    links: { verified: 'fitspherecoach://verified', resetPassword: 'fitspherecoach://reset-password' },
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

export function Providers({ authDeps, children }: { authDeps: AuthDeps; children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <AuthProvider deps={authDeps}>
          <AccountProvider>{children}</AccountProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
