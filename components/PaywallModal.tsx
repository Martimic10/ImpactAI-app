import React, { useState } from 'react';
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

const BG = '#0B1A0B';
const CARD_BG = '#142514';
const GREEN = '#4CAF50';
const GREEN_DIM = '#1B3A1B';

const FEATURES = [
  'Unlimited swing analyses',
  'Personalized practice plans',
  'High-speed impact metrics',
  'Pro-level swing comparisons',
  'Long-term progress tracking',
];

const PLANS = [
  {
    id: 'lifetime',
    label: 'Lifetime',
    sublabel: 'One-time · never pay again',
    price: '$59',
    priceSub: '',
    badge: 'BEST VALUE',
  },
  {
    id: 'monthly',
    label: 'Monthly',
    sublabel: 'Billed monthly · cancel anytime',
    price: '$8',
    priceSub: '/mo',
    badge: null,
  },
];

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
}

export function PaywallModal({ visible, onClose }: PaywallModalProps) {
  const [selected, setSelected] = useState('lifetime');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Fixed close button — always accessible */}
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
          {/* Logo */}
          <Image
            source={require('@/assets/ImpactAI-logo-removebg-preview.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          {/* Title */}
          <Text style={styles.title}>Unlock ImpactAI Pro</Text>

          {/* Features */}
          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f} style={styles.featureRow}>
                <View style={styles.checkCircle}>
                  <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                </View>
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>

          {/* Rating */}
          <View style={styles.ratingWrap}>
            <Text style={styles.ratingNum}>4.9 stars</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Ionicons key={i} name="star" size={20} color="#FF9F0A" />
              ))}
            </View>
            <Text style={styles.ratingCount}>1,000+ reviews</Text>
          </View>

          {/* Plan cards */}
          <View style={styles.plans}>
            {PLANS.map((plan) => {
              const active = selected === plan.id;
              return (
                <TouchableOpacity
                  key={plan.id}
                  onPress={() => setSelected(plan.id)}
                  activeOpacity={0.85}
                  style={[styles.planCard, active && styles.planCardActive]}
                >
                  {plan.badge && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{plan.badge}</Text>
                    </View>
                  )}
                  <View style={styles.planRadio}>
                    <View style={[styles.radioOuter, active && styles.radioOuterActive]}>
                      {active && <View style={styles.radioInner} />}
                    </View>
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
          </View>

          {/* Continue */}
          <TouchableOpacity style={styles.continueBtn} onPress={onClose} activeOpacity={0.88}>
            <Text style={styles.continueBtnText}>Continue</Text>
          </TouchableOpacity>

          {/* Footer */}
          <View style={styles.footer}>
            {['Restore Purchases', 'Terms', 'Privacy'].map((item, i) => (
              <React.Fragment key={item}>
                <TouchableOpacity>
                  <Text style={styles.footerLink}>{item}</Text>
                </TouchableOpacity>
                {i < 2 && <Text style={styles.footerDot}>·</Text>}
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

  closeBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 32,
  },

  logo: {
    width: 96,
    height: 96,
    borderRadius: 24,
    marginBottom: 18,
  },

  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 28,
  },

  features: {
    width: '100%',
    gap: 14,
    marginBottom: 28,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GREEN_DIM,
    borderWidth: 1,
    borderColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  featureText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  ratingWrap: {
    alignItems: 'center',
    gap: 6,
    marginBottom: 28,
  },
  ratingNum: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stars: {
    flexDirection: 'row',
    gap: 3,
  },
  ratingCount: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },

  plans: {
    width: '100%',
    gap: 12,
    marginBottom: 20,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    position: 'relative',
    overflow: 'visible',
  },
  planCardActive: {
    borderColor: 'rgba(255,255,255,0.7)',
  },
  badge: {
    position: 'absolute',
    top: -12,
    right: 16,
    backgroundColor: '#7B3FE4',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  planRadio: {
    flexShrink: 0,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: '#FFFFFF',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  planInfo: { flex: 1 },
  planLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  planSublabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
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
    color: 'rgba(255,255,255,0.6)',
  },

  continueBtn: {
    width: '100%',
    backgroundColor: GREEN,
    borderRadius: 18,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  continueBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerLink: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '500',
  },
  footerDot: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 13,
  },
});
