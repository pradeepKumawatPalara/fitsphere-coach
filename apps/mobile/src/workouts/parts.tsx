// Small pieces shared by the workout screens (docs/design/design-system.md).
import type { PlanStatus } from '@fitsphere-coach/shared';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon, PrimaryButton, Sheet, textStyles } from '../components/ui';
import { fonts, radius, useTheme } from '../theme';
import { addDays, dayText, STATUS_LABELS, todayIst } from './texts';

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: selected ? colors.surfaceRaised : 'transparent', borderColor: selected ? colors.accent : colors.border }]}
    >
      <Text style={[styles.chipText, { color: selected ? colors.ink : colors.inkMuted }]}>{label.toUpperCase()}</Text>
    </Pressable>
  );
}

/** Two or three options in one track (design system "segment"). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.track, { backgroundColor: colors.surfaceSunken }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[styles.segment, selected ? { backgroundColor: colors.surfaceRaised } : null]}
          >
            <Text style={[styles.segmentText, { color: selected ? colors.ink : colors.inkMuted }]}>{option.label.toUpperCase()}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type Option<T extends string> = { value: T; label: string };

function DropdownSheet<T extends string>({ visible, onClose, title, options, selected, onPick, multi }: { visible: boolean; onClose: () => void; title: string; options: Option<T>[]; selected: T[]; onPick: (value: T) => void; multi: boolean }) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} labelledBy={title}>
      <Text accessibilityRole="header" style={[textStyles.label, { color: colors.inkMuted, marginTop: 22 }]}>{title.toUpperCase()}</Text>
      <ScrollView style={{ maxHeight: 360, marginTop: 8 }}>
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <Pressable
              key={option.value}
              onPress={() => onPick(option.value)}
              accessibilityRole={multi ? 'checkbox' : 'radio'}
              accessibilityState={multi ? { checked: on } : { selected: on }}
              accessibilityLabel={option.label}
              style={[styles.option, { borderBottomColor: colors.border }]}
            >
              <Text style={[textStyles.listTitle, { color: on ? colors.accent : colors.ink, flex: 1 }]}>{option.label}</Text>
              {on ? <Icon name="check" size={20} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ marginTop: 16 }}>
        <PrimaryButton label="Done" onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** One choice from a list, in a dropdown. */
export function Dropdown<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (value: T) => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[textStyles.label, { color: colors.inkMuted }]}>{label.toUpperCase()}</Text>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? ''}`} style={[styles.select, { backgroundColor: colors.surfaceSunken, borderColor: colors.border }]}>
        <Text style={[textStyles.body, { color: colors.ink, flex: 1 }]}>{current?.label ?? 'Choose'}</Text>
        <Icon name="chevron-down" color={colors.inkSubtle} />
      </Pressable>
      <DropdownSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={label}
        options={options}
        selected={[value]}
        multi={false}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </View>
  );
}

/** Any number of choices from a list, in a dropdown. Nothing picked means "all". */
export function MultiDropdown<T extends string>({ label, options, values, onChange, allLabel }: { label: string; options: Option<T>[]; values: T[]; onChange: (values: T[]) => void; allLabel: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const names = options.filter((option) => values.includes(option.value)).map((option) => option.label);
  const text = names.length === 0 ? allLabel : names.length <= 2 ? names.join(', ') : `${names.length} selected`;
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${text}`} style={[styles.select, { backgroundColor: colors.surfaceSunken, borderColor: colors.border }]}>
        <Text numberOfLines={1} style={[textStyles.body, { color: names.length ? colors.ink : colors.inkMuted, flex: 1 }]}>{`${label}: ${text}`}</Text>
        <Icon name="chevron-down" color={colors.inkSubtle} />
      </Pressable>
      <DropdownSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={label}
        options={options}
        selected={values}
        multi
        onPick={(next) => onChange(values.includes(next) ? values.filter((v) => v !== next) : [...values, next])}
      />
      {values.length > 0 ? (
        <Pressable onPress={() => onChange([])} accessibilityRole="button" accessibilityLabel={`Clear ${label}`} hitSlop={8}>
          <Text style={[textStyles.small, { color: colors.accent }]}>Clear {label.toLowerCase()}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Radio buttons: a round dot, a title and a line of help for each choice. */
export function RadioGroup<T extends string>({ label, options, value, onChange }: { label: string; options: (Option<T> & { sub?: string })[]; value: T; onChange: (value: T) => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 8 }}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable key={option.value} onPress={() => onChange(option.value)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={option.label} style={styles.radioRow}>
            <View style={[styles.radio, { borderColor: on ? colors.accent : colors.border }]}>{on ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={[textStyles.listTitle, { color: colors.ink }]}>{option.label}</Text>
              {option.sub ? <Text style={[textStyles.small, { color: colors.inkMuted }]}>{option.sub}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StatusChip({ status }: { status: PlanStatus }) {
  const { colors } = useTheme();
  const look = {
    active: { background: colors.successTint, color: colors.success, border: 'transparent' },
    draft: { background: colors.warning + '24', color: colors.warning, border: 'transparent' },
    ended: { background: 'transparent', color: colors.inkSubtle, border: colors.border },
  }[status];
  return (
    <View accessibilityLabel={`Status: ${STATUS_LABELS[status]}`} style={[styles.status, { backgroundColor: look.background, borderColor: look.border }]}>
      <Text style={[styles.statusText, { color: look.color }]}>{STATUS_LABELS[status].toUpperCase()}</Text>
    </View>
  );
}

export function Tag({ label, tone }: { label: string; tone: 'accent' | 'plain' }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.status, { backgroundColor: tone === 'accent' ? colors.accentTint : 'transparent', borderColor: tone === 'accent' ? 'transparent' : colors.border }]}>
      <Text style={[styles.statusText, { color: tone === 'accent' ? colors.accent : colors.inkMuted }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[textStyles.label, { color: colors.inkMuted, marginTop: 20, marginBottom: 8 }]}>{children.toUpperCase()}</Text>;
}

export function SwitchRow({ title, sub, value, onChange, last }: { title: string; sub: string; value: boolean; onChange: (value: boolean) => void; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.switchRow, last ? null : { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[textStyles.listTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[textStyles.small, { color: colors.inkMuted }]}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={title}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={value ? colors.onPrimary : colors.surfaceRaised}
      />
    </View>
  );
}

/** A small icon-and-text action ("Add exercise"). */
export function ActionLink({ icon, label, onPress, tone = 'accent', disabled }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onPress: () => void; tone?: 'accent' | 'muted' | 'danger'; disabled?: boolean }) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.danger : tone === 'muted' ? colors.inkMuted : colors.accent;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={[styles.action, { opacity: disabled ? 0.4 : 1 }]}>
      <Icon name={icon} size={18} color={color} />
      <Text style={[styles.actionText, { color }]}>{label.toUpperCase()}</Text>
    </Pressable>
  );
}

/** A whole number or empty, kept as text while typing so "1." or an empty box does not jump. */
export function NumField({ label, value, onChange, min, max, hint, suffix, decimal }: { label: string; value: number | null; onChange: (value: number | null) => void; min: number; max: number; hint?: string; suffix?: string; decimal?: boolean }) {
  const { colors } = useTheme();
  const [text, setText] = useState(value === null ? '' : String(value));
  const parsed = text.trim() === '' ? null : Number(text);
  const bad = parsed !== null && (Number.isNaN(parsed) || parsed < min || parsed > max || (!decimal && !Number.isInteger(parsed)));
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={[textStyles.label, { color: colors.inkMuted }]}>{label.toUpperCase()}</Text>
      <View>
        <TextInput
          accessibilityLabel={label}
          value={text}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          onChangeText={(next) => {
            setText(next);
            const number = next.trim() === '' ? null : Number(next);
            if (number === null || (!Number.isNaN(number) && number >= min && number <= max && (decimal || Number.isInteger(number)))) onChange(number);
          }}
          style={[styles.num, { backgroundColor: colors.surfaceSunken, borderColor: bad ? colors.danger : colors.border, color: colors.ink, paddingRight: suffix ? 34 : 12 }]}
        />
        {suffix ? <Text style={[styles.suffix, { color: colors.inkMuted }]}>{suffix}</Text> : null}
      </View>
      {bad ? <Text style={[textStyles.small, { color: colors.danger }]}>{`${min} to ${max}`}</Text> : hint ? <Text style={[textStyles.small, { color: colors.inkMuted }]}>{hint}</Text> : null}
    </View>
  );
}

/** Start date: today or later, one day at a time. */
export function DateStepper({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { colors } = useTheme();
  const today = todayIst();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[textStyles.label, { color: colors.inkMuted }]}>{label.toUpperCase()}</Text>
      <View style={[styles.stepper, { backgroundColor: colors.surfaceSunken, borderColor: colors.border }]}>
        <Pressable onPress={() => onChange(addDays(value, -1))} disabled={value <= today} accessibilityRole="button" accessibilityLabel="Earlier day" style={[styles.step, { opacity: value <= today ? 0.3 : 1 }]}>
          <Icon name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={[styles.stepText, { color: colors.ink }]}>{dayText(value)}</Text>
        <Pressable onPress={() => onChange(addDays(value, 1))} accessibilityRole="button" accessibilityLabel="Later day" style={styles.step}>
          <Icon name="chevron-right" size={22} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  select: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: 14 },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  chip: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: radius.sm, justifyContent: 'center' },
  chipText: { fontFamily: fonts.displayBold, fontSize: 14, letterSpacing: 1 },
  track: { flexDirection: 'row', borderRadius: radius.sm, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentText: { fontFamily: fonts.display, fontSize: 15, letterSpacing: 1.2 },
  status: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: radius.xs, borderWidth: 1, alignSelf: 'flex-start' },
  statusText: { fontFamily: fonts.displayBold, fontSize: 12, letterSpacing: 1.2 },
  card: { borderWidth: 1, borderRadius: radius.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, minHeight: 64 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  actionText: { fontFamily: fonts.display, fontSize: 15, letterSpacing: 1 },
  num: { height: 48, borderWidth: 1.5, borderRadius: radius.sm, paddingLeft: 12, fontFamily: fonts.body, fontSize: 17 },
  suffix: { position: 'absolute', right: 10, top: 14, fontFamily: fonts.body, fontSize: 14 },
  stepper: { height: 54, borderWidth: 1.5, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: fonts.body, fontSize: 17 },
});
