// Add a client (CF04, docs/design/CF04-client-management-ui.md §2.3, C-D31 proposed). The Gym Owner
// adds the client directly; the account is created if the email has none. The Head Coach chooses who
// the client is under (C-D21). The server decides every refusal.
import type { ClientListResponse } from '@fitsphere-coach/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAccount } from '../account/AccountProvider';
import { useAuth } from '../auth/AuthProvider';
import { TEXTS, emailProblem } from '../auth/texts';
import { Banner, Field, Heading, PrimaryButton, PushedLayout, textStyles } from '../components/ui';
import { addClient, loadCandidates, loadClients, type AddResult } from '../clients/service';
import { CLIENT_TEXTS } from '../clients/texts';
import { radius, useTheme } from '../theme';

const FIELD_ERRORS: Partial<Record<AddResult, string>> = {
  alreadyAdded: CLIENT_TEXTS.alreadyAdded,
  invalid: CLIENT_TEXTS.addInvalid,
  notRegistered: CLIENT_TEXTS.addNotRegistered,
};
const BANNERS: Partial<Record<AddResult, string>> = {
  cannotAdd: CLIENT_TEXTS.addCannot,
  refused: CLIENT_TEXTS.refused,
  offline: TEXTS.offline,
  unavailable: TEXTS.tryLater,
};

export default function ClientAdd() {
  const { deps } = useAuth();
  const { state } = useAccount();
  const router = useRouter();
  const { colors } = useTheme();
  const me = state?.kind === 'coach' ? state.me : null;
  const isHead = me?.roles.includes('head_coach') ?? false;
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [coaches, setCoaches] = useState<ClientListResponse['coaches']>([]);
  const [under, setUnder] = useState<string | null>(null); // null = myself
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; email: string }[] | null>(null); // null: not available yet
  const [find, setFind] = useState('');

  // People who opted in to joining a gym (TCR-007). Hidden until the trainee app has the setting.
  useEffect(() => {
    if (!isHead) return;
    let current = true;
    const timer = setTimeout(() => {
      void loadCandidates(deps, find).then((list) => {
        if (current && list.kind === 'ok') setCandidates(list.body.enabled ? list.body.people : null);
      });
    }, find ? 300 : 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [deps, isHead, find]);

  useEffect(() => {
    if (!isHead) return;
    let current = true;
    void loadClients(deps).then((list) => {
      if (current && list.kind === 'ok') setCoaches(list.body.coaches);
    });
    return () => {
      current = false;
    };
  }, [deps, isHead]);

  const formatProblem = email.trim() === '' ? null : emailProblem(email);
  const ready = fullName.trim().length >= 2 && email.trim() !== '' && !formatProblem;

  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    setResult(null);
    const name = fullName.trim();
    const outcome = await addClient(deps, { email: email.trim().toLowerCase(), fullName: name, ...(isHead && under ? { coachId: under } : {}) });
    setSaving(false);
    if (outcome === 'signedOut') router.replace('/sign-in?expired=1');
    else if (outcome === 'added' || outcome === 'waiting' || outcome === 'addedNoEmail' || outcome === 'waitingNoEmail') {
      const waiting = outcome === 'waiting' || outcome === 'waitingNoEmail' ? '&waiting=1' : '';
      const noEmail = outcome === 'addedNoEmail' || outcome === 'waitingNoEmail' ? '&noEmail=1' : '';
      router.replace(`/client-added?name=${encodeURIComponent(name)}${waiting}${noEmail}` as never);
    }
    else setResult(outcome);
  }

  const fieldError = (result ? FIELD_ERRORS[result] : undefined) ?? (formatProblem && email.length > 3 ? formatProblem : undefined);
  const banner = result ? BANNERS[result] : undefined;

  return (
    <PushedLayout backLabel="Clients" onBack={() => (router.canGoBack() ? router.back() : router.replace('/clients'))} title="Add a client">
      <Heading first="Add a" second="client" sub={CLIENT_TEXTS.addSub} />
      <View style={{ marginTop: 24, gap: 18 }}>
        <Field
          label={CLIENT_TEXTS.addNameLabel}
          value={fullName}
          onChangeText={(text) => {
            setFullName(text);
            setResult(null);
          }}
          editable={!saving}
          autoCapitalize="words"
          placeholder="Full name"
        />
        {candidates ? (
          <View style={{ gap: 8 }}>
            <Text style={[textStyles.label, { color: colors.inkMuted }]}>PEOPLE OPEN TO JOINING A GYM</Text>
            <Field label="Find in the FitSphere app" value={find} onChangeText={setFind} placeholder="Search by email" autoCapitalize="none" autoCorrect={false} />
            {candidates.length === 0 ? <Text style={[textStyles.small, { color: colors.inkMuted }]}>{CLIENT_TEXTS.candidatesNone}</Text> : null}
            {candidates.map((person) => (
              <Pressable
                key={person.id}
                onPress={() => {
                  setEmail(person.email);
                  setResult(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Use ${person.email}`}
                style={[styles.choice, { backgroundColor: colors.surface, borderColor: email.trim().toLowerCase() === person.email.toLowerCase() ? colors.accent : colors.border }]}
              >
                <Text style={[textStyles.listTitle, { color: colors.ink, flex: 1 }]}>{person.email}</Text>
                <Text style={[textStyles.label, { color: colors.accent }]}>USE</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Field
          label="Client email"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setResult(null);
          }}
          error={fieldError ?? null}
          editable={!saving}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="name@example.com"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
        {isHead ? (
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            <Text style={[textStyles.label, { color: colors.inkMuted }]}>ADD UNDER</Text>
            <Choice label="Myself" sub="They become your client" selected={under === null} onPress={() => setUnder(null)} />
            {coaches.map((coach) => (
              <Choice key={coach.id} label={coach.name ?? 'Coach'} sub="They become this coach's client" selected={under === coach.id} onPress={() => setUnder(coach.id)} />
            ))}
          </View>
        ) : null}
        <Banner kind="info">{CLIENT_TEXTS.addInfo}</Banner>
        {banner ? <Banner kind="error">{banner}</Banner> : null}
        <PrimaryButton label="Add client" arrow onPress={() => void save()} disabled={!ready} loading={saving} />
      </View>
    </PushedLayout>
  );
}

function Choice({ label, sub, selected, onPress }: { label: string; sub: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[styles.choice, { backgroundColor: colors.surface, borderColor: selected ? colors.accent : colors.border }]}
    >
      <View style={[styles.radio, { borderColor: selected ? colors.accent : colors.inkSubtle }]}>
        {selected ? <View style={[styles.dot, { backgroundColor: colors.accent }]} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[textStyles.listTitle, { color: colors.ink }]}>{label}</Text>
        <Text style={[textStyles.small, { color: colors.inkMuted }]}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 14, minHeight: 56 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
