// Schedule a workout (CF09, docs/design/CF09-calendar-ui.md §2.5): a client, one of their active workout
// plans, a day of the plan, a date and an optional time, once or repeating on chosen weekdays for N weeks.
// The dates are reviewed before saving; a conflict is a warning, never a block.
import type { CalendarOptions, ClientSummary, SchedulePreview, TemplateSummary } from '@fitsphere-coach/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS } from '../auth/texts';
import { loadClients } from '../clients/service';
import { loadOptions, previewWorkout, saveWorkout } from '../calendar/service';
import { addDays, CALENDAR_TEXTS, dayTitle, isoWeekday, timeText } from '../calendar/texts';
import { Banner, Field, Icon, PrimaryButton, PushedLayout, SecondaryButton, textStyles } from '../components/ui';
import { assignPlans, loadTemplates } from '../workouts/service';
import { Card, Chip, DateStepper, Dropdown, NumField, Segmented, SectionLabel } from '../workouts/parts';
import { failureText, todayIst, WEEKDAY_LABELS } from '../workouts/texts';
import { radius, useTheme } from '../theme';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function CalendarScheduleWorkout() {
  const params = useLocalSearchParams<{ traineeId?: string }>();
  const { deps } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [traineeId, setTraineeId] = useState<string | undefined>(params.traineeId);
  const [options, setOptions] = useState<CalendarOptions | null>(null);
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [date, setDate] = useState(() => addDays(todayIst(), 1));
  const [time, setTime] = useState('07:00');
  const [repeat, setRepeat] = useState<'once' | 'weekly'>('once');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [weeks, setWeeks] = useState<number | null>(4);
  const [notes, setNotes] = useState('');
  const [skip, setSkip] = useState<string[]>([]);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [templateId, setTemplateId] = useState('');

  useEffect(() => {
    let current = true;
    void loadClients(deps).then((result) => {
      if (current && result.kind === 'ok') setClients(result.body.clients);
    });
    return () => {
      current = false;
    };
  }, [deps]);

  useEffect(() => {
    if (!traineeId) return;
    let current = true;
    void loadOptions(deps, traineeId).then((result) => {
      if (!current) return;
      if (result.kind === 'ok') {
        setOptions(result.body);
        setDayIndex(result.body.workoutPlan?.days[0]?.index ?? null);
        setPreview(null);
      } else {
        setProblem(failureText(result.kind, TEXTS));
      }
    });
    return () => {
      current = false;
    };
  }, [deps, traineeId]);

  const plan = options?.workoutPlan ?? null;
  const needsTemplate = options !== null && !plan;

  // A client with no active workout plan can be given one of the coach's templates right here.
  useEffect(() => {
    if (!needsTemplate) return;
    let current = true;
    void loadTemplates(deps).then((result) => {
      if (current && result.kind === 'ok') setTemplates(result.body);
    });
    return () => {
      current = false;
    };
  }, [deps, needsTemplate]);
  const template = templates?.find((t) => t.id === templateId) ?? null;

  async function useTemplate() {
    if (!template || !traineeId) return;
    setWorking(true);
    setProblem(null);
    const assigned = await assignPlans(deps, template.id, [traineeId], date);
    if (assigned.kind === 'ok') {
      const fresh = await loadOptions(deps, traineeId);
      if (fresh.kind === 'ok') {
        setOptions(fresh.body);
        setDayIndex(fresh.body.workoutPlan?.days[0]?.index ?? null);
        setPreview(null);
      } else if (fresh.kind === 'signedOut') router.replace('/sign-in?expired=1');
      else setProblem(failureText(fresh.kind, TEXTS));
    } else if (assigned.kind === 'signedOut') {
      router.replace('/sign-in?expired=1');
    } else {
      setProblem(failureText(assigned.kind, TEXTS));
    }
    setWorking(false);
  }
  const timeOk = time === '' || TIME.test(time);
  const repeatOk = repeat === 'once' || (weekdays.length > 0 && weeks !== null);
  const request = plan && traineeId && dayIndex !== null && timeOk && repeatOk
    ? {
        traineeId,
        planId: plan.id,
        dayIndex,
        date,
        time: time === '' ? null : time,
        notes,
        repeat: repeat === 'weekly' && weeks !== null ? { weekdays, weeks } : null,
        skipDates: skip,
      }
    : null;
  const key = JSON.stringify(request);

  // The reviewed dates follow the form: a short pause after each change, then ask the server.
  useEffect(() => {
    if (!request) return;
    let current = true;
    const timer = setTimeout(() => {
      void previewWorkout(deps, request).then((result) => {
        if (!current) return;
        if (result.kind === 'ok') {
          setPreview(result.body);
          setProblem(null);
        } else if (result.kind === 'signedOut') {
          router.replace('/sign-in?expired=1');
        } else {
          setPreview(null);
          setProblem(result.kind === 'invalid' ? CALENDAR_TEXTS.invalid : failureText(result.kind, TEXTS));
        }
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `key` stands for the whole request, which changes on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, key, router]);

  const conflicts = preview?.dates.filter((d) => d.conflict) ?? [];
  const count = preview?.dates.length ?? 0;

  async function save() {
    if (!request) return;
    setWorking(true);
    setProblem(null);
    const result = await saveWorkout(deps, request);
    setWorking(false);
    if (result.kind === 'ok') router.replace('/calendar');
    else if (result.kind === 'signedOut') router.replace('/sign-in?expired=1');
    else setProblem(result.kind === 'invalid' ? CALENDAR_TEXTS.invalid : failureText(result.kind, TEXTS));
  }

  return (
    <PushedLayout backLabel="Calendar" onBack={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))} title="Schedule workout">
      <Text style={[textStyles.body, { color: colors.inkMuted, marginTop: 6 }]}>Pick a client and one of their workout plans. Only the client's own active plan is offered.</Text>
      {problem ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="error">{problem}</Banner>
        </View>
      ) : null}

      <SectionLabel>Client</SectionLabel>
      {clients && clients.length === 0 ? <Text style={[textStyles.body, { color: colors.inkMuted }]}>{CALENDAR_TEXTS.noClients}</Text> : null}
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Client">
        {clients?.map((client) => (
          <Chip key={client.id} label={client.name} selected={traineeId === client.id} onPress={() => setTraineeId(client.id)} />
        ))}
      </View>

      {traineeId && !options ? <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" style={{ marginTop: 20 }} /> : null}
      {needsTemplate ? (
        <>
          <View style={{ marginTop: 16 }}>
            <Banner kind="info">{CALENDAR_TEXTS.noWorkoutPlan}</Banner>
          </View>
          {templates && templates.length === 0 ? (
            <View style={{ marginTop: 12 }}>
              <Banner kind="info">You have no workout templates yet. Make one in Workouts first.</Banner>
            </View>
          ) : templates ? (
            <View style={{ marginTop: 16, gap: 12 }}>
              <Dropdown label="Workout template" value={templateId} onChange={setTemplateId} options={[{ value: '', label: 'Choose a template' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} />
              <Text style={[textStyles.small, { color: colors.inkMuted }]}>It becomes the client’s active workout plan, starting tomorrow. Then you pick the days to schedule.</Text>
              <PrimaryButton label="Use this template" disabled={!template} loading={working} onPress={() => void useTemplate()} />
            </View>
          ) : (
            <ActivityIndicator color={colors.accent} accessibilityLabel="Loading templates" style={{ marginTop: 20 }} />
          )}
        </>
      ) : null}

      {plan ? (
        <>
          <SectionLabel>Workout plan</SectionLabel>
          <Card>
            <View style={styles.planRow}>
              <Text style={[textStyles.listTitle, { color: colors.ink }]}>{plan.name}</Text>
              <Text style={[textStyles.small, { color: colors.inkMuted }]}>Active</Text>
            </View>
          </Card>
          <SectionLabel>Which day of the plan</SectionLabel>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Plan day">
            {plan.days.map((day) => (
              <Chip key={day.index} label={day.name} selected={dayIndex === day.index} onPress={() => setDayIndex(day.index)} />
            ))}
          </View>

          <View style={{ marginTop: 18, gap: 16 }}>
            <DateStepper label="Date" value={date} onChange={(next) => (setDate(next), setSkip([]))} />
            <Field label="Time (optional)" value={time} onChangeText={setTime} placeholder="07:00" keyboardType="numbers-and-punctuation" maxLength={5} error={timeOk ? null : 'Use 24-hour time like 07:00, or leave it empty.'} hint="Leave empty for an all-day workout." />
            <View style={{ gap: 6 }}>
              <Text style={[textStyles.label, { color: colors.inkMuted }]}>REPEAT</Text>
              <Segmented
                label="Repeat"
                value={repeat}
                onChange={(next) => {
                  setRepeat(next);
                  setSkip([]);
                  if (next === 'weekly' && weekdays.length === 0) setWeekdays([isoWeekday(date)]);
                }}
                options={[
                  { value: 'once', label: 'Once' },
                  { value: 'weekly', label: 'Weekly' },
                ]}
              />
            </View>
            {repeat === 'weekly' ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text style={[textStyles.label, { color: colors.inkMuted }]}>ON THESE DAYS</Text>
                  <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Weekdays">
                    {WEEKDAY_LABELS.map((label, i) => (
                      <Chip
                        key={label}
                        label={label}
                        selected={weekdays.includes(i + 1)}
                        onPress={() => {
                          setSkip([]);
                          setWeekdays(weekdays.includes(i + 1) ? weekdays.filter((d) => d !== i + 1) : [...weekdays, i + 1]);
                        }}
                      />
                    ))}
                  </View>
                </View>
                <View style={{ flexDirection: 'row' }}>
                  <NumField label="For how many weeks" value={weeks} min={1} max={12} onChange={(next) => (setWeeks(next), setSkip([]))} />
                </View>
              </>
            ) : null}
            <Field label="Notes for the client" value={notes} onChangeText={setNotes} maxLength={300} placeholder="Warm up for 10 minutes" />
          </View>

          <SectionLabel>{`Review dates · ${count} ${count === 1 ? 'workout' : 'workouts'}`}</SectionLabel>
          <Card>
            {preview?.dates.map((d, i) => (
              <View key={d.date} style={[styles.dateRow, i === 0 ? null : { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <Icon name={d.conflict ? 'alert-triangle' : 'check'} size={18} color={d.conflict ? colors.warning : colors.success} />
                <Text style={[textStyles.body, { color: colors.ink, flex: 1 }]}>{`${dayTitle(d.date).replace(',', '')} · ${d.dayName}`}</Text>
                <Text style={[textStyles.small, { color: d.conflict ? colors.warning : colors.inkMuted }]}>{timeText(time === '' ? null : time)}</Text>
                {repeat === 'weekly' ? (
                  <Pressable onPress={() => setSkip([...skip, d.date])} accessibilityRole="button" accessibilityLabel={`Remove ${dayTitle(d.date)}`} hitSlop={8}>
                    <Icon name="x" size={18} color={colors.inkMuted} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {!preview ? <Text style={[textStyles.small, { color: colors.inkMuted, padding: 14 }]}>Choose a client, a plan day and a date to see the dates.</Text> : null}
          </Card>
          {skip.length > 0 ? (
            <Pressable onPress={() => setSkip([])} accessibilityRole="button" accessibilityLabel="Put the removed dates back" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={[textStyles.small, { color: colors.accent }]}>{`${skip.length} removed · put back`}</Text>
            </Pressable>
          ) : null}
          {conflicts.length > 0 ? (
            <View style={{ marginTop: 12 }}>
              <Banner kind="info">{CALENDAR_TEXTS.conflictWarning(conflicts.map((c) => c.date))}</Banner>
            </View>
          ) : null}

          <View style={{ marginTop: 20, gap: 10 }}>
            <PrimaryButton label={count === 0 ? 'Save' : `Save ${count} ${count === 1 ? 'workout' : 'workouts'}`} disabled={!preview || count === 0} loading={working} onPress={() => void save()} />
            <SecondaryButton label="Cancel" onPress={() => router.replace('/calendar')} disabled={working} />
          </View>
        </>
      ) : null}
    </PushedLayout>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planRow: { padding: 14, gap: 2 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, minHeight: 48, borderRadius: radius.sm },
});
