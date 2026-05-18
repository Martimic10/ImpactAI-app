import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  TouchableWithoutFeedback,
  Platform,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '@/lib/theme';

const ACCENT = '#34E06F';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.12)';
const SHEET_DARK = 'rgba(16, 18, 16, 0.98)';
const MIN_SCORE = 1;
const MAX_SCORE = 15;
const QUICK_PICK_MAX = 10;
const QUICK_CHIP_W = 84;
const QUICK_CHIP_GAP = 12;
const QUICK_ITEM_W = QUICK_CHIP_W + QUICK_CHIP_GAP;

function scoreToParLabel(score: number, par: number): string {
  if (score === 1) return 'Hole in 1';
  const d = score - par;
  if (d <= -3) return 'Albatross';
  if (d === -2) return 'Eagle';
  if (d === -1) return 'Birdie';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double';
  if (d === 3) return 'Triple';
  return d > 0 ? `+${d}` : String(d);
}

function quickPickLabel(score: number, par: number): string {
  if (score === 1) return 'Ace';
  return scoreToParLabel(score, par);
}

function GlassPanel({
  children,
  isDark,
  style,
}: {
  children: React.ReactNode;
  isDark: boolean;
  style?: object;
}) {
  return (
    <View
      style={[
        s.glassPanel,
        {
          backgroundColor: isDark ? 'rgba(28, 30, 28, 0.92)' : 'rgba(255,255,255,0.94)',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export type EnterScoreModalProps = {
  visible: boolean;
  playerName: string;
  holeNumber: number;
  par: number;
  value: number;
  onChange: (value: number) => void;
  onSave: () => void;
  onClose: () => void;
  isDark: boolean;
};

export function EnterScoreModal({
  visible,
  playerName,
  holeNumber,
  par,
  value,
  onChange,
  onSave,
  onClose,
  isDark,
}: EnterScoreModalProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const quickListRef = useRef<FlatList<number>>(null);

  const quickScores = useMemo(
    () => Array.from({ length: QUICK_PICK_MAX }, (_, i) => i + MIN_SCORE),
    []
  );

  const clamp = (n: number) => Math.max(MIN_SCORE, Math.min(MAX_SCORE, n));
  const parLabel = scoreToParLabel(value, par);
  const sheetBg = isDark ? SHEET_DARK : colors.background;

  useEffect(() => {
    if (!visible) return;
    const idx = Math.max(0, value - MIN_SCORE);
    const t = setTimeout(() => {
      quickListRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0.35,
      });
    }, 150);
    return () => clearTimeout(t);
  }, [visible, value, holeNumber]);

  const renderQuickChip = useCallback(
    ({ item: score }: { item: number }) => {
      const active = score === value;
      const label = quickPickLabel(score, par);
      return (
        <Pressable
          onPress={() => onChange(score)}
          style={({ pressed }) => [
            s.quickChip,
            {
              backgroundColor: active
                ? isDark
                  ? 'rgba(52,224,111,0.16)'
                  : ACCENT_SOFT
                : isDark
                  ? 'rgba(255,255,255,0.05)'
                  : 'rgba(0,0,0,0.04)',
              borderColor: active ? ACCENT : isDark ? 'rgba(255,255,255,0.1)' : colors.border,
              opacity: pressed ? 0.88 : 1,
            },
          ]}
        >
          <View style={s.quickChipInner}>
            <Text style={[s.quickScore, { color: active ? ACCENT : colors.text }]}>{score}</Text>
            <Text
              style={[s.quickPar, { color: active ? ACCENT : colors.textSecondary }]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
        </Pressable>
      );
    },
    [colors.border, colors.text, colors.textSecondary, isDark, onChange, par, value]
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <View
              style={[
                s.sheet,
                {
                  backgroundColor: sheetBg,
                  borderTopColor: isDark ? 'rgba(52,224,111,0.18)' : colors.border,
                  paddingBottom: Math.max(insets.bottom, 16) + 8,
                },
              ]}
            >
              <View style={[s.handle, { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : colors.border }]} />

              <View style={s.header}>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={({ pressed }) => [
                    s.closeBtn,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : colors.surfaceAlt,
                      borderColor: isDark ? 'rgba(255,255,255,0.1)' : colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </Pressable>
                <View style={s.headerCenter}>
                  <Text style={[s.title, { color: colors.text }]}>Enter score</Text>
                  <Text style={[s.subtitle, { color: colors.textSecondary }]}>
                    Hole {holeNumber} · Par {par}
                  </Text>
                </View>
                <View style={s.closeBtnSpacer} />
              </View>

              <View
                style={[
                  s.playerChip,
                  {
                    backgroundColor: isDark ? 'rgba(52,224,111,0.1)' : ACCENT_SOFT,
                    borderColor: 'rgba(52,224,111,0.32)',
                  },
                ]}
              >
                <View style={s.playerIconWrap}>
                  <Ionicons name="person" size={14} color={ACCENT} />
                </View>
                <Text style={[s.playerName, { color: colors.text }]} numberOfLines={1}>
                  {playerName}
                </Text>
              </View>

              <GlassPanel isDark={isDark} style={s.heroPanel}>
                <View style={s.stepperRow}>
                  <Pressable
                    onPress={() => onChange(clamp(value - 1))}
                    disabled={value <= MIN_SCORE}
                    style={({ pressed }) => [
                      s.stepBtn,
                      {
                        opacity: value <= MIN_SCORE ? 0.28 : pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <Text style={[s.stepGlyph, { color: colors.text }]}>−</Text>
                  </Pressable>

                  <View style={s.scoreDisplay}>
                    <Text style={[s.scoreBig, { color: colors.text }]}>{value}</Text>
                    <View
                      style={[
                        s.parPill,
                        value === par && s.parPillOn,
                      ]}
                    >
                      <Text style={[s.parPillTxt, value === par && s.parPillTxtOn]}>
                        {parLabel}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => onChange(clamp(value + 1))}
                    disabled={value >= MAX_SCORE}
                    style={({ pressed }) => [
                      s.stepBtn,
                      {
                        opacity: value >= MAX_SCORE ? 0.28 : pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <Text style={[s.stepGlyph, { color: colors.text }]}>+</Text>
                  </Pressable>
                </View>
              </GlassPanel>

              <View style={s.section}>
                <Text style={[s.sectionLbl, { color: colors.textMuted }]}>Quick pick</Text>
                <View
                  style={[
                    s.quickTrack,
                    {
                      backgroundColor: isDark ? 'rgba(28, 30, 28, 0.92)' : colors.surfaceAlt,
                      borderColor: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
                    },
                  ]}
                >
                  <FlatList
                    ref={quickListRef}
                    data={quickScores}
                    keyExtractor={(score) => String(score)}
                    renderItem={renderQuickChip}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={s.quickList}
                    contentContainerStyle={s.quickListContent}
                    ItemSeparatorComponent={() => <View style={{ width: QUICK_CHIP_GAP }} />}
                    getItemLayout={(_, index) => ({
                      length: QUICK_ITEM_W,
                      offset: QUICK_ITEM_W * index,
                      index,
                    })}
                    onScrollToIndexFailed={(info) => {
                      setTimeout(() => {
                        quickListRef.current?.scrollToIndex({
                          index: info.index,
                          animated: true,
                          viewPosition: 0.35,
                        });
                      }, 80);
                    }}
                  />
                </View>
              </View>

              <View style={s.ctaShell} collapsable={false}>
                <Pressable
                  onPress={onSave}
                  style={({ pressed }) => [
                    s.ctaPressable,
                    { opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
                  ]}
                >
                  <View style={s.ctaRow}>
                    <Ionicons name="checkmark-circle" size={20} color="#0A0A0A" />
                    <Text style={s.ctaTxt}>Save score</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 22,
    overflow: 'hidden',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnSpacer: { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, fontWeight: '600', marginTop: 4, letterSpacing: -0.1 },
  playerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
  },
  playerIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerName: { fontSize: 14, fontWeight: '700', letterSpacing: -0.15 },
  glassPanel: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.28,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 5 },
    }),
  },
  heroPanel: {
    paddingVertical: 26,
    paddingHorizontal: 20,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  stepBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
  },
  scoreDisplay: { alignItems: 'center', minWidth: 120 },
  scoreBig: {
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -3,
    lineHeight: 68,
    fontVariant: ['tabular-nums'],
  },
  parPill: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  parPillOn: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.45,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 4 },
    }),
  },
  parPillTxt: { fontSize: 12, fontWeight: '800', color: ACCENT, letterSpacing: 0.2 },
  parPillTxtOn: { color: '#0A0A0A' },
  section: { gap: 10 },
  sectionLbl: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingLeft: 4,
  },
  quickTrack: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 16,
  },
  quickList: {
    flexGrow: 0,
  },
  quickListContent: {
    paddingHorizontal: 16,
    paddingRight: 24,
  },
  quickChip: {
    width: QUICK_CHIP_W,
    height: 68,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 6,
  },
  quickChipInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  quickScore: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 24,
    textAlign: 'center',
  },
  quickPar: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -0.05,
    textAlign: 'center',
    lineHeight: 12,
  },
  ctaShell: {
    width: '100%',
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: ACCENT,
    overflow: 'hidden',
    marginTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.38,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 8 },
    }),
  },
  ctaPressable: {
    width: '100%',
    minHeight: 56,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    paddingHorizontal: 28,
    width: '100%',
  },
  ctaTxt: { fontSize: 17, fontWeight: '800', color: '#0A0A0A', letterSpacing: 0.15 },
});
