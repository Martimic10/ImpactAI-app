import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const ACCENT = '#34E06F';
const ACCENT_GLOW = 'rgba(52, 224, 111, 0.45)';
const ACCENT_SOFT = 'rgba(52, 224, 111, 0.14)';
const BG = '#0A0A0A';
const GLASS_BG = 'rgba(255, 255, 255, 0.06)';
const GLASS_BORDER = 'rgba(52, 224, 111, 0.22)';

type FeatureRow = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint?: string;
};

/** Curated highlights — best Pro value without clutter. */
const PRO_FEATURES: FeatureRow[] = [
  { icon: 'flag-outline', label: 'Unlimited golf games', hint: 'Formats, stakes & rematches' },
  { icon: 'people-outline', label: 'Team competitions', hint: 'Private games & groups' },
  { icon: 'chatbubble-ellipses-outline', label: 'Unlimited Coach AI chat', hint: 'Your caddie, anytime' },
  { icon: 'sparkles-outline', label: 'AI practice plans', hint: 'Built around your game' },
  { icon: 'flash-outline', label: 'Social challenges', hint: 'Head-to-head with friends' },
  { icon: 'trophy-outline', label: 'Full leaderboards', hint: 'Rankings, history & stats' },
  { icon: 'cloud-upload-outline', label: 'Unlimited swing uploads', hint: 'Replay & comparisons' },
];

const FREE_FEATURES: string[] = [
  'Basic golf games',
  'Limited Coach AI questions',
  'Basic leaderboards',
  'Upload swings',
  'Friend activity feed',
  'Join public games',
];

const PLANS = [
  {
    id: 'yearly',
    label: 'Yearly',
    sublabel: 'Billed annually · cancel anytime',
    price: '$59',
    priceSub: '/yr',
    badge: 'BEST VALUE',
  },
  {
    id: 'monthly',
    label: 'Monthly',
    sublabel: 'Cancel anytime',
    price: '$8',
    priceSub: '/mo',
    badge: null,
  },
] as const;

function GlassCard({
  children,
  style,
  glow,
}: {
  children: React.ReactNode;
  style?: object;
  glow?: boolean;
}) {
  return (
    <View
      style={[
        styles.glassCard,
        glow && styles.glassCardGlow,
        style,
      ]}
    >
      <View pointerEvents="none" style={styles.glassSheen} />
      {children}
    </View>
  );
}

function ProFeatureRow({ feature, index }: { feature: FeatureRow; index: number }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(80 + index * 45).duration(380).springify()}
      style={styles.proRow}
    >
      <View style={styles.proIconWrap}>
        <Ionicons name={feature.icon} size={18} color={ACCENT} />
      </View>
      <View style={styles.proCopy}>
        <Text style={styles.proLabel}>{feature.label}</Text>
        {feature.hint ? <Text style={styles.proHint}>{feature.hint}</Text> : null}
      </View>
      <Ionicons name="checkmark-circle" size={20} color={ACCENT} />
    </Animated.View>
  );
}

function GlowingCta({ onPress }: { onPress: () => void }) {
  const glow = useSharedValue(0.28);

  useEffect(() => {
    glow.value = withRepeat(
      withSequence(
        withTiming(0.72, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.28, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [glow]);

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: glow.value,
  }));

  return (
    <Animated.View style={[styles.ctaOuter, glowStyle]}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.ctaBtn}>
        <View pointerEvents="none" style={styles.ctaShine} />
        <Text style={styles.ctaText}>Unlock ImpactAI Pro</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
}

export function PaywallModal({ visible, onClose }: PaywallModalProps) {
  const [selected, setSelected] = useState<(typeof PLANS)[number]['id']>('yearly');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.ambientGlow} pointerEvents="none" />

          <View style={styles.closeBtnRow}>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
              <Ionicons name="close" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            bounces
          >
            <Animated.View entering={FadeIn.duration(400)} style={styles.hero}>
              <Image
                source={require('@/assets/ImpactAI-logo-removebg-preview.png')}
                style={styles.logo}
                resizeMode="contain"
              />
              <View style={styles.proBadge}>
                <Ionicons name="shield-checkmark" size={12} color={ACCENT} />
                <Text style={styles.proBadgeText}>PRO</Text>
              </View>
              <Text style={styles.title}>Own the course.{'\n'}Own your crew.</Text>
              <Text style={styles.subtitle}>
                Social games, AI coaching, and real progression — built for golfers who compete.
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(60).duration(420)}>
              <GlassCard glow>
                <Text style={styles.sectionLabel}>Everything in Pro</Text>
                {PRO_FEATURES.map((f, i) => (
                  <ProFeatureRow key={f.label} feature={f} index={i} />
                ))}
                <View style={styles.proFooter}>
                  <Ionicons name="ribbon-outline" size={14} color={ACCENT} />
                  <Text style={styles.proFooterText}>Exclusive Pro badge on your profile</Text>
                </View>
              </GlassCard>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.freeBlock}>
              <GlassCard>
                <Text style={styles.freeTitle}>Free plan includes</Text>
                <View style={styles.freeGrid}>
                  {FREE_FEATURES.map((label) => (
                    <View key={label} style={styles.freeChip}>
                      <View style={styles.freeDot} />
                      <Text style={styles.freeChipText}>{label}</Text>
                    </View>
                  ))}
                </View>
              </GlassCard>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(280).duration(400)} style={styles.ratingWrap}>
              <Text style={styles.ratingNum}>4.9</Text>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Ionicons key={i} name="star" size={16} color="#FF9F0A" />
                ))}
              </View>
              <Text style={styles.ratingCount}>Loved by competitive golfers</Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(340).duration(400)} style={styles.plans}>
              {PLANS.map((plan) => {
                const active = selected === plan.id;
                return (
                  <TouchableOpacity
                    key={plan.id}
                    onPress={() => setSelected(plan.id)}
                    activeOpacity={0.88}
                    style={[styles.planCard, active && styles.planCardActive]}
                  >
                    {plan.badge ? (
                      <View style={styles.planBadge}>
                        <Text style={styles.planBadgeText}>{plan.badge}</Text>
                      </View>
                    ) : null}
                    <View style={[styles.radioOuter, active && styles.radioOuterActive]}>
                      {active ? <View style={styles.radioInner} /> : null}
                    </View>
                    <View style={styles.planInfo}>
                      <Text style={styles.planLabel}>{plan.label}</Text>
                      <Text style={styles.planSublabel}>{plan.sublabel}</Text>
                    </View>
                    <Text style={styles.planPrice}>
                      {plan.price}
                      <Text style={styles.planPriceSub}>{plan.priceSub}</Text>
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </Animated.View>

            <GlowingCta onPress={onClose} />

            <View style={styles.footer}>
              {['Restore Purchases', 'Terms', 'Privacy'].map((item, i) => (
                <React.Fragment key={item}>
                  <TouchableOpacity>
                    <Text style={styles.footerLink}>{item}</Text>
                  </TouchableOpacity>
                  {i < 2 ? <Text style={styles.footerDot}>·</Text> : null}
                </React.Fragment>
              ))}
            </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  ambientGlow: {
    position: 'absolute',
    top: -80,
    left: '50%',
    marginLeft: -160,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: ACCENT_SOFT,
    opacity: 0.55,
  },

  closeBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    zIndex: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: GLASS_BG,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: {
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 36,
  },

  hero: { alignItems: 'center', marginBottom: 22 },
  logo: { width: 72, height: 72, marginBottom: 12 },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    marginBottom: 14,
  },
  proBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.6,
    lineHeight: 36,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.58)',
    textAlign: 'center',
    maxWidth: 320,
    fontWeight: '500',
  },

  glassCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: GLASS_BG,
    padding: 16,
    overflow: 'hidden',
    marginBottom: 14,
  },
  glassCardGlow: {
    shadowColor: ACCENT,
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  glassSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  proRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  proIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proCopy: { flex: 1, gap: 2 },
  proLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  proHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '500',
  },
  proFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 4,
  },
  proFooterText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },

  freeBlock: { marginBottom: 6 },
  freeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  freeGrid: { gap: 8 },
  freeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  freeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  freeChipText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
  },

  ratingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 18,
  },
  ratingNum: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  stars: { flexDirection: 'row', gap: 2 },
  ratingCount: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '500',
  },

  plans: { gap: 10, marginBottom: 18 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GLASS_BG,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    position: 'relative',
  },
  planCardActive: {
    borderColor: ACCENT,
    backgroundColor: ACCENT_SOFT,
  },
  planBadge: {
    position: 'absolute',
    top: -10,
    right: 14,
    backgroundColor: ACCENT,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  planBadgeText: {
    color: '#0A0A0A',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: { borderColor: ACCENT },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  planInfo: { flex: 1 },
  planLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  planSublabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  planPrice: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  planPriceSub: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
  },

  ctaOuter: {
    width: '100%',
    marginBottom: 20,
    borderRadius: 16,
    shadowColor: ACCENT,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  ctaBtn: {
    width: '100%',
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: ACCENT,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    overflow: 'hidden',
  },
  ctaShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  ctaText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0A0A0A',
    letterSpacing: -0.3,
    textAlign: 'center',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  footerLink: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },
  footerDot: {
    color: 'rgba(255,255,255,0.22)',
    fontSize: 13,
  },
});
