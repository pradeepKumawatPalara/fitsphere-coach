// Schedule a diet plan (CF09, docs/design/CF09-calendar-ui.md §2.6): the client's active diet plan as a
// full-day plan over a range of days. A diet plan already scheduled on those days is cut short or
// replaced; that is a warning, never a block.
import type { CalendarOptions, ClientSummary, DietTemplateSummary } from '@fitsphere-coach/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS } from '../auth/texts';
import { loadClients } from '../clients/service';
import { loadOptions, saveNutrition } from '../calendar/service';
import { addDays, CALENDAR_TEXTS } from '../calendar/texts';
import { Banner, Field, PrimaryButton, PushedLayout, SecondaryButton, textStyles } from '../components/ui';
import { assignDietPlans, loadDietTemplates } from '../nutrition/service';
import { Card, Chip, DateStepper, Dropdown, SectionLabel } from '../workouts/parts';
import { failureText, todayIst } from '../workouts/texts';
import { useTheme } from '../theme';

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export default function CalendarScheduleDiet() {
  const params = useLocalSearchParams<{ traineeId?: string }>();
  const { deps } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [traineeId, setTraineeId] = useState<string | undefined>(params.traineeId);
  const [options, setOptions] = useState<CalendarOptions | null>(null);
  const [from, setFrom] = useState(() => addDays(todayIst(), 1));
  const [to, setTo] = useState(() => addDays(todayIst(), 28));
  const [notes, setNotes] = useState('');
  const [templates, setTemplates] = useState<DietTemplateSummary[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

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
      if (result.kind === 'ok') setOptions(result.body);
      else setProblem(failureText(result.kind, TEXTS));
    });
    return () => {
      current = false;
    };
  }, [deps, traineeId]);

  const plan = options?.dietPlan ?? null;
  const needsTemplate = options !== null && !plan;

  // A client with no active diet plan can be given one of the coach's templates right here.
  useEffect(() => {
    if (!needsTemplate) return;
    let current = true;
    void loadDietTemplates(deps).then((result) => {
      if (current && result.kind === 'ok') setTemplates(result.body);
    });
    return () => {
      current = false;
    };
  }, [deps, needsTemplate]);

  const template = templates?.find((t) => t.id === templateId) ?? null;
  const days = daysBetween(from, to) + 1;
  const rangeOk = days >= 1 && days <= 90;

  async function save() {
    if ((!plan && !template) || !traineeId) return;
    setWorking(true);
    setProblem(null);
    let planId = plan?.id;
    if (!planId && template) {
      const assigned = await assignDietPlans(deps, template.id, [traineeId], from, false);
      if (assigned.kind !== 'ok') {
        setWorking(false);
        if (assigned.kind === 'signedOut') router.replace('/sign-in?expired=1');
        else setProblem(failureText(assigned.kind, TEXTS));
        return;
      }
      planId = assigned.body[0]?.id;
    }
    if (!planId) {
      setWorking(false);
      return;
    }
    const result = await saveNutrition(deps, { traineeId, planId, from, to, notes });
    if (result.kind !== 'ok' && !plan) {
      // The template is already this client's plan; show it as the plan so a retry schedules it.
      const fresh = await loadOptions(deps, traineeId);
      if (fresh.kind === 'ok') setOptions(fresh.body);
    }
    setWorking(false);
    if (result.kind === 'ok') router.replace('/calendar');
    else if (result.kind === 'signedOut') router.replace('/sign-in?expired=1');
    else setProblem(result.kind === 'invalid' ? 'Check the dates: the end is not before the start, and at most 90 days.' : failureText(result.kind, TEXTS));
  }

  return (
    <PushedLayout backLabel="Calendar" onBack={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))} title="Schedule diet plan">
      <Text style={[textStyles.body, { color: colors.inkMuted, marginTop: 6 }]}>A diet plan is scheduled as a full-day plan for a range of dates.</Text>
      {problem ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="error">{problem}</Banner>
        </View>
      ) : null}

      <SectionLabel>Client</SectionLabel>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Client">
        {clients?.map((client) => (
          <Chip key={client.id} label={client.name} selected={traineeId === client.id} onPress={() => setTraineeId(client.id)} />
        ))}
      </View>
      {traineeId && !options ? <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" style={{ marginTop: 20 }} /> : null}
      {needsTemplate ? (
        <>
          <View style={{ marginTop: 16 }}>
            <Banner kind="info">{CALENDAR_TEXTS.noDietPlan}</Banner>
          </View>
          {templates && templates.length === 0 ? (
            <View style={{ marginTop: 12 }}>
              <Banner kind="info">You have no diet templates yet. Make one in Nutrition first.</Banner>
            </View>
          ) : templates ? (
            <View style={{ marginTop: 16 }}>
              <Dropdown label="Diet template" value={templateId} onChange={setTemplateId} options={[{ value: '', label: 'Choose a template' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} />
            </View>
          ) : (
            <ActivityIndicator color={colors.accent} accessibilityLabel="Loading templates" style={{ marginTop: 20 }} />
          )}
        </>
      ) : null}

      {plan || template ? (
        <>
          <SectionLabel>Diet plan</SectionLabel>
          <Card>
            <View style={{ padding: 14, gap: 2 }}>
              <Text style={[textStyles.listTitle, { color: colors.ink }]}>{plan?.name ?? template?.name}</Text>
              <Text style={[textStyles.small, { color: colors.inkMuted }]}>{plan ? 'Active' : 'From your template. It becomes this client’s active plan when you save.'}</Text>
            </View>
          </Card>
          <View style={{ marginTop: 18, gap: 16 }}>
            <DateStepper label="From" value={from} onChange={(next) => (setFrom(next), next > to ? setTo(next) : undefined)} />
            <DateStepper label="To" value={to} onChange={(next) => (next >= from ? setTo(next) : undefined)} />
            <Field label="Notes for the client" value={notes} onChangeText={setNotes} maxLength={300} placeholder="Swap rice for roti on rest days" />
          </View>
          <View style={{ marginTop: 16, gap: 10 }}>
            <Banner kind={rangeOk ? 'info' : 'error'}>{rangeOk ? `${days} ${days === 1 ? 'day' : 'days'}. The plan shows on each of these days in the client's calendar.` : 'At most 90 days.'}</Banner>
            <Banner kind="info">{CALENDAR_TEXTS.dietReplaces}</Banner>
          </View>
          <View style={{ marginTop: 20, gap: 10 }}>
            <PrimaryButton label="Save schedule" disabled={!rangeOk} loading={working} onPress={() => void save()} />
            <SecondaryButton label="Cancel" onPress={() => router.replace('/calendar')} disabled={working} />
          </View>
        </>
      ) : null}
    </PushedLayout>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
