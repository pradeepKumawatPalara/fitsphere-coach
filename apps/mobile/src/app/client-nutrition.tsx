// A client's logged food (CF04, owner request 2026-11-12): what they logged in the FitSphere app, read only,
// laid out like the FitSphere app's food log. It refreshes by itself every 20 seconds while the screen is open
// (Supabase Realtime is off, so this polls through the coach API). The server decides who may open the client.
import { useFocusTick } from '../focus';
import type { ClientNutritionResponse, NutritionMeal } from '@fitsphere-coach/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS } from '../auth/texts';
import { Banner, Heading, PushedLayout, TextLink, textStyles } from '../components/ui';
import { loadClientNutrition } from '../clients/service';
import { CLIENT_TEXTS } from '../clients/texts';
import { addDays, todayIst } from '../workouts/texts';
import { radius, useTheme } from '../theme';

const POLL_MS = 20_000;
const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu 12 Nov" for a day string. */
export function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}
/** "8:10 am" in India time (invariant 4). */
export function timeLabel(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 5.5 * 3_600_000);
  const hours = shifted.getUTCHours();
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(shifted.getUTCMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
}
const round = (n: number) => Math.round(n);
const mealTitle = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

export default function ClientNutrition() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { deps } = useAuth();
  const router = useRouter();
  const focused = useFocusTick();
  const { colors } = useTheme();
  const [day, setDay] = useState<string | null>(null); // null = today, as the server works it out
  const [data, setData] = useState<ClientNutritionResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const result = await loadClientNutrition(deps, id, day ?? undefined);
    if (result.kind === 'ok') {
      setData(result.body);
      setProblem(null);
      setUpdated(timeLabel(new Date().toISOString()));
    } else if (result.kind === 'signedOut') router.replace('/sign-in?expired=1');
    else setProblem(result.kind === 'notFound' ? CLIENT_TEXTS.notFound : result.kind === 'offline' ? TEXTS.offline : TEXTS.tryLater);
  }, [deps, id, day, router]);

  // Load now, then again every 20 seconds while the screen is open.
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, focused]);

  const shownDay = data?.day ?? day ?? todayIst();
  const isToday = shownDay >= todayIst();
  const groups = MEAL_ORDER.map((type) => ({ type, meals: (data?.meals ?? []).filter((meal) => meal.mealType === type) })).filter((group) => group.meals.length > 0);
  const others = (data?.meals ?? []).filter((meal) => !MEAL_ORDER.includes(meal.mealType));
  if (others.length > 0) groups.push({ type: 'other', meals: others });

  return (
    <PushedLayout backLabel="Client" onBack={() => (router.canGoBack() ? router.back() : router.replace('/clients'))} title="Food log">
      <Heading first="Food" second="log" sub="What they logged in the FitSphere app. Read only." />

      <View style={styles.dayRow}>
        <Pressable onPress={() => setDay(addDays(shownDay, -1))} accessibilityRole="button" accessibilityLabel="Previous day" style={styles.arrow}>
          <Text style={[styles.arrowText, { color: colors.ink }]}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.dayText, { color: colors.ink }]}>{`${isToday ? 'Today · ' : ''}${dayLabel(shownDay)}`}</Text>
        <Pressable
          onPress={() => setDay(addDays(shownDay, 1) >= todayIst() ? null : addDays(shownDay, 1))}
          disabled={isToday}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: isToday }}
          style={[styles.arrow, { opacity: isToday ? 0.3 : 1 }]}
        >
          <Text style={[styles.arrowText, { color: colors.ink }]}>›</Text>
        </Pressable>
      </View>

      {problem ? (
        <View style={{ marginTop: 12 }}>
          <Banner kind="error">{problem}</Banner>
        </View>
      ) : null}
      {!data && !problem ? (
        <View style={{ marginTop: 32 }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
        </View>
      ) : null}

      {data ? (
        <>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.big, { color: colors.ink }]}>
              {round(data.totals.kcal)}
              <Text style={[textStyles.body, { color: colors.inkMuted }]}>{data.targets.kcal ? ` / ${data.targets.kcal} kcal` : ' kcal'}</Text>
            </Text>
            {data.targets.kcal ? <Bar value={data.totals.kcal} target={data.targets.kcal} /> : <Text style={[textStyles.small, { color: colors.inkMuted }]}>No calorie target set.</Text>}
            <View style={styles.macros}>
              <Macro label="Protein" value={data.totals.proteinG} target={data.targets.proteinG} />
              <Macro label="Carbs" value={data.totals.carbsG} target={data.targets.carbsG} />
              <Macro label="Fat" value={data.totals.fatG} target={data.targets.fatG} />
              <Macro label="Fibre" value={data.totals.fibreG} target={data.targets.fibreG} />
            </View>
          </View>

          {data.meals.length === 0 ? <Text style={[textStyles.body, styles.empty, { color: colors.inkMuted }]}>Nothing logged on this day.</Text> : null}
          {groups.map((group) =>
            group.meals.map((meal) => <MealCard key={meal.id} meal={meal} title={group.type === 'other' ? mealTitle(meal.mealType) : mealTitle(group.type)} />),
          )}

          <Text style={[textStyles.label, styles.section, { color: colors.inkMuted }]}>LAST 7 DAYS</Text>
          <View style={{ gap: 8 }}>
            {data.week.length === 0 ? <Text style={[textStyles.small, { color: colors.inkMuted }]}>Nothing logged in the last 7 days.</Text> : null}
            {data.week.map((row) => {
              const target = data.targets.kcal;
              const mark = !target || row.kcal === null ? '' : row.kcal > target * 1.1 ? ' ▲' : row.kcal < target * 0.9 ? ' ▼' : ' ✓';
              return (
                <Pressable
                  key={row.day}
                  onPress={() => setDay(row.day >= todayIst() ? null : row.day)}
                  accessibilityRole="button"
                  accessibilityLabel={`${dayLabel(row.day)}, ${row.kcal ?? 0} kcal`}
                  style={[styles.weekRow, { backgroundColor: colors.surface, borderColor: row.day === shownDay ? colors.accent : colors.border }]}
                >
                  <Text style={[textStyles.listTitle, { color: colors.ink, flex: 1 }]}>{dayLabel(row.day)}</Text>
                  <Text style={[textStyles.body, { color: colors.inkMuted }]}>{`${row.kcal ?? 0} kcal${mark} · ${row.meals} ${row.meals === 1 ? 'meal' : 'meals'}`}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ marginTop: 16, alignItems: 'center', gap: 4 }}>
            {updated ? <Text style={[textStyles.small, { color: colors.inkSubtle }]}>{`Updated ${updated}. Refreshes by itself.`}</Text> : null}
            <TextLink label="Refresh now" onPress={() => void load()} />
          </View>
        </>
      ) : null}
    </PushedLayout>
  );
}

function Bar({ value, target }: { value: number; target: number }) {
  const { colors } = useTheme();
  const over = value > target * 1.1;
  return (
    <View accessibilityLabel={`${round(value)} of ${target}`} style={[styles.barTrack, { backgroundColor: colors.track }]}>
      <View style={[styles.barFill, { width: `${Math.min(100, (value / target) * 100)}%`, backgroundColor: over ? colors.warning : colors.accent }]} />
    </View>
  );
}

function Macro({ label, value, target }: { label: string; value: number; target: number | null }) {
  const { colors } = useTheme();
  return (
    <View style={{ minWidth: 70 }}>
      <Text style={[styles.macroValue, { color: colors.ink }]}>{`${round(value)}${target ? ` / ${target}` : ''} g`}</Text>
      <Text style={[textStyles.small, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

function MealCard({ meal, title }: { meal: NutritionMeal; title: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, gap: 6 }]}>
      <View style={styles.mealHead}>
        <Text style={[textStyles.label, { color: colors.accent, flex: 1 }]}>{`${title.toUpperCase()} · ${timeLabel(meal.recordedAt)}`}</Text>
        <Text style={[styles.mealKcal, { color: colors.ink }]}>{`${meal.kcal === null ? 0 : round(meal.kcal)} kcal`}</Text>
      </View>
      {meal.items.map((item, index) => (
        <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={[textStyles.listTitle, { color: colors.ink, flex: 1 }]}>{item.name}</Text>
          <Text style={[textStyles.small, { color: colors.inkMuted }]}>
            {[item.amount ? `${item.amount.value} ${item.amount.unit}` : null, item.kcal !== null ? `${item.estimated ? '≈ ' : ''}${round(item.kcal)} kcal` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ))}
      <Text style={[textStyles.small, { color: colors.inkMuted }]}>
        {`P ${meal.proteinG === null ? 0 : round(meal.proteinG)} g · C ${meal.carbsG === null ? 0 : round(meal.carbsG)} g · F ${meal.fatG === null ? 0 : round(meal.fatG)} g`}
      </Text>
      {meal.photo?.kind === 'link' ? (
        <Pressable onPress={() => void Linking.openURL((meal.photo as { url: string }).url)} accessibilityRole="link" accessibilityLabel="Open the photo link">
          <Text style={[textStyles.label, { color: colors.accent }]}>↗ PHOTO LINK</Text>
        </Pressable>
      ) : null}
      {meal.photo?.kind === 'stored' ? <Text style={[textStyles.small, { color: colors.inkSubtle }]}>Photo saved in the FitSphere app (not viewable here yet).</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 32, lineHeight: 36 },
  dayText: { fontSize: 20, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: radius.sm, padding: 14, marginTop: 12, gap: 10 },
  big: { fontSize: 34, fontWeight: '800' },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  macroValue: { fontSize: 18, fontWeight: '700' },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  empty: { textAlign: 'center', marginTop: 24 },
  section: { marginTop: 24, marginBottom: 8 },
  mealHead: { flexDirection: 'row', alignItems: 'center' },
  mealKcal: { fontSize: 18, fontWeight: '700' },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 14 },
});
