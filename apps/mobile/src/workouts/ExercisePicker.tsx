// The exercise picker (CF06, docs/design/CF06-workout-management-ui.md §2.2): the shared exercise
// library (2,000+ exercises) with a search box and filters for category, muscle and equipment. The
// server searches and pages; several exercises can be ticked and added at once.
import type { ExerciseFiltersResponse, ExerciseSummary } from '@fitsphere-coach/shared';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { Banner, Field, Icon, PrimaryButton, SecondaryButton, textStyles } from '../components/ui';
import { fonts, radius, useTheme } from '../theme';
import { rememberExercises } from './exercises';
import { Chip } from './parts';
import { loadExerciseFilters, searchExercises } from './service';

type Props = { visible: boolean; onClose: () => void; onAdd: (codes: string[]) => void };

export function ExercisePicker({ visible, onClose, onAdd }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { deps } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [filters, setFilters] = useState<ExerciseFiltersResponse | null>(null);
  const [shown, setShown] = useState<ExerciseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<ExerciseSummary[]>([]);
  const latest = useRef(0);

  // The filter chips come from the library itself, once the picker is first opened.
  useEffect(() => {
    if (!visible || filters) return;
    void loadExerciseFilters(deps).then((result) => {
      if (result.kind === 'ok') setFilters(result.body);
    });
  }, [visible, filters, deps]);

  // A new search (a short pause after typing, straight away for a filter) replaces the list.
  useEffect(() => {
    if (!visible) return;
    const request = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      void searchExercises(deps, { q: search, ...(category ? { category } : {}), ...(muscle ? { muscle } : {}), ...(equipment ? { equipment } : {}) }).then((result) => {
        if (request !== latest.current) return;
        setLoading(false);
        if (result.kind !== 'ok') return setFailed(true);
        rememberExercises(result.body.exercises);
        setShown(result.body.exercises);
        setTotal(result.body.total);
      });
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [visible, deps, search, category, muscle, equipment]);

  async function loadMore() {
    setLoading(true);
    const result = await searchExercises(deps, { q: search, ...(category ? { category } : {}), ...(muscle ? { muscle } : {}), ...(equipment ? { equipment } : {}), offset: shown.length });
    setLoading(false);
    if (result.kind !== 'ok') return setFailed(true);
    rememberExercises(result.body.exercises);
    setShown((current) => [...current, ...result.body.exercises]);
    setTotal(result.body.total);
  }

  function close(add: boolean) {
    const codes = picked.map((exercise) => exercise.code);
    setPicked([]);
    setSearch('');
    setCategory(null);
    setMuscle(null);
    setEquipment(null);
    if (add && codes.length > 0) onAdd(codes);
    else onClose();
  }

  const isPicked = (code: string) => picked.some((exercise) => exercise.code === code);
  const toggle = (exercise: ExerciseSummary) => setPicked((current) => (isPicked(exercise.code) ? current.filter((e) => e.code !== exercise.code) : [...current, exercise]));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => close(false)}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 8 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
          <Pressable onPress={() => close(false)} accessibilityRole="button" accessibilityLabel="Close exercise list" style={styles.back}>
            <Icon name="chevron-left" size={26} color={colors.ink} />
            <Text style={[textStyles.label, { color: colors.inkMuted, fontSize: 15 }]}>BACK</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>ADD EXERCISE</Text>
          <Text style={[textStyles.body, { color: colors.inkMuted, marginTop: 6 }]}>
            {total > 0 ? `${total} exercises. Search, or filter by category, muscle or equipment.` : 'Search, or filter by category, muscle or equipment.'}
          </Text>
          <View style={{ marginTop: 16, gap: 12 }}>
            <Field label="Search exercises" value={search} onChangeText={setSearch} placeholder="Search exercises" autoCorrect={false} />
            <FilterRow label="Category" options={filters?.categories} value={category} onChange={setCategory} />
            <FilterRow label="Muscle" options={filters?.muscles} value={muscle} onChange={setMuscle} />
            <FilterRow label="Equipment" options={filters?.equipment} value={equipment} onChange={setEquipment} />
          </View>
          <View style={{ marginTop: 16, gap: 8 }}>
            {shown.map((exercise) => {
              const on = isPicked(exercise.code);
              const meta = [exercise.primaryMuscle, exercise.equipment].filter(Boolean).join(' · ');
              return (
                <Pressable
                  key={exercise.code}
                  onPress={() => toggle(exercise)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={exercise.name}
                  style={[styles.pickRow, { backgroundColor: colors.surface, borderColor: on ? colors.accent : colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[textStyles.listTitle, { color: colors.ink }]}>{exercise.name}</Text>
                    {meta ? <Text style={[textStyles.small, { color: colors.inkMuted }]}>{meta}</Text> : null}
                  </View>
                  <View style={[styles.box, on ? { backgroundColor: colors.primary, borderColor: colors.primary } : { borderColor: colors.border }]}>{on ? <Icon name="check" size={18} color={colors.onPrimary} /> : null}</View>
                </Pressable>
              );
            })}
            {failed ? <Banner kind="error">Couldn’t load exercises. Check your connection and try again.</Banner> : null}
            {!loading && !failed && shown.length === 0 ? <Text style={[textStyles.body, { color: colors.inkMuted, textAlign: 'center', marginTop: 16 }]}>Nothing matches.</Text> : null}
            {shown.length < total ? <SecondaryButton label={loading ? 'Loading…' : 'Show more'} onPress={() => void loadMore()} disabled={loading} /> : null}
          </View>
        </ScrollView>
        <View style={{ padding: 16, paddingBottom: insets.bottom + 16 }}>
          <PrimaryButton label={picked.length === 0 ? 'Pick exercises' : `Add ${picked.length} ${picked.length === 1 ? 'exercise' : 'exercises'}`} disabled={picked.length === 0} onPress={() => close(true)} />
        </View>
      </View>
    </Modal>
  );
}

/** One filter: a row of chips that scrolls sideways. Tap the chosen one again, or "All", to clear it. */
function FilterRow({ label, options, value, onChange }: { label: string; options: { value: string; count: number }[] | undefined; value: string | null; onChange: (value: string | null) => void }) {
  const { colors } = useTheme();
  if (!options || options.length === 0) return null;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 6 }}>
      <Text style={[textStyles.label, { color: colors.inkMuted }]}>{label.toUpperCase()}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip label="All" selected={value === null} onPress={() => onChange(null)} />
        {options.map((option) => (
          <Chip key={option.value} label={option.value} selected={value === option.value} onPress={() => onChange(value === option.value ? null : option.value)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { height: 44, marginLeft: -6, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  title: { fontFamily: fonts.display, fontSize: 40, lineHeight: 40, marginTop: 8 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 14, minHeight: 60 },
  box: { width: 26, height: 26, borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
