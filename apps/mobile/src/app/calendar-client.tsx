// One client's calendar (CF09, docs/design/CF09-calendar-ui.md §2.4): their coach, their active plans,
// what is coming up and what happened lately, with a way to schedule more.
import { useFocusTick } from '../focus';
import type { CalendarActivity, CalendarOptions, ClientProfile } from '@fitsphere-coach/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAccount } from '../account/AccountProvider';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS } from '../auth/texts';
import { loadClientProfile } from '../clients/service';
import { coachLabel } from '../clients/texts';
import { ActivityRow } from '../calendar/parts';
import { loadCalendar, loadOptions } from '../calendar/service';
import { addDays, CALENDAR_TEXTS, whenText } from '../calendar/texts';
import { Banner, PrimaryButton, PushedLayout, SecondaryButton, textStyles } from '../components/ui';
import { Card, SectionLabel } from '../workouts/parts';
import { failureText, todayIst } from '../workouts/texts';
import { fonts, useTheme } from '../theme';

export default function CalendarClient() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { deps } = useAuth();
  const { state } = useAccount();
  const router = useRouter();
  const focused = useFocusTick();
  const { colors } = useTheme();
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [options, setOptions] = useState<CalendarOptions | null>(null);
  const [activities, setActivities] = useState<CalendarActivity[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [today] = useState(() => todayIst());
  const myId = state?.kind === 'coach' ? state.me.user.id : null;

  useEffect(() => {
    if (!id) return;
    let current = true;
    void (async () => {
      const [p, o, c] = await Promise.all([loadClientProfile(deps, id), loadOptions(deps, id), loadCalendar(deps, { from: addDays(today, -30), to: addDays(today, 60), traineeId: id })]);
      if (!current) return;
      const failure = [p.kind, o.kind, c.kind].find((kind) => kind !== 'ok');
      if (failure) {
        if (failure === 'signedOut') router.replace('/sign-in?expired=1');
        else setProblem(failureText(failure === 'notFound' || failure === 'offline' ? failure : 'unavailable', TEXTS));
        return;
      }
      if (p.kind === 'ok') setProfile(p.body);
      if (o.kind === 'ok') setOptions(o.body);
      if (c.kind === 'ok') setActivities(c.body.activities);
    })();
    return () => {
      current = false;
    };
  }, [deps, id, router, today, focused]);

  const upcoming = (activities ?? []).filter((a) => a.endDate >= today && a.status !== 'completed' && a.status !== 'missed');
  const past = (activities ?? []).filter((a) => !upcoming.includes(a)).reverse();
  const open = (a: CalendarActivity) => router.push(`/calendar-activity?id=${a.id}` as never);
  const row = (a: CalendarActivity) => <ActivityRow key={a.id} activity={a} subtitle={whenText(a)} onPress={() => open(a)} />;

  return (
    <PushedLayout backLabel="Client" onBack={() => (router.canGoBack() ? router.back() : router.replace('/clients'))} title={profile?.name ?? 'Calendar'}>
      {problem ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="error">{problem}</Banner>
        </View>
      ) : null}
      {!profile && !problem ? (
        <View style={{ marginTop: 40 }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
        </View>
      ) : null}

      {profile && options && activities ? (
        <>
          <Text style={[textStyles.body, { color: colors.inkMuted, marginTop: 6 }]}>{`Coach ${coachLabel(profile.coachId, profile.coachName, myId)}`}</Text>
          <Card style={{ marginTop: 16 }}>
            <Line label="Training plan" value={options.workoutPlan ? `${options.workoutPlan.name} · Active` : 'None active'} />
            <Line label="Diet plan" value={options.dietPlan ? `${options.dietPlan.name} · Active` : 'None active'} last />
          </Card>

          <SectionLabel>Upcoming</SectionLabel>
          <View style={{ gap: 8 }}>
            {upcoming.length === 0 ? <Text style={[textStyles.small, { color: colors.inkSubtle }]}>{CALENDAR_TEXTS.empty}</Text> : upcoming.map(row)}
          </View>
          <SectionLabel>Recently</SectionLabel>
          <View style={{ gap: 8 }}>
            {past.length === 0 ? <Text style={[textStyles.small, { color: colors.inkSubtle }]}>{CALENDAR_TEXTS.empty}</Text> : past.map(row)}
          </View>

          <View style={{ marginTop: 24, gap: 10 }}>
            <PrimaryButton label="Schedule a workout" disabled={!options.workoutPlan} onPress={() => router.push(`/calendar-schedule-workout?traineeId=${id}` as never)} />
            <SecondaryButton label="Schedule a diet plan" disabled={!options.dietPlan} onPress={() => router.push(`/calendar-schedule-diet?traineeId=${id}` as never)} />
          </View>
        </>
      ) : null}
    </PushedLayout>
  );
}

function Line({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }, last ? null : { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <Text style={[textStyles.body, { color: colors.inkMuted }]}>{label}</Text>
      <Text style={[textStyles.body, { color: colors.ink, fontFamily: fonts.bodyMedium, flexShrink: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}
