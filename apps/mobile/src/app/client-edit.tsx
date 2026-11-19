// Edit a client (CF04, docs/design/CF04-client-management-ui.md §2.9). The gym keeps the name, phone,
// goal and notes in schema `coach`; the email is the client's login and cannot change here. The server
// decides who may edit (the Head Coach any client of the gym, a Coach their own).
import { FITNESS_GOALS } from '@fitsphere-coach/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS } from '../auth/texts';
import { Banner, Field, Heading, PrimaryButton, PushedLayout, textStyles } from '../components/ui';
import { FITNESS_GOAL_LABELS, loadClientProfile, updateClient } from '../clients/service';
import { CLIENT_TEXTS } from '../clients/texts';
import { Chip } from '../workouts/parts';
import { useTheme } from '../theme';

const PHONE = /^[0-9+() -]{7,20}$/;

export default function ClientEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { deps } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [goal, setGoal] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id) return;
    let current = true;
    void loadClientProfile(deps, id).then((result) => {
      if (!current) return;
      if (result.kind === 'ok') {
        setEmail(result.body.email ?? '');
        setFullName(result.body.name === result.body.email ? '' : result.body.name);
        setPhone(result.body.phone ?? '');
        setGoal(result.body.fitnessGoal ?? null);
        setNotes(result.body.notes ?? '');
        setLoaded(true);
      } else if (result.kind === 'signedOut') router.replace('/sign-in?expired=1');
      else setProblem(result.kind === 'notFound' ? CLIENT_TEXTS.notFound : result.kind === 'offline' ? TEXTS.offline : TEXTS.tryLater);
    });
    return () => {
      current = false;
    };
  }, [deps, id, router]);

  const phoneBad = phone.trim() !== '' && !PHONE.test(phone.trim());
  const ready = fullName.trim().length >= 2 && !phoneBad;

  async function save() {
    if (!id || !ready || saving) return;
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const result = await updateClient(deps, id, { fullName: fullName.trim(), phone: phone.trim() === '' ? null : phone.trim(), fitnessGoal: goal, notes });
    setSaving(false);
    if (result === 'done') {
      setSaved(true);
      router.back();
    } else if (result === 'signedOut') router.replace('/sign-in?expired=1');
    else setProblem(result === 'invalid' ? CLIENT_TEXTS.editInvalid : result === 'notFound' ? CLIENT_TEXTS.notFound : result === 'offline' ? TEXTS.offline : TEXTS.tryLater);
  }

  return (
    <PushedLayout backLabel="Client" onBack={() => (router.canGoBack() ? router.back() : router.replace('/clients'))} title="Edit client">
      <Heading first="Edit" second="client" />
      {!loaded && !problem ? (
        <View style={{ marginTop: 40 }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
        </View>
      ) : null}
      {loaded ? (
        <View style={{ marginTop: 24, gap: 18 }}>
          <Field label={CLIENT_TEXTS.editNameLabel} value={fullName} onChangeText={setFullName} editable={!saving} autoCapitalize="words" />
          <Field label="Email" value={email} editable={false} hint={CLIENT_TEXTS.emailLocked} />
          <Field
            label="Phone (optional)"
            value={phone}
            onChangeText={setPhone}
            editable={!saving}
            keyboardType="phone-pad"
            error={phoneBad ? 'Enter a phone number like +91 98765 43210.' : null}
          />
          <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Fitness goal">
            <Text style={[textStyles.label, { color: colors.inkMuted }]}>FITNESS GOAL</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {FITNESS_GOALS.map((value) => (
                <Chip key={value} label={FITNESS_GOAL_LABELS[value] ?? value} selected={goal === value} onPress={() => setGoal(goal === value ? null : value)} />
              ))}
            </View>
          </View>
          <Field label={CLIENT_TEXTS.notesLabel} value={notes} onChangeText={setNotes} editable={!saving} multiline numberOfLines={4} maxLength={500} />
          {problem ? <Banner kind="error">{problem}</Banner> : null}
          {saved ? <Banner kind="success">{CLIENT_TEXTS.editSaved}</Banner> : null}
          <PrimaryButton label="Save changes" onPress={() => void save()} disabled={!ready} loading={saving} />
        </View>
      ) : problem ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="error">{problem}</Banner>
        </View>
      ) : null}
    </PushedLayout>
  );
}
