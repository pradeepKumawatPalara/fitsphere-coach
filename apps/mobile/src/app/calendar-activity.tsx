// One scheduled activity (CF09, docs/design/CF09-calendar-ui.md §2.7 and §2.8): the status first, then
// when, plan, coach and notes, the history, and Mark as done, Reschedule and Remove. The server decides
// who may change it and works out the status.
import type { ActivityDetail } from '@fitsphere-coach/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS } from '../auth/texts';
import { ActivityStatusChip, KindTile } from '../calendar/parts';
import { completeActivity, loadActivity, moveActivity, removeActivity } from '../calendar/service';
import { CALENDAR_TEXTS, dayTitle, whenText } from '../calendar/texts';
import { Banner, Field, IconTile, PrimaryButton, PushedLayout, SecondaryButton, Sheet, textStyles, Icon } from '../components/ui';
import { ActionLink, Card, DateStepper, SectionLabel } from '../workouts/parts';
import { failureText, todayIst, whenText as stampText } from '../workouts/texts';
import { fonts, radius, useTheme } from '../theme';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const roleText = (role: 'head_coach' | 'coach') => (role === 'head_coach' ? 'Head coach' : 'Coach');

type SheetKind = 'move' | 'remove' | null;

export default function CalendarActivity() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { deps } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [working, setWorking] = useState(false);
  const [date, setDate] = useState(todayIst());
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!id) return;
    let current = true;
    void loadActivity(deps, id).then((result) => {
      if (!current) return;
      if (result.kind === 'ok') {
        setActivity(result.body);
        setProblem(null);
      } else if (result.kind === 'signedOut') {
        router.replace('/sign-in?expired=1');
      } else {
        setProblem(failureText(result.kind, TEXTS));
      }
    });
    return () => {
      current = false;
    };
  }, [deps, id, router]);

  function fail(kind: Parameters<typeof failureText>[0]) {
    setSheet(null);
    if (kind === 'signedOut') router.replace('/sign-in?expired=1');
    else setProblem(failureText(kind, TEXTS));
  }

  async function markDone() {
    if (!id) return;
    setWorking(true);
    const result = await completeActivity(deps, id);
    setWorking(false);
    if (result.kind === 'ok') setActivity(result.body);
    else fail(result.kind);
  }

  async function move() {
    if (!id) return;
    setWorking(true);
    const result = await moveActivity(deps, id, { date, time: time === '' || activity?.kind === 'nutrition' ? null : time, reason });
    setWorking(false);
    if (result.kind === 'ok') {
      setActivity(result.body);
      setSheet(null);
    } else {
      fail(result.kind === 'invalid' ? 'invalid' : result.kind);
    }
  }

  async function remove() {
    if (!id) return;
    setWorking(true);
    const result = await removeActivity(deps, id);
    setWorking(false);
    if (result.kind === 'ok') router.replace('/calendar');
    else fail(result.kind);
  }

  const first = activity?.traineeName.split(/[@ ]/)[0] ?? 'the client';
  const done = activity?.status === 'completed';
  const timeOk = time === '' || TIME.test(time);

  return (
    <PushedLayout backLabel="Calendar" onBack={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))} title={activity?.title ?? 'Activity'}>
      {problem ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="error">{problem}</Banner>
        </View>
      ) : null}
      {!activity && !problem ? (
        <View style={{ marginTop: 40 }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
        </View>
      ) : null}

      {activity ? (
        <>
          {/* The status comes first. */}
          <View style={styles.head}>
            <KindTile kind={activity.kind} />
            <ActivityStatusChip status={activity.status} />
            <Text style={[textStyles.small, { color: colors.inkMuted, flex: 1 }]}>{activity.kind === 'workout' ? 'Workout' : 'Diet plan'} for {activity.traineeName}</Text>
          </View>

          <Card style={{ marginTop: 16 }}>
            <Info label="When" value={whenText(activity)} />
            <Info label="Plan" value={activity.planName} />
            <Info label="Coach" value={activity.coachName ?? 'Coach'} />
            <Info label="Notes" value={activity.notes || '—'} last />
          </Card>

          {activity.kind === 'workout' && activity.status !== 'completed' ? (
            <View style={{ marginTop: 12 }}>
              <Banner kind="info">{CALENDAR_TEXTS.completedAuto}</Banner>
            </View>
          ) : null}
          <View style={{ marginTop: 8 }}>
            <Banner kind="info">{CALENDAR_TEXTS.moveWaits}</Banner>
          </View>

          <SectionLabel>History</SectionLabel>
          <Card>
            {activity.history.map((item, index) => (
              <View key={index} style={[styles.history, index === 0 ? null : { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <Icon name="clock" size={18} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={[textStyles.listTitle, { color: colors.ink }]}>
                    {item.action === 'scheduled' ? 'Scheduled' : item.action === 'moved' ? `Moved from ${item.fromDate ? dayTitle(item.fromDate) : ''}` : item.action === 'completed' ? 'Marked as done' : 'Removed'}
                  </Text>
                  <Text style={[textStyles.small, { color: colors.inkMuted }]}>
                    {item.actorName ?? 'Coach'} ({roleText(item.actorRole)}) · {stampText(item.at)}
                    {item.reason ? ` · "${item.reason}"` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </Card>

          <View style={{ marginTop: 24, gap: 10 }}>
            {!done ? <PrimaryButton label="Mark as done" loading={working} onPress={() => void markDone()} /> : null}
            {!done ? (
              <SecondaryButton
                label="Reschedule"
                onPress={() => {
                  setDate(activity.startDate < todayIst() ? todayIst() : activity.startDate);
                  setTime(activity.time ?? '');
                  setReason('');
                  setSheet('move');
                }}
              />
            ) : null}
            <View style={{ alignItems: 'center' }}>
              <ActionLink icon="trash-2" label="Remove from calendar" tone="danger" onPress={() => setSheet('remove')} />
            </View>
          </View>

          <Sheet visible={sheet === 'move'} onClose={() => setSheet(null)} labelledBy="Reschedule">
            <View style={{ marginTop: 22 }}>
              <IconTile name="calendar" size={56} />
            </View>
            <Text accessibilityRole="header" style={[textStyles.sheetTitle, { color: colors.ink, marginTop: 16 }]}>RESCHEDULE</Text>
            <Text style={[textStyles.body, { color: colors.inkMuted, marginTop: 8 }]}>{CALENDAR_TEXTS.rescheduleBody}</Text>
            <View style={{ marginTop: 16, gap: 14 }}>
              <DateStepper label="New date" value={date} onChange={setDate} />
              {activity.kind === 'workout' ? <Field label="Time" value={time} onChangeText={setTime} placeholder="07:00" maxLength={5} error={timeOk ? null : 'Use 24-hour time like 07:00, or leave it empty.'} /> : null}
              <Field label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={200} placeholder="Client is travelling" />
            </View>
            <View style={{ marginTop: 20, gap: 10 }}>
              <PrimaryButton label={activity.kind === 'workout' ? 'Move workout' : 'Move diet plan'} disabled={!timeOk} loading={working} onPress={() => void move()} />
              <SecondaryButton label="Cancel" onPress={() => setSheet(null)} disabled={working} />
            </View>
          </Sheet>

          <Sheet visible={sheet === 'remove'} onClose={() => setSheet(null)} labelledBy="Remove from calendar">
            <View style={{ marginTop: 22 }}>
              <IconTile name="trash-2" size={56} />
            </View>
            <Text accessibilityRole="header" style={[textStyles.sheetTitle, { color: colors.ink, marginTop: 16 }]}>REMOVE?</Text>
            <Text style={[textStyles.body, { color: colors.inkMuted, marginTop: 8 }]}>{`This takes ${activity.title} off ${first}'s calendar. The plan itself is not changed, and the history is kept.`}</Text>
            <View style={{ marginTop: 20, gap: 10 }}>
              <PrimaryButton label="Remove" loading={working} onPress={() => void remove()} />
              <SecondaryButton label="Keep" onPress={() => setSheet(null)} disabled={working} />
            </View>
          </Sheet>
        </>
      ) : null}
    </PushedLayout>
  );
}

function Info({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.info, last ? null : { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <Text style={[textStyles.body, { color: colors.inkMuted }]}>{label}</Text>
      <Text style={[textStyles.body, { color: colors.ink, fontFamily: fonts.bodyMedium, flexShrink: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  info: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  history: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.sm },
});
