import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Dimensions,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VisualAnalysis, SwingPhase, FrameAnalysis } from '@/types';

const { width: SCREEN_W } = Dimensions.get('window');
const FRAME_W = SCREEN_W - 32;
const FRAME_H = FRAME_W * 1.2; // portrait ratio for golf swing

const PHASE_ICONS: Record<SwingPhase, string> = {
  setup:  'body',
  top:    'arrow-up-circle',
  impact: 'flash',
  finish: 'trophy',
};

const PHASES: SwingPhase[] = ['setup', 'top', 'impact', 'finish'];

interface Props {
  analysis: VisualAnalysis;
  visible: boolean;
  onClose: () => void;
}

function PhaseTab({
  phase,
  active,
  onPress,
}: {
  phase: SwingPhase;
  active: boolean;
  onPress: () => void;
}) {
  const frame = phase.charAt(0).toUpperCase() + phase.slice(1);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
      activeOpacity={0.8}
    >
      <Ionicons
        name={PHASE_ICONS[phase] as never}
        size={14}
        color={active ? '#FFFFFF' : '#666666'}
      />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {frame}
      </Text>
    </TouchableOpacity>
  );
}

function FrameView({ frame }: { frame: FrameAnalysis }) {
  const hasImage = !!frame.imageUrl;

  return (
    <View style={styles.frameContainer}>
      {/* Frame image */}
      <View style={styles.imageWrap}>
        {hasImage ? (
          <Image
            source={{ uri: frame.imageUrl }}
            style={styles.frameImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.imageFallback}>
            <Ionicons name="videocam-off" size={40} color="#333333" />
            <Text style={styles.fallbackText}>Frame unavailable</Text>
            <Text style={styles.fallbackSub}>
              Re-analyze your swing to generate frame snapshots
            </Text>
          </View>
        )}

        {/* Phase label overlay */}
        <View style={styles.phaseBadge}>
          <Ionicons name={PHASE_ICONS[frame.phase] as never} size={12} color="#4CAF50" />
          <Text style={styles.phaseBadgeText}>{frame.label}</Text>
        </View>
      </View>

      {/* Coaching note */}
      <View style={styles.coachingCard}>
        <View style={styles.coachingHeader}>
          <View style={styles.coachingIcon}>
            <Ionicons name="golf" size={14} color="#4CAF50" />
          </View>
          <Text style={styles.coachingTitle}>Coaching Note</Text>
        </View>
        <Text style={styles.coachingText}>{frame.coachingNote}</Text>
      </View>
    </View>
  );
}

export function VisualAnalysisViewer({ analysis, visible, onClose }: Props) {
  const [activePhase, setActivePhase] = useState<SwingPhase>('setup');
  const activeFrame = analysis[activePhase];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Visual Analysis</Text>
            <Text style={styles.headerSub}>4 key swing positions</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.8}>
            <Ionicons name="close" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Phase tabs */}
        <View style={styles.tabBar}>
          {PHASES.map((phase) => (
            <PhaseTab
              key={phase}
              phase={phase}
              active={activePhase === phase}
              onPress={() => setActivePhase(phase)}
            />
          ))}
        </View>

        {/* Frame content */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          <FrameView frame={activeFrame} />

          {/* All phases summary strip */}
          <View style={styles.strip}>
            {PHASES.map((phase) => {
              const f = analysis[phase];
              const isActive = phase === activePhase;
              return (
                <TouchableOpacity
                  key={phase}
                  onPress={() => setActivePhase(phase)}
                  style={[styles.stripCard, isActive && styles.stripCardActive]}
                  activeOpacity={0.8}
                >
                  {f.imageUrl ? (
                    <Image source={{ uri: f.imageUrl }} style={styles.stripImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.stripPlaceholder}>
                      <Ionicons name={PHASE_ICONS[phase] as never} size={16} color="#444" />
                    </View>
                  )}
                  {isActive && <View style={styles.stripActiveRing} />}
                  <Text style={[styles.stripLabel, isActive && { color: '#4CAF50' }]}>
                    {phase.charAt(0).toUpperCase() + phase.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  headerSub: { fontSize: 13, color: '#666666', marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabActive: { backgroundColor: '#2E7D32' },
  tabText: { fontSize: 11, fontWeight: '600', color: '#666666' },
  tabTextActive: { color: '#FFFFFF' },

  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  frameContainer: { gap: 14 },

  imageWrap: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  frameImage: { width: '100%', height: '100%' },
  imageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  fallbackText: { fontSize: 16, fontWeight: '700', color: '#555555', textAlign: 'center' },
  fallbackSub: { fontSize: 13, color: '#444444', textAlign: 'center', lineHeight: 18 },

  phaseBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.4)',
  },
  phaseBadgeText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },

  coachingCard: {
    backgroundColor: '#161616',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 16,
    gap: 10,
  },
  coachingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coachingIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1B2E1B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachingTitle: { fontSize: 13, fontWeight: '700', color: '#4CAF50', letterSpacing: 0.3 },
  coachingText: { fontSize: 15, color: '#D0D8E0', lineHeight: 22, fontWeight: '400' },

  strip: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  stripCard: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    opacity: 0.55,
  },
  stripCardActive: { opacity: 1 },
  stripImage: {
    width: '100%',
    aspectRatio: 0.85,
    borderRadius: 10,
  },
  stripPlaceholder: {
    width: '100%',
    aspectRatio: 0.85,
    borderRadius: 10,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  stripActiveRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 28,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  stripLabel: { fontSize: 10, fontWeight: '600', color: '#666666' },
});
