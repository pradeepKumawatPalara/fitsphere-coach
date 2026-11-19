// The editor for a plan's content, used by templates and plans (CF06, docs/design/CF06-workout-management-ui.md
// §2.2 and §2.3): schedule, length, targets, days, and exercises with sets, reps, weight, RPE, rest,
// a note and supersets. The server checks every value again; this only helps the coach get it right.
import { MAX_EXERCISES_PER_DAY, type PlanContent, type PlanDay, type PlanExercise } from '@fitsphere-coach/shared';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, Icon, PrimaryButton, textStyles } from '../components/ui';
import { fonts, radius, useTheme } from '../theme';
import { ActionLink, Card, Chip, NumField, Segmented, SectionLabel, SwitchRow } from './parts';
import { codesOf, useExerciseNames } from './exercises';
import { ExercisePicker } from './ExercisePicker';
import { canAddDay, dayMeta, exerciseName, exerciseSummary, gramsToKg, kgToGrams, newDay, newExercise, restText, WEEKDAY_LABELS, withScheduleMode } from './texts';

type Props = { content: PlanContent; onChange: (content: PlanContent) => void; disabled?: boolean };

export function ContentEditor({ content, onChange, disabled }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState<number | null>(0);
  const [openExercise, setOpenExercise] = useState<string | null>(null);
  const [pickerDay, setPickerDay] = useState<number | null>(null);
  useExerciseNames(codesOf(content));

  const setDay = (index: number, day: PlanDay) => onChange({ ...content, days: content.days.map((existing, i) => (i === index ? day : existing)) });

  function addExercises(index: number, ids: string[]) {
    const day = content.days[index];
    if (!day) return;
    const room = MAX_EXERCISES_PER_DAY - day.exercises.length;
    setDay(index, { ...day, exercises: [...day.exercises, ...ids.slice(0, room).map(newExercise)] });
  }

  return (
    <View pointerEvents={disabled ? 'none' : 'auto'} style={{ opacity: disabled ? 0.6 : 1 }}>
      <SectionLabel>Schedule</SectionLabel>
      <Segmented
        label="Schedule"
        value={content.scheduleMode}
        onChange={(mode) => onChange(withScheduleMode(content, mode))}
        options={[
          { value: 'weekdays', label: 'Weekdays' },
          { value: 'rotating', label: 'Rotating' },
        ]}
      />
      <Text style={[textStyles.small, { color: colors.inkMuted, marginTop: 6 }]}>
        Weekdays: each day is tied to a weekday (Day 1 = Mon). Rotating: the client does Day 1, Day 2 … in turn.
      </Text>
      <View style={{ marginTop: 14 }}>
        <NumField label="Length (weeks)" value={content.weeks} min={1} max={52} hint="Leave empty for an ongoing plan." onChange={(weeks) => onChange({ ...content, weeks })} />
      </View>

      <SectionLabel>Targets for the client</SectionLabel>
      <Text style={[textStyles.small, { color: colors.inkMuted, marginBottom: 8 }]}>
        Optional goals that appear in the client's FitSphere app once they get this plan. The client cannot change them.
      </Text>
      <Card>
        <SwitchRow
          title="Weekly workout goal"
          sub={content.weeklyTarget === null ? 'Off. The client keeps their own weekly goal.' : `On. The client aims for ${content.weeklyTarget} workouts every week.`}
          value={content.weeklyTarget !== null}
          onChange={(on) => onChange({ ...content, weeklyTarget: on ? Math.min(7, Math.max(1, content.days.filter((day) => !day.rest).length)) : null })}
        />
        {content.weeklyTarget !== null ? (
          <View style={styles.inline}>
            <NumField label="Workouts a week" value={content.weeklyTarget} min={1} max={7} onChange={(value) => onChange({ ...content, weeklyTarget: value ?? 1 })} />
          </View>
        ) : null}
        <SwitchRow title="Daily workout goal" sub={content.dailyTarget ? 'On. On each training day, finishing that day’s workout is the goal.' : 'Off. Training days are not set as daily goals.'} value={content.dailyTarget} onChange={(dailyTarget) => onChange({ ...content, dailyTarget })} last />
      </Card>

      <SectionLabel>Days</SectionLabel>
      <View style={{ gap: 8 }}>
        {content.days.map((day, index) => {
          const expanded = open === index;
          return (
            <Card key={index}>
              <Pressable
                onPress={() => setOpen(expanded ? null : index)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${day.name}, ${dayMeta(day)}`}
                style={styles.dayHead}
              >
                <Text style={[styles.dayTag, { color: colors.accent }]}>{`D${index + 1}`}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[textStyles.listTitle, { color: colors.ink }]}>{day.name}</Text>
                  <Text style={[textStyles.small, { color: colors.inkMuted }]}>{dayMeta(day)}</Text>
                </View>
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} color={colors.inkSubtle} />
              </Pressable>

              {expanded ? (
                <View style={[styles.dayBody, { borderTopColor: colors.border }]}>
                  <Field label="Day name" value={day.name} maxLength={40} onChangeText={(name) => setDay(index, { ...day, name })} />
                  {content.scheduleMode === 'weekdays' ? (
                    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Weekday">
                      {WEEKDAY_LABELS.map((label, i) => {
                        const taken = content.days.some((other, j) => j !== index && other.weekday === i + 1);
                        return taken ? null : <Chip key={label} label={label} selected={day.weekday === i + 1} onPress={() => setDay(index, { ...day, weekday: i + 1 })} />;
                      })}
                    </View>
                  ) : null}
                  <SwitchRow
                    title="Rest day"
                    sub="No exercises on this day"
                    value={day.rest}
                    onChange={(rest) => setDay(index, { ...day, rest, exercises: rest ? [] : day.exercises })}
                    last
                  />

                  {day.exercises.map((exercise, i) => (
                    <ExerciseRow
                      key={`${i}-${exercise.exerciseId}`}
                      exercise={exercise}
                      keyId={`${index}-${i}`}
                      open={openExercise === `${index}-${i}`}
                      onToggle={() => setOpenExercise(openExercise === `${index}-${i}` ? null : `${index}-${i}`)}
                      first={i === 0}
                      hasPrevious={i > 0}
                      last={i === day.exercises.length - 1}
                      joined={i > 0 && day.exercises[i]?.group != null && day.exercises[i]?.group === day.exercises[i - 1]?.group}
                      onSuperset={() => {
                        const list = day.exercises.map((e) => ({ ...e }));
                        const current = list[i];
                        const above = list[i - 1];
                        if (!current || !above) return;
                        if (current.group !== null && current.group === above.group) {
                          current.group = null;
                          // A group of one is not a superset.
                          if (!list.some((e, j) => j !== i && e.group === above.group && j !== i - 1)) above.group = null;
                        } else {
                          const group = above.group ?? Math.max(0, ...list.map((e) => e.group ?? 0)) + 1;
                          above.group = group;
                          current.group = group;
                        }
                        setDay(index, { ...day, exercises: list });
                      }}
                      onChange={(next) => setDay(index, { ...day, exercises: day.exercises.map((e, j) => (j === i ? next : e)) })}
                      onMove={(by) => {
                        const list = [...day.exercises];
                        const [moved] = list.splice(i, 1);
                        if (moved) list.splice(i + by, 0, moved);
                        setDay(index, { ...day, exercises: list });
                      }}
                      onRemove={() => setDay(index, { ...day, exercises: day.exercises.filter((_, j) => j !== i) })}
                    />
                  ))}

                  <View style={styles.dayActions}>
                    {!day.rest ? <ActionLink icon="plus" label="Add exercise" disabled={day.exercises.length >= MAX_EXERCISES_PER_DAY} onPress={() => setPickerDay(index)} /> : null}
                    <ActionLink
                      icon="trash-2"
                      label="Remove day"
                      tone="danger"
                      disabled={content.days.length <= 1}
                      onPress={() => {
                        onChange({ ...content, days: content.days.filter((_, i) => i !== index) });
                        setOpen(null);
                      }}
                    />
                  </View>
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>
      <View style={{ marginTop: 10 }}>
        <ActionLink
          icon="plus"
          label="Add day"
          disabled={!canAddDay(content)}
          onPress={() => {
            onChange({ ...content, days: [...content.days, newDay(content)] });
            setOpen(content.days.length);
          }}
        />
      </View>

      <ExercisePicker
        visible={pickerDay !== null}
        onClose={() => setPickerDay(null)}
        onAdd={(ids) => {
          if (pickerDay !== null) addExercises(pickerDay, ids);
          setPickerDay(null);
        }}
      />
    </View>
  );
}

function ExerciseRow({
  exercise,
  open,
  onToggle,
  onChange,
  onMove,
  onRemove,
  first,
  last,
  joined,
  onSuperset,
  hasPrevious,
}: {
  exercise: PlanExercise;
  keyId: string;
  open: boolean;
  onToggle: () => void;
  onChange: (exercise: PlanExercise) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  first: boolean;
  last: boolean;
  joined: boolean;
  onSuperset: () => void;
  hasPrevious: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.exercise, { borderTopColor: colors.border, borderLeftColor: exercise.group !== null ? colors.accent : 'transparent' }]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${exerciseName(exercise.exerciseId)}, ${exerciseSummary(exercise)}`} style={styles.exerciseHead}>
        <View style={{ flex: 1 }}>
          <Text style={[textStyles.listTitle, { color: colors.ink }]}>{exerciseName(exercise.exerciseId)}</Text>
          <Text style={[textStyles.small, { color: colors.inkMuted }]}>{exerciseSummary(exercise)}</Text>
          {exercise.note ? <Text style={[textStyles.small, { color: colors.inkSubtle }]}>Note: {exercise.note}</Text> : null}
        </View>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} color={colors.inkSubtle} />
      </Pressable>
      {open ? (
        <View style={{ gap: 12, paddingBottom: 12 }}>
          <View style={styles.numbers}>
            <NumField label="Sets" value={exercise.sets} min={1} max={6} onChange={(sets) => onChange({ ...exercise, sets: sets ?? 1 })} />
            <NumField label="Reps from" value={exercise.repsMin} min={1} max={100} onChange={(repsMin) => onChange({ ...exercise, repsMin: repsMin ?? 1 })} />
            <NumField label="Reps to" value={exercise.repsMax} min={1} max={100} onChange={(repsMax) => onChange({ ...exercise, repsMax: repsMax ?? 1 })} />
          </View>
          {exercise.repsMax < exercise.repsMin ? <Text style={[textStyles.small, { color: colors.danger }]}>Reps to can't be below reps from.</Text> : null}
          <View style={styles.numbers}>
            <NumField label="Weight" suffix="kg" decimal value={exercise.weightG === null ? null : gramsToKg(exercise.weightG)} min={0} max={1000} onChange={(kg) => onChange({ ...exercise, weightG: kg === null ? null : kgToGrams(kg) })} />
            <NumField label="RPE" value={exercise.rpe} min={1} max={10} onChange={(rpe) => onChange({ ...exercise, rpe })} />
            <NumField label="Rest" suffix="s" value={exercise.restS} min={15} max={600} hint={restText(exercise.restS)} onChange={(restS) => onChange({ ...exercise, restS: restS ?? 120 })} />
          </View>
          <Field label="Note for the client" value={exercise.note} maxLength={200} onChangeText={(note) => onChange({ ...exercise, note })} />
          <View style={styles.rowActions}>
            <ActionLink icon="arrow-up" label="Up" tone="muted" disabled={first} onPress={() => onMove(-1)} />
            <ActionLink icon="arrow-down" label="Down" tone="muted" disabled={last} onPress={() => onMove(1)} />
            {hasPrevious ? <ActionLink icon="link" label={joined ? 'Ungroup' : 'Superset'} tone="muted" onPress={onSuperset} /> : null}
            <ActionLink icon="trash-2" label="Remove" tone="danger" onPress={onRemove} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inline: { paddingHorizontal: 16, paddingBottom: 12 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, minHeight: 64 },
  dayTag: { width: 40, fontFamily: fonts.display, fontSize: 18, letterSpacing: 1 },
  dayBody: { borderTopWidth: 1, padding: 14, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  exercise: { borderTopWidth: 1, borderLeftWidth: 3, paddingLeft: 8 },
  exerciseHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, minHeight: 56 },
  numbers: { flexDirection: 'row', gap: 10 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
});
