// A client's exercises (CF04, docs/design/CF04-client-management-ui.md §2.10): their current training
// plan with each exercise's details from the shared library (muscles, steps, tip, video), and what they
// logged in the FitSphere app. Read only. The server decides who may open the client.
import { useFocusTick } from '../focus';
import type { ClientExercisesResponse, ClientPlanExercise } from '@fitsphere-coach/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS } from '../auth/texts';
import { Banner, Heading, PushedLayout, textStyles } from '../components/ui';
import { loadClientExercises } from '../clients/service';
import { CLIENT_TEXTS, sinceText } from '../clients/texts';
import { Chip } from '../workouts/parts';
import { exerciseSummary, WEEKDAY_LABELS } from '../workouts/texts';
import { radius, useTheme } from '../theme';

export default function ClientExercises() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { deps } = useAuth();
  const router = useRouter();
  const focused = useFocusTick();
  const { colors } = useTheme();
  const [data, setData] = useState<ClientExercisesResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let current = true;
    void loadClientExercises(deps, id).then((result) => {
      if (!current) return;
      if (result.kind === 'ok') setData(result.body);
      else if (result.kind === 'signedOut') router.replace('/sign-in?expired=1');
      else setProblem(result.kind === 'notFound' ? CLIENT_TEXTS.notFound : result.kind === 'offline' ? TEXTS.offline : TEXTS.tryLater);
    });
    return () => {
      current = false;
    };
  }, [deps, id, router, focused]);

  const plan = data?.plan ?? null;
  const day = plan?.days[dayIndex] ?? null;

  return (
    <PushedLayout backLabel="Client" onBack={() => (router.canGoBack() ? router.back() : router.replace('/clients'))} title="Exercises">
      {problem ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="error">{problem}</Banner>
        </View>
      ) : null}
      {!data && !problem ? (
        <View style={{ marginTop: 40 }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
        </View>
      ) : null}

      {data ? (
        <>
          {plan ? (
            <>
              <Heading first={plan.name.split(' ')[0] ?? 'Training'} second={plan.name.split(' ').slice(1).join(' ') || 'plan'} sub={plan.status === 'draft' ? CLIENT_TEXTS.exercisesDraft : 'Active plan'} />
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Day">
                {plan.days.map((d, index) => (
                  <Chip key={index} label={d.weekday ? (WEEKDAY_LABELS[d.weekday - 1] ?? d.name) : `Day ${index + 1}`} selected={dayIndex === index} onPress={() => setDayIndex(index)} />
                ))}
              </View>
              {day ? (
                <View style={{ marginTop: 14, gap: 8 }}>
                  <Text style={[textStyles.label, { color: colors.inkMuted }]}>{`${day.name.toUpperCase()}${day.rest ? ' · REST DAY' : ` · ${day.exercises.length} EXERCISES`}`}</Text>
                  {day.exercises.map((exercise, index) => (
                    <ExerciseCard key={`${index}-${exercise.exerciseId}`} exercise={exercise} open={open === `${dayIndex}-${index}`} onToggle={() => setOpen(open === `${dayIndex}-${index}` ? null : `${dayIndex}-${index}`)} />
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Heading first="No" second="plan yet" sub={CLIENT_TEXTS.exercisesEmpty} />
            </>
          )}

          <Text style={[textStyles.label, styles.section, { color: colors.inkMuted }]}>LOGGED BY THE CLIENT</Text>
          {data.recent.length === 0 ? <Text style={[textStyles.body, { color: colors.inkMuted }]}>{CLIENT_TEXTS.loggedNone}</Text> : null}
          <View style={{ gap: 8 }}>
            {data.recent.map((workout, index) => (
              <View key={index} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[textStyles.listTitle, { color: colors.ink }]}>{sinceText(`${workout.day}T00:00:00+05:30`)}</Text>
                {workout.exercises.length === 0 ? <Text style={[textStyles.small, { color: colors.inkMuted }]}>No exercises</Text> : null}
                {workout.exercises.map((item, i) => (
                  <Text key={i} style={[textStyles.small, { color: colors.inkMuted }]}>
                    {[item.name, item.sets !== null && item.reps !== null ? `${item.sets} × ${item.reps}` : null, item.weightG ? `${item.weightG / 1000} kg` : null].filter(Boolean).join(' · ')}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </>
      ) : null}
    </PushedLayout>
  );
}

function ExerciseCard({ exercise, open, onToggle }: { exercise: ClientPlanExercise; open: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  const detail = exercise.detail;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: open ? colors.accent : colors.border }]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${exercise.name}, ${exerciseSummary({ ...exercise, group: null })}`}>
        <Text style={[textStyles.listTitle, { color: colors.ink }]}>{exercise.name}</Text>
        <Text style={[textStyles.small, { color: colors.inkMuted }]}>{exerciseSummary({ ...exercise, group: null })}</Text>
      </Pressable>
      {open ? (
        <View style={{ marginTop: 10, gap: 8 }}>
          {detail ? (
            <>
              <View style={styles.tags}>
                {[detail.primaryMuscle, detail.equipment, ...detail.musclesWorked].filter((tag): tag is string => !!tag).map((tag, i) => (
                  <View key={`${tag}-${i}`} style={[styles.tag, { backgroundColor: colors.accentTint }]}>
                    <Text style={[textStyles.label, { color: colors.ink }]}>{tag.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
              {detail.steps.map((step, i) => (
                <Text key={i} style={[textStyles.small, { color: colors.inkMuted }]}>{`${i + 1}. ${step}`}</Text>
              ))}
              {detail.watchFor ? <Text style={[textStyles.small, { color: colors.ink }]}>{`Watch for: ${detail.watchFor}`}</Text> : null}
              {detail.videoUrl ? (
                <Pressable onPress={() => void Linking.openURL(detail.videoUrl as string)} accessibilityRole="link" accessibilityLabel={`Watch video for ${exercise.name}`}>
                  <Text style={[textStyles.label, { color: colors.accent }]}>▶ WATCH VIDEO</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text style={[textStyles.small, { color: colors.inkMuted }]}>No details in the exercise library for this one.</Text>
          )}
          {exercise.note ? <Text style={[textStyles.small, { color: colors.inkSubtle }]}>{`Coach's note: ${exercise.note}`}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  section: { marginTop: 24, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: radius.sm, padding: 14, gap: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.sm },
});
