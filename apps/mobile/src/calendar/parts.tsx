// Small pieces shared by the calendar screens: the status chip, an activity row, and the month grid.
// A workout is a caramel circle with a dumbbell, nutrition a blue square with a fork (colour and shape,
// never colour alone).
import type { ActivityStatus, CalendarActivity } from '@fitsphere-coach/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, textStyles } from '../components/ui';
import { fonts, radius, useTheme } from '../theme';
import { dayNumber, dayTableRows, onDay, STATUS_LABELS, timeText, whenText, monthGrid, weekdayShort } from './texts';

export function useKindColors() {
  const { colors, scheme } = useTheme();
  return { workout: colors.accent, nutrition: scheme === 'dark' ? '#8FA9B5' : '#3D4D55' };
}

export function ActivityStatusChip({ status }: { status: ActivityStatus }) {
  const { colors } = useTheme();
  const look = {
    assigned: { background: colors.accentTint, color: colors.accent, border: 'transparent' },
    completed: { background: colors.successTint, color: colors.success, border: 'transparent' },
    missed: { background: colors.warning + '24', color: colors.warning, border: 'transparent' },
    rescheduled: { background: 'transparent', color: colors.inkMuted, border: colors.border },
  }[status];
  return (
    <View accessibilityLabel={`Status: ${STATUS_LABELS[status]}`} style={[styles.chip, { backgroundColor: look.background, borderColor: look.border }]}>
      <Text style={[styles.chipText, { color: look.color }]}>{STATUS_LABELS[status].toUpperCase()}</Text>
    </View>
  );
}

export function KindTile({ kind }: { kind: CalendarActivity['kind'] }) {
  const { colors } = useTheme();
  const kinds = useKindColors();
  return (
    <View style={[styles.tile, { backgroundColor: kind === 'workout' ? colors.accentTint : colors.surfaceRaised }]}>
      <Icon name={kind === 'workout' ? 'activity' : 'coffee'} size={18} color={kinds[kind]} />
    </View>
  );
}

export function ActivityRow({ activity, subtitle, onPress }: { activity: CalendarActivity; subtitle: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${activity.kind === 'workout' ? 'Workout' : 'Nutrition'}: ${activity.title}, ${activity.traineeName}, ${STATUS_LABELS[activity.status]}`}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <KindTile kind={activity.kind} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[textStyles.listTitle, { color: colors.ink }]}>{activity.title}</Text>
        <Text numberOfLines={2} style={[textStyles.small, { color: colors.inkMuted }]}>{subtitle}</Text>
      </View>
      <ActivityStatusChip status={activity.status} />
    </Pressable>
  );
}

const COLUMNS = { client: 1, workout: 1.25, diet: 1.05, status: 84 } as const;

function TableCell({ activity }: { activity: CalendarActivity }) {
  const { colors } = useTheme();
  const kinds = useKindColors();
  return (
    <View style={styles.cellItem}>
      <View style={[styles.marker, { backgroundColor: activity.kind === 'workout' ? colors.accentTint : colors.surfaceRaised, borderRadius: activity.kind === 'workout' ? 9 : 3 }]}>
        <Icon name={activity.kind === 'workout' ? 'activity' : 'coffee'} size={11} color={kinds[activity.kind]} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.tableText, { color: colors.ink }]}>{activity.title}</Text>
        <Text style={[styles.tableSub, { color: colors.inkMuted }]}>{activity.kind === 'workout' ? timeText(activity.time) : 'All day'}</Text>
      </View>
    </View>
  );
}

/** The day's table (docs/design/CF09-calendar-ui.md §2.1): a row per client, their workout and diet plan, one status. */
export function DayTable({ activities, onOpen }: { activities: readonly CalendarActivity[]; onOpen: (activity: CalendarActivity) => void }) {
  const { colors } = useTheme();
  const rows = dayTableRows(activities);
  if (rows.length === 0) return null;
  const head = (label: string, flex: number | undefined, width?: number) => (
    <Text style={[styles.tableHead, { color: colors.inkMuted }, width ? { width } : { flex }]}>{label.toUpperCase()}</Text>
  );
  const open = (a: CalendarActivity) => (
    <Pressable
      key={a.id}
      onPress={() => onOpen(a)}
      accessibilityRole="button"
      accessibilityLabel={`${a.kind === 'workout' ? 'Workout' : 'Nutrition'}: ${a.title}, ${a.traineeName}, ${STATUS_LABELS[a.status]}`}
      style={styles.cellPress}
    >
      <TableCell activity={a} />
    </Pressable>
  );
  const none = <Text accessibilityLabel="None" style={[styles.tableText, { color: colors.inkMuted }]}>{'—'}</Text>;
  return (
    <View accessibilityLabel="Day table" style={[styles.table, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.tableRow, { backgroundColor: colors.surfaceSunken }]}>
        {head('Client', COLUMNS.client)}
        {head('Workout', COLUMNS.workout)}
        {head('Diet', COLUMNS.diet)}
        {head('Status', undefined, COLUMNS.status)}
      </View>
      {rows.map((row) => (
        <View key={row.traineeId} style={[styles.tableRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
          <Text style={[styles.tableText, { flex: COLUMNS.client, fontFamily: fonts.bodyMedium, color: colors.ink }]}>{row.name}</Text>
          <View style={{ flex: COLUMNS.workout, gap: 6 }}>{row.workouts.length ? row.workouts.map(open) : none}</View>
          <View style={{ flex: COLUMNS.diet, gap: 6 }}>{row.diets.length ? row.diets.map(open) : none}</View>
          <View style={{ width: COLUMNS.status }}>
            <ActivityStatusChip status={row.status} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Monday-first month grid; a dot under a day that has activities (circle: workout, square: nutrition). */
export function MonthGrid({ anchor, today, activities, onPick }: { anchor: string; today: string; activities: readonly CalendarActivity[]; onPick: (day: string) => void }) {
  const { colors } = useTheme();
  const kinds = useKindColors();
  const cells = monthGrid(anchor);
  return (
    <View accessibilityLabel="Month">
      <View style={styles.week}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={[styles.weekday, { color: colors.inkMuted }]}>{d}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((day) => {
          const inMonth = day.slice(0, 7) === anchor.slice(0, 7);
          const selected = day === anchor;
          const here = onDay(activities, day);
          const hasWorkout = here.some((a) => a.kind === 'workout');
          const hasNutrition = here.some((a) => a.kind === 'nutrition');
          return (
            <Pressable
              key={day}
              onPress={() => onPick(day)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${weekdayShort(day)} ${dayNumber(day)}${day === today ? ', today' : ''}, ${here.length} ${here.length === 1 ? 'activity' : 'activities'}`}
              style={[styles.cell, selected ? { backgroundColor: colors.surfaceRaised, borderColor: colors.accent } : { borderColor: 'transparent' }]}
            >
              <Text style={[styles.cellText, { color: inMonth ? colors.ink : colors.inkSubtle, fontFamily: day === today ? fonts.bodySemiBold : fonts.body }]}>{dayNumber(day)}</Text>
              <View style={styles.dots}>
                {hasWorkout ? <View style={[styles.dotRound, { backgroundColor: kinds.workout }]} /> : null}
                {hasNutrition ? <View style={[styles.dotSquare, { backgroundColor: kinds.nutrition }]} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Legend() {
  const { colors } = useTheme();
  const kinds = useKindColors();
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <Icon name="activity" size={16} color={kinds.workout} />
        <Text style={[textStyles.small, { color: colors.inkMuted }]}>Workout</Text>
      </View>
      <View style={styles.legendItem}>
        <Icon name="coffee" size={16} color={kinds.nutrition} />
        <Text style={[textStyles.small, { color: colors.inkMuted }]}>Nutrition</Text>
      </View>
    </View>
  );
}

/** What each row says under the title: when, who, and (for the Head Coach) the coach. */
export const subtitleFor = (activity: CalendarActivity, myId: string | null, showCoach: boolean): string =>
  [activity.kind === 'workout' ? whenTimeOnly(activity) : null, activity.traineeName, showCoach ? (activity.coachId === myId ? 'You' : activity.coachName ? `Coach ${activity.coachName}` : null) : null].filter(Boolean).join(' · ') ||
  whenText(activity);
const whenTimeOnly = (activity: CalendarActivity): string => (activity.time ? whenText({ ...activity, kind: 'workout' }).split(' · ')[1] ?? '' : 'All day');

const styles = StyleSheet.create({
  table: { borderWidth: 1, borderRadius: radius.sm, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', gap: 8, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'flex-start' },
  tableHead: { fontFamily: fonts.displayBold, fontSize: 12, letterSpacing: 1.2 },
  tableText: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 16 },
  tableSub: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  cellPress: { minHeight: 44, justifyContent: 'center' },
  cellItem: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  marker: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: radius.xs, borderWidth: 1, alignSelf: 'flex-start' },
  chipText: { fontFamily: fonts.displayBold, fontSize: 12, letterSpacing: 1.2 },
  tile: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 14, minHeight: 64 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontFamily: fonts.displayBold, fontSize: 13, letterSpacing: 1.5, height: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 48, borderWidth: 1.5, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', gap: 4 },
  cellText: { fontSize: 15 },
  dots: { flexDirection: 'row', gap: 3, height: 6 },
  dotRound: { width: 6, height: 6, borderRadius: 3 },
  dotSquare: { width: 6, height: 6, borderRadius: 1 },
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
