// Calendar (CF09, docs/design/CF09-calendar-ui.md §2.1 to §2.3): day, week and month, filtered by client
// and (Head Coach) coach. The server decides what a coach sees. One request covers the whole month grid
// around the chosen day, so moving between days and weeks of that month needs no new request.
import { useFocusTick } from '../focus';
import type { CalendarActivity, CalendarResponse, ClientSummary } from '@fitsphere-coach/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAccount } from '../account/AccountProvider';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS } from '../auth/texts';
import { loadClients } from '../clients/service';
import { ActivityRow, DayTable, KindTile, Legend, MonthGrid, subtitleFor } from '../calendar/parts';
import { loadCalendar } from '../calendar/service';
import { addDays, addMonths, CALENDAR_TEXTS, dayTitle, monthGrid, monthTitle, onDay, weekStart, weekTitle, weekdayShort, dayNumber } from '../calendar/texts';
import { Banner, Icon, IconTile, PrimaryButton, PushedLayout, SecondaryButton, Sheet, textStyles } from '../components/ui';
import { Chip, MultiDropdown, SectionLabel } from '../workouts/parts';
import { failureText, todayIst } from '../workouts/texts';
import { fonts, radius, useTheme } from '../theme';

type View_ = 'day' | 'week' | 'month';

export default function Calendar() {
  const params = useLocalSearchParams<{ traineeId?: string }>();
  const { deps } = useAuth();
  const { state } = useAccount();
  const router = useRouter();
  const focused = useFocusTick();
  const { colors } = useTheme();
  const [today] = useState(() => todayIst());
  const [view, setView] = useState<View_>('month');
  const [anchor, setAnchor] = useState(today);
  // Clients to show (any number, picked by name). Nothing picked means every client.
  const [traineeIds, setTraineeIds] = useState<string[]>(params.traineeId ? [params.traineeId] : []);
  // The server filters by one client; with several picked the app asks for all and narrows the list here.
  const traineeId = traineeIds.length === 1 ? traineeIds[0] : undefined;
  const [coachId, setCoachId] = useState<string | undefined>(undefined);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const me = state?.kind === 'coach' ? state.me : null;
  const myId = me?.user.id ?? null;
  const head = me?.roles.includes('head_coach') ?? false;
  const month = anchor.slice(0, 7);

  useEffect(() => {
    let current = true;
    void loadClients(deps).then((result) => {
      if (current && result.kind === 'ok') setClients(result.body.clients);
    });
    return () => {
      current = false;
    };
  }, [deps, focused]);

  useEffect(() => {
    let current = true;
    const cells = monthGrid(`${month}-01`);
    void (async () => {
      setLoading(true);
      const result = await loadCalendar(deps, { from: cells[0] as string, to: cells[cells.length - 1] as string, ...(traineeId ? { traineeId } : {}), ...(coachId ? { coachId } : {}) });
      if (!current) return;
      setLoading(false);
      if (result.kind === 'ok') {
        setData(result.body);
        setProblem(null);
      } else if (result.kind === 'signedOut') {
        router.replace('/sign-in?expired=1');
      } else {
        setProblem(failureText(result.kind, TEXTS));
      }
    })();
    return () => {
      current = false;
    };
  }, [deps, month, traineeId, coachId, router, focused]);

  const allActivities = data?.activities ?? [];
  const activities = traineeIds.length > 1 ? allActivities.filter((a) => traineeIds.includes(a.traineeId)) : allActivities;
  // A month goes to its first day (or to today in the current month); a week or day moves by 7 or 1 days.
  const move = (by: 1 | -1) => {
    if (view !== 'month') return setAnchor(addDays(anchor, view === 'week' ? 7 * by : by));
    const target = addMonths(anchor, by);
    setAnchor(target.slice(0, 7) === today.slice(0, 7) ? today : target);
  };
  const title = view === 'month' ? monthTitle(anchor) : view === 'week' ? weekTitle(anchor) : dayTitle(anchor);
  const open = (activity: CalendarActivity) => router.push(`/calendar-activity?id=${activity.id}` as never);
  const sub = (activity: CalendarActivity) => subtitleFor(activity, myId, head);
  const go = (path: string) => {
    setAdding(false);
    router.push((traineeId ? `${path}?traineeId=${traineeId}` : path) as never);
  };

  const pinned = (
    <>
      <View style={styles.tabs} accessibilityRole="radiogroup" accessibilityLabel="View">
        {(['day', 'week', 'month'] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setView(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: view === value }}
            accessibilityLabel={value[0]?.toUpperCase() + value.slice(1)}
            style={[styles.tab, view === value ? { backgroundColor: colors.surfaceRaised } : null]}
          >
            <Text style={[styles.tabText, { color: view === value ? colors.ink : colors.inkMuted }]}>{value.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.nav}>
        <Pressable onPress={() => move(-1)} accessibilityRole="button" accessibilityLabel="Earlier" style={styles.navButton}>
          <Icon name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.navTitle, { color: colors.ink }]}>{title.toUpperCase()}</Text>
        <Pressable onPress={() => move(1)} accessibilityRole="button" accessibilityLabel="Later" style={styles.navButton}>
          <Icon name="chevron-right" size={24} color={colors.ink} />
        </Pressable>
      </View>
      {view === 'day' && onDay(activities, anchor).length > 0 ? (
        <ScrollView style={styles.pinnedTable} nestedScrollEnabled>
          <DayTable activities={onDay(activities, anchor)} onOpen={open} />
        </ScrollView>
      ) : null}
    </>
  );

  return (
    <PushedLayout backLabel="Home" onBack={() => (router.canGoBack() ? router.back() : router.replace('/home'))} title="Calendar" pinned={pinned}>
      <View style={{ marginTop: 14, gap: 10 }}>
        <MultiDropdown
          label="Clients"
          allLabel="All clients"
          values={traineeIds}
          onChange={setTraineeIds}
          options={clients.map((client) => ({ value: client.id, label: client.name }))}
        />
        {head && (data?.coaches.length ?? 0) > 0 ? (
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Coach">
            <Chip label="All coaches" selected={!coachId} onPress={() => setCoachId(undefined)} />
            <Chip label="Me" selected={coachId === myId} onPress={() => myId && setCoachId(myId)} />
            {data?.coaches.map((coach) => (
              <Chip key={coach.id} label={coach.name ?? 'Coach'} selected={coachId === coach.id} onPress={() => setCoachId(coach.id)} />
            ))}
          </View>
        ) : null}
      </View>

      {problem ? (
        <View style={{ marginTop: 8 }}>
          <Banner kind="error">{problem}</Banner>
        </View>
      ) : null}
      {loading && !data ? <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" style={{ marginTop: 24 }} /> : null}

      {view === 'month' ? (
        <>
          <View style={{ marginTop: 6 }}>
            <MonthGrid anchor={anchor} today={today} activities={activities} onPick={setAnchor} />
          </View>
          <View style={{ marginTop: 10 }}>
            <Legend />
          </View>
          <SectionLabel>{dayTitle(anchor)}</SectionLabel>
          <DayList activities={onDay(activities, anchor)} sub={sub} open={open} />
        </>
      ) : null}

      {view === 'week' ? (
        <View style={{ marginTop: 6, gap: 4 }}>
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i)).map((day) => (
            <View key={day} style={[styles.weekRow, { borderBottomColor: colors.border }]}>
              <View style={styles.weekLabel}>
                <Text style={[styles.weekDay, { color: colors.inkMuted }]}>{weekdayShort(day)}</Text>
                <View style={[styles.weekDate, day === today ? { backgroundColor: colors.primary } : null]}>
                  <Text style={[styles.weekDateText, { color: day === today ? colors.onPrimary : colors.ink }]}>{dayNumber(day)}</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <DayList activities={onDay(activities, day)} sub={sub} open={open} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {view === 'day' ? (
        <>
          <SectionLabel>{day_count(onDay(activities, anchor).length, anchor === today)}</SectionLabel>
          {onDay(activities, anchor).length === 0 ? <Text style={[textStyles.small, { color: colors.inkSubtle, paddingVertical: 10 }]}>{CALENDAR_TEXTS.empty}</Text> : (
            <Text style={[textStyles.small, { color: colors.inkMuted, marginTop: 8 }]}>{CALENDAR_TEXTS.tapRow}</Text>
          )}
          {onDay(activities, anchor).filter((a) => a.kind === 'workout').length > 1 && hasTimeConflict(onDay(activities, anchor)) ? (
            <View style={{ marginTop: 14 }}>
              <Banner kind="info">A client has two workouts at the same time. This is a warning, not a block.</Banner>
            </View>
          ) : null}
        </>
      ) : null}

      <View style={{ marginTop: 20 }}>
        <PrimaryButton label="Add to calendar" onPress={() => setAdding(true)} />
      </View>

      <Sheet visible={adding} onClose={() => setAdding(false)} labelledBy={CALENDAR_TEXTS.addTitle}>
        <View style={{ marginTop: 22 }}>
          <IconTile name="calendar" size={56} />
        </View>
        <Text accessibilityRole="header" style={[textStyles.sheetTitle, { color: colors.ink, marginTop: 16 }]}>{CALENDAR_TEXTS.addTitle.toUpperCase()}</Text>
        <Text style={[textStyles.body, { color: colors.inkMuted, marginTop: 8 }]}>{CALENDAR_TEXTS.addBody}</Text>
        <View style={{ marginTop: 16, gap: 10 }}>
          <AddChoice kind="workout" title={CALENDAR_TEXTS.addWorkout} sub={CALENDAR_TEXTS.addWorkoutSub} onPress={() => go('/calendar-schedule-workout')} />
          <AddChoice kind="nutrition" title={CALENDAR_TEXTS.addDiet} sub={CALENDAR_TEXTS.addDietSub} onPress={() => go('/calendar-schedule-diet')} />
          <Text style={[textStyles.small, { color: colors.inkMuted }]}>{CALENDAR_TEXTS.addNeedsActive}</Text>
          <SecondaryButton label="Cancel" onPress={() => setAdding(false)} />
        </View>
      </Sheet>
    </PushedLayout>
  );
}

const day_count = (n: number, isToday: boolean) => `${isToday ? 'Today · ' : ''}${n} ${n === 1 ? 'activity' : 'activities'}`;

/** Two workouts for the same client on this day at the same time (no time counts as one time). */
function hasTimeConflict(activities: readonly CalendarActivity[]): boolean {
  const seen = new Set<string>();
  for (const a of activities) {
    if (a.kind !== 'workout') continue;
    const key = `${a.traineeId}|${a.time ?? ''}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function AddChoice({ kind, title, sub, onPress }: { kind: CalendarActivity['kind']; title: string; sub: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[styles.choice, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
    >
      <KindTile kind={kind} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceTitle, { color: colors.ink }]}>{title.toUpperCase()}</Text>
        <Text style={[textStyles.small, { color: colors.inkMuted }]}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={22} color={colors.inkMuted} />
    </Pressable>
  );
}

function DayList({ activities, sub, open }: { activities: readonly CalendarActivity[]; sub: (a: CalendarActivity) => string; open: (a: CalendarActivity) => void }) {
  const { colors } = useTheme();
  if (activities.length === 0) return <Text style={[textStyles.small, { color: colors.inkSubtle, paddingVertical: 10 }]}>{CALENDAR_TEXTS.empty}</Text>;
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      {activities.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} subtitle={sub(activity)} onPress={() => open(activity)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', marginTop: 14, padding: 3, gap: 3, borderRadius: radius.sm },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabText: { fontFamily: fonts.display, fontSize: 15, letterSpacing: 1.2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontFamily: fonts.display, fontSize: 24, letterSpacing: 1 },
  pinnedTable: { marginTop: 8, maxHeight: 260 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: radius.sm, padding: 14, minHeight: 64 },
  choiceTitle: { fontFamily: fonts.display, fontSize: 20, letterSpacing: 1 },
  weekRow: { flexDirection: 'row', gap: 12, paddingBottom: 10, borderBottomWidth: 1, minHeight: 56 },
  weekLabel: { width: 44, alignItems: 'center', paddingTop: 10 },
  weekDay: { fontFamily: fonts.displayBold, fontSize: 13, letterSpacing: 1.5 },
  weekDate: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  weekDateText: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
});
