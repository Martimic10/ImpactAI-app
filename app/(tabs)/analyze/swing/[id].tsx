import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAuth } from '@/hooks/useAuth';
import { useSwings } from '@/hooks/useSwings';
import { getSwingById } from '@/lib/swings';
import { supabase } from '@/lib/supabase';
import { Swing, getSwingScore, SwingPhase, VisualAnalysis } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';
import { generateVisualAnalysis, saveVisualAnalysis } from '@/lib/visualAnalysis';
import { SwingOverlay } from '@/components/SwingOverlay';

const { width: SW, height: SH } = Dimensions.get('window');

const VA_PHASES: SwingPhase[] = ['setup', 'top', 'impact', 'finish'];
const PHASE_LABEL: Record<SwingPhase, string> = {
  setup:  'Address',
  top:    'Top of Backswing',
  impact: 'Impact',
  finish: 'Follow-Through',
};

// ─────────────────────────────────────────────────────────────────────────────
// Fullscreen video viewer — video + key-frame overlay strip
// ─────────────────────────────────────────────────────────────────────────────
function FullscreenVideoViewer({
  url,
  visualAnalysis,
  visible,
  onClose,
}: {
  url: string;
  visualAnalysis?: VisualAnalysis;
  visible: boolean;
  onClose: () => void;
}) {
  const [playing, setPlaying] = useState(true);
  const [selectedPhase, setSelectedPhase] = useState<SwingPhase | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);

  const player = useVideoPlayer(url || null, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });

  function togglePlay() {
    if (!player) return;
    if (playing) { player.pause(); } else { player.play(); }
    setPlaying((v) => !v);
  }

  function selectFrame(phase: SwingPhase) {
    if (selectedPhase === phase) {
      setSelectedPhase(null);
      player.play();
      setPlaying(true);
    } else {
      setSelectedPhase(phase);
      player.pause();
      setPlaying(false);
    }
  }

  const activeFrame = selectedPhase ? visualAnalysis?.[selectedPhase] : null;
  const stripH = visualAnalysis ? 120 : 0;
  const videoH = SH - stripH - 100; // 100 = header + safe area

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={fs.container}>
        <StatusBar style="light" />

        {/* Top bar */}
        <View style={fs.topBar}>
          <TouchableOpacity onPress={onClose} style={fs.topBtn}>
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={fs.topTitle}>
            {selectedPhase ? PHASE_LABEL[selectedPhase] : 'Swing Video'}
          </Text>
          <TouchableOpacity onPress={togglePlay} style={fs.topBtn}>
            <Ionicons name={playing ? 'pause' : 'play'} size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Video + frame overlay */}
        <View style={[fs.videoArea, { height: videoH }]}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
          />

          {/* Frame snapshot overlaid on video */}
          {activeFrame && activeFrame.imageUrl ? (
            <View style={StyleSheet.absoluteFill}>
              <Image
                source={{ uri: activeFrame.imageUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
              />
              {/* Pose skeleton overlay */}
              {showOverlay && activeFrame.landmarks && (
                <SwingOverlay
                  landmarks={activeFrame.landmarks}
                  width={SW}
                  height={videoH}
                />
              )}
              {/* Phase badge */}
              <View style={fs.frameBadge}>
                <Ionicons name="camera" size={11} color="#4CAF50" />
                <Text style={fs.frameBadgeText}>{PHASE_LABEL[selectedPhase!]}</Text>
              </View>
              {/* Overlay toggle — only shown when landmarks are available */}
              {activeFrame.landmarks && (
                <TouchableOpacity
                  style={[fs.overlayToggle, showOverlay && fs.overlayToggleActive]}
                  onPress={() => setShowOverlay((v) => !v)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="body-outline" size={14} color={showOverlay ? '#0D0D0D' : '#FFFFFF'} />
                  <Text style={[fs.overlayToggleText, showOverlay && fs.overlayToggleTextActive]}>
                    {showOverlay ? 'Hide Pose' : 'Show Pose'}
                  </Text>
                </TouchableOpacity>
              )}
              {/* Coaching overlay at bottom */}
              <View style={fs.coachingOverlay}>
                <Text style={fs.coachingLabel}>Coaching note</Text>
                <Text style={fs.coachingText}>{activeFrame.coachingNote}</Text>
              </View>
            </View>
          ) : selectedPhase ? (
            // Phase selected but no image yet
            <View style={[StyleSheet.absoluteFill, fs.framePlaceholder]}>
              <Ionicons name="image-outline" size={40} color="#333" />
              <Text style={fs.framePlaceholderText}>Frame not available</Text>
            </View>
          ) : null}

          {/* Tap to play/pause hint when no frame selected */}
          {!selectedPhase && !playing && (
            <View style={fs.pausedOverlay} pointerEvents="none">
              <View style={fs.pausedCircle}>
                <Ionicons name="play" size={32} color="#FFFFFF" />
              </View>
            </View>
          )}

          {/* Tap video to toggle play (when no frame overlaid) */}
          {!selectedPhase && (
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              onPress={togglePlay}
              activeOpacity={1}
            />
          )}
        </View>

        {/* Key frames strip */}
        {visualAnalysis && (
          <View style={fs.strip}>
            <Text style={fs.stripHint}>Tap a frame to see coaching overlay</Text>
            <View style={fs.stripRow}>
              {VA_PHASES.map((phase) => {
                const frame = visualAnalysis[phase];
                const isActive = selectedPhase === phase;
                return (
                  <TouchableOpacity
                    key={phase}
                    onPress={() => selectFrame(phase)}
                    style={[fs.stripCard, isActive && fs.stripCardActive]}
                    activeOpacity={0.85}
                  >
                    {frame.imageUrl ? (
                      <Image
                        source={{ uri: frame.imageUrl }}
                        style={fs.stripImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={fs.stripPlaceholder}>
                        <Ionicons name="image-outline" size={18} color="#444" />
                      </View>
                    )}
                    {isActive && <View style={fs.stripActiveRing} />}
                    <Text style={[fs.stripLabel, isActive && { color: '#4CAF50' }]}>
                      {PHASE_LABEL[phase].split(' ')[0]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline video player (on results screen) — tap expand to go fullscreen
// ─────────────────────────────────────────────────────────────────────────────
function VideoPlayerInline({
  url,
  onBack,
  onExpand,
  hasVisualAnalysis,
  vaGenerating,
}: {
  url: string;
  onBack: () => void;
  onExpand: () => void;
  hasVisualAnalysis: boolean;
  vaGenerating: boolean;
}) {
  const [playing, setPlaying] = useState(true);
  const player = useVideoPlayer(url || null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  function toggle() {
    if (!player) return;
    if (playing) { player.pause(); } else { player.play(); }
    setPlaying((p) => !p);
  }

  return (
    <TouchableOpacity style={styles.videoWrap} onPress={toggle} activeOpacity={1}>
      <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />

      {/* Back button */}
      <TouchableOpacity onPress={onBack} style={styles.circleBtn} activeOpacity={0.85}>
        <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Expand button — top right */}
      <TouchableOpacity onPress={onExpand} style={styles.expandBtn} activeOpacity={0.85}>
        <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
        {vaGenerating && (
          <ActivityIndicator size="small" color="#4CAF50" style={{ position: 'absolute', top: -4, right: -4 }} />
        )}
        {hasVisualAnalysis && !vaGenerating && (
          <View style={styles.overlayDot} />
        )}
      </TouchableOpacity>

      {!playing && (
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={styles.playCircle}>
            <Ionicons name="play" size={26} color="#FFFFFF" />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
type FixItem = { title: string; detail: string; severity: 'low' | 'medium' | 'high' };

function formatDateFull(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function clampScore(n: number) { return Math.max(0, Math.min(100, n)); }

function scoreColor(score: number) {
  if (score >= 80) return '#B6FF2F';
  if (score >= 65) return '#FFD23A';
  return '#FF7B6D';
}

function metricFromScore(score: number, offset: number) { return clampScore(score + offset); }

type ScoreRow = { label: string; value: number; reason?: string };

function buildScoreRows(swing: Swing): ScoreRow[] {
  const s = swing.result_json.scores;
  const r = swing.result_json.scoreReasoning;
  if (s) {
    return [
      { label: 'Setup',      value: clampScore(s.setupScore),     reason: r?.setup },
      { label: 'Posture',    value: clampScore(s.postureScore),   reason: r?.posture },
      { label: 'Swing Path', value: clampScore(s.swingPathScore), reason: r?.swingPath },
      { label: 'Tempo',      value: clampScore(s.tempoScore),     reason: r?.tempo },
      { label: 'Balance',    value: clampScore(s.balanceScore),   reason: r?.balance },
      { label: 'Contact',    value: clampScore(s.contactScore),   reason: r?.contact },
    ];
  }
  const base = clampScore(getSwingScore(swing.result_json));
  return [
    { label: 'Posture',    value: metricFromScore(base, 4) },
    { label: 'Tempo',      value: metricFromScore(base, -2) },
    { label: 'Swing Path', value: metricFromScore(base, -10) },
    { label: 'Balance',    value: metricFromScore(base, -5) },
    { label: 'Contact',    value: metricFromScore(base, 1) },
    { label: 'Club Path',  value: metricFromScore(base, -8) },
  ];
}

function buildFixes(swing: Swing): FixItem[] {
  const fixes = swing.result_json.fixes ?? [];
  return fixes.slice(0, 3).map((item, i) => ({
    title: i === 0 ? swing.result_json.primaryIssue : `Fix ${i + 1}`,
    detail: item,
    severity: (i === 0 ? 'high' : i === 1 ? 'medium' : 'low') as FixItem['severity'],
  }));
}

function buildDrills(swing: Swing) {
  const d = swing.result_json.drill;
  if (!d) return [];
  return [{
    title: d.name,
    detail: `${d.whyThisDrill}\n\n${d.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    minutes: 10,
  }];
}

function SeverityPill({ severity }: { severity: FixItem['severity'] }) {
  const label = severity.toUpperCase();
  const color = severity === 'high' ? '#FF453A' : severity === 'medium' ? '#FF9F0A' : '#FFD60A';
  return (
    <View style={[styles.severityPill, { borderColor: color + 'AA' }]}>
      <Text style={[styles.severityText, { color }]}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
export default function SwingDetailScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const goBack = () => {
    if (from === 'analysis') {
      router.dismissAll();
    } else {
      router.back();
    }
  };
  const { user } = useAuth();
  const { swings } = useSwings(user?.id);
  const [directSwing, setDirectSwing] = useState<Swing | null>(null);
  const [fetching, setFetching] = useState(false);
  const [overlayMode, setOverlayMode] = useState<'original' | 'overlay'>('original');
  const [liveSwing, setLiveSwing] = useState<Swing | null>(null);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [vaGenerating, setVaGenerating] = useState(false);

  const cached = swings.find((s) => s.id === id);
  const swing = liveSwing ?? cached ?? directSwing;

  useEffect(() => {
    if (!cached && id && !fetching) {
      setFetching(true);
      getSwingById(id).then((s) => { setDirectSwing(s); setFetching(false); });
    }
  }, [cached, id]);

  // Auto-generate visual analysis for ANY swing that is missing it
  useEffect(() => {
    if (!swing?.id || !user?.id) return;          // wait for both to load
    if (swing.visual_analysis) return;             // already have it
    if (!swing.video_url) return;                  // nothing to extract from
    if (vaGenerating) return;                      // already in progress

    console.log('[VA] starting generation for swing', swing.id, 'video:', swing.video_url.slice(0, 60));
    setVaGenerating(true);

    generateVisualAnalysis(swing.video_url, user.id, swing.id, swing.result_json)
      .then((va) => {
        console.log('[VA] generation result:', va ? 'SUCCESS' : 'NULL — check logs above');
        if (va) {
          saveVisualAnalysis(swing.id, va);
          setLiveSwing((prev) => prev
            ? { ...prev, visual_analysis: va }
            : { ...(swing as Swing), visual_analysis: va });
        }
      })
      .catch((e) => console.error('[VA] generation threw:', e))
      .finally(() => setVaGenerating(false));
  }, [swing?.id, user?.id]);    // re-runs if either becomes available late

  // Poll for overlay completion
  useEffect(() => {
    if (!id || !swing || swing.overlay_status !== 'processing') return;
    const interval = setInterval(async () => {
      const { data } = await supabase.from('swings').select('overlay_status, overlay_video_url').eq('id', id).single();
      if (data?.overlay_status !== 'processing') {
        setLiveSwing((prev) => prev ? { ...prev, ...data } : { ...(swing as Swing), ...data });
        clearInterval(interval);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [id, swing?.overlay_status]);

  if (!swing) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorState}>
          {fetching
            ? <ActivityIndicator color="#4CAF50" />
            : <>
                <Text style={styles.errorTitle}>Swing not found</Text>
                <TouchableOpacity onPress={() => router.back()} style={styles.errorBtn}>
                  <Text style={styles.errorBtnText}>Go back</Text>
                </TouchableOpacity>
              </>
          }
        </View>
      </SafeAreaView>
    );
  }

  const score = clampScore(getSwingScore(swing.result_json));
  const scoreRows = buildScoreRows(swing);
  const fixes = buildFixes(swing);
  const drills = buildDrills(swing);
  const ringColor = scoreColor(score);
  const activeVideoUrl = overlayMode === 'overlay' && swing.overlay_video_url
    ? swing.overlay_video_url : swing.video_url;
  const hasVideo = !!swing.video_url;
  const hasOverlay = swing.overlay_status === 'completed' && !!swing.overlay_video_url;
  const overlayProcessing = swing.overlay_status === 'processing';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Video */}
        <View style={styles.hero}>
          {hasVideo ? (
            <VideoPlayerInline
              url={activeVideoUrl}
              onBack={goBack}
              onExpand={() => setShowFullscreen(true)}
              hasVisualAnalysis={!!swing.visual_analysis}
              vaGenerating={vaGenerating}
            />
          ) : (
            <>
              <View style={styles.heroShade} />
              <TouchableOpacity onPress={goBack} style={styles.circleBtn} activeOpacity={0.85}>
                <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Overlay toggle */}
        {(hasOverlay || overlayProcessing) && (
          <View style={styles.toggleRow}>
            <TouchableOpacity
              onPress={() => setOverlayMode('original')}
              style={[styles.toggleBtn, overlayMode === 'original' && styles.toggleBtnActive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.toggleText, overlayMode === 'original' && styles.toggleTextActive]}>Original</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => hasOverlay && setOverlayMode('overlay')}
              style={[styles.toggleBtn, overlayMode === 'overlay' && styles.toggleBtnActive, !hasOverlay && styles.toggleBtnDisabled]}
              activeOpacity={hasOverlay ? 0.8 : 1}
            >
              {overlayProcessing && overlayMode !== 'overlay' && (
                <ActivityIndicator size="small" color="#8E8E93" style={{ marginRight: 6 }} />
              )}
              <Text style={[styles.toggleText, overlayMode === 'overlay' && styles.toggleTextActive, !hasOverlay && styles.toggleTextDisabled]}>
                {overlayProcessing ? 'Processing…' : 'Pose Overlay'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Meta */}
        <View style={styles.heroMeta}>
          <Text style={styles.kicker}>SWING ANALYSIS</Text>
          <Text style={styles.heroTitle}>{swing.result_json.primaryIssue}</Text>
          <Text style={styles.heroDate}>{formatDateFull(swing.created_at)}</Text>
        </View>

        {/* Score summary */}
        <View style={styles.summaryCard}>
          <View style={[styles.scoreRing, { borderColor: ringColor }]}>
            <Text style={styles.scoreNumber}>{score}</Text>
            <Text style={styles.scoreLabel}>SCORE</Text>
          </View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryKicker}>AI SUMMARY</Text>
            <Text style={styles.summaryBody} numberOfLines={4}>{swing.result_json.summary}</Text>
            {swing.result_json.scores?.tempoScore != null && (
              <Text style={styles.tempoLine}>◷ Tempo · {swing.result_json.scores.tempoScore}/100</Text>
            )}
          </View>
        </View>

        {/* Scores */}
        <Text style={styles.sectionTitle}>Scores</Text>
        <View style={styles.panel}>
          {scoreRows.map((row: ScoreRow, i: number) => {
            const barColor = row.value >= 80 ? '#4CAF50' : row.value >= 60 ? '#FFD23A' : '#FF453A';
            return (
              <View key={row.label} style={[styles.scoreRowItem, i < scoreRows.length - 1 && styles.rowDivider]}>
                <View style={styles.scoreRowTop}>
                  <Text style={styles.scoreRowLabel}>{row.label}</Text>
                  <Text style={[styles.scoreRowValue, { color: barColor }]}>{row.value}</Text>
                </View>
                <View style={styles.scoreBarTrack}>
                  <View style={[styles.scoreBarFill, { width: `${row.value}%`, backgroundColor: barColor }]} />
                </View>
                {row.reason && <Text style={styles.scoreRowReason}>{row.reason}</Text>}
              </View>
            );
          })}
        </View>

        {/* Key checkpoints */}
        {swing.result_json.keyCheckpoints && swing.result_json.keyCheckpoints.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Key Checkpoints</Text>
            <View style={styles.panel}>
              {swing.result_json.keyCheckpoints.map((s: string, i: number) => (
                <View key={i} style={[styles.rowItem, i < swing.result_json.keyCheckpoints!.length - 1 && styles.rowDivider]}>
                  <View style={styles.leadingIconGood}>
                    <Ionicons name="checkmark" size={12} color="#B6FF2F" />
                  </View>
                  <Text style={styles.rowTextStrong}>{s}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Evidence */}
        {swing.result_json.evidence && swing.result_json.evidence.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>What the AI Observed</Text>
            <View style={styles.panel}>
              {swing.result_json.evidence.map((e: string, i: number) => (
                <View key={i} style={[styles.rowItem, i < swing.result_json.evidence!.length - 1 && styles.rowDivider]}>
                  <View style={styles.leadingIconEvidence}>
                    <Ionicons name="eye-outline" size={12} color="#8E8E93" />
                  </View>
                  <Text style={[styles.rowTextStrong, { color: '#C0CDD6', fontWeight: '500' }]}>{e}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Fixes */}
        <Text style={styles.sectionTitle}>What to fix</Text>
        <View style={styles.stack}>
          {fixes.map((f) => (
            <View key={f.title} style={styles.panel}>
              <View style={styles.fixHeader}>
                <View style={styles.fixTitleWrap}>
                  <View style={styles.leadingIconWarn}>
                    <Ionicons name="alert-circle-outline" size={13} color="#FF9F0A" />
                  </View>
                  <Text style={styles.fixTitle}>{f.title}</Text>
                </View>
                <SeverityPill severity={f.severity} />
              </View>
              <Text style={styles.fixDetail}>{f.detail}</Text>
            </View>
          ))}
        </View>

        {/* Drills */}
        <Text style={styles.sectionTitle}>Recommended drills</Text>
        <View style={styles.stack}>
          {drills.map((d) => (
            <View key={d.title} style={styles.panel}>
              <View style={styles.fixHeader}>
                <View style={styles.fixTitleWrap}>
                  <View style={styles.leadingIconGood}>
                    <Ionicons name="golf-outline" size={12} color="#B6FF2F" />
                  </View>
                  <Text style={styles.fixTitle}>{d.title}</Text>
                </View>
                <View style={styles.timePill}>
                  <Ionicons name="time-outline" size={11} color="#9AA0A6" />
                  <Text style={styles.timeText}>{d.minutes} min</Text>
                </View>
              </View>
              <Text style={styles.fixDetail}>{d.detail}</Text>
            </View>
          ))}
        </View>

        {/* Compare */}
        <View style={[styles.panel, styles.compareCard]}>
          <View style={styles.compareCardLeft}>
            <View style={styles.leadingIconGood}>
              <Ionicons name="trophy-outline" size={12} color="#B6FF2F" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.compareTitle}>Keep the momentum</Text>
              <Text style={styles.compareSub}>Compare this swing to another to track your progress.</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.compareBtn}
            onPress={() => router.push({ pathname: '/(tabs)/compare', params: { swingId: id } })}
            activeOpacity={0.85}
          >
            <Ionicons name="trending-up" size={12} color="#0D0D0D" />
            <Text style={styles.compareBtnText}>Compare</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Fullscreen video + frame overlay viewer */}
      {hasVideo && (
        <FullscreenVideoViewer
          url={activeVideoUrl}
          visualAnalysis={swing.visual_analysis}
          visible={showFullscreen}
          onClose={() => setShowFullscreen(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#06090B' },
  scrollContent: { paddingBottom: 110 },
  hero: {
    height: 440,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 28,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
  },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: '#111111', opacity: 0.7 },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', zIndex: 2 },
  circleBtn: {
    position: 'absolute', top: 12, left: 12, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(8,12,14,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  expandBtn: {
    position: 'absolute', top: 12, right: 12, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(8,12,14,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  overlayDot: {
    position: 'absolute', top: 8, right: 8,
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#4CAF50',
  },
  kicker: { color: '#B6FF2F', fontSize: 12, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  heroDate: { color: '#A8B2BA', fontSize: 13, marginTop: 4 },
  summaryCard: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 22,
    borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
    padding: 14, flexDirection: 'row', gap: 14, alignItems: 'center',
  },
  scoreRing: {
    width: 108, height: 108, borderRadius: 54, borderWidth: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#141414',
  },
  scoreNumber: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', lineHeight: 34 },
  scoreLabel: { color: '#8A98A3', fontSize: 12, letterSpacing: 1, fontWeight: '700' },
  summaryCopy: { flex: 1, gap: 6 },
  summaryKicker: { color: '#B6FF2F', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  summaryBody: { color: '#EEF4FA', fontSize: 13, lineHeight: 19, fontWeight: '500' },
  tempoLine: { color: '#A8B2BA', fontSize: 14, marginTop: 2 },
  sectionTitle: {
    color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: -0.3,
    marginHorizontal: 16, marginTop: 20, marginBottom: 10,
  },
  scoreRowItem: { paddingVertical: 12, gap: 6 },
  scoreRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreRowLabel: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  scoreRowValue: { fontSize: 16, fontWeight: '800' },
  scoreBarTrack: { height: 5, backgroundColor: '#2A2A2A', borderRadius: 3, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 3 },
  scoreRowReason: { fontSize: 12, color: '#8A98A3', lineHeight: 17, marginTop: 2 },
  panel: {
    marginHorizontal: 16, borderRadius: 20, borderWidth: 1,
    borderColor: '#2A2A2A', backgroundColor: '#1A1A1A', padding: 14,
  },
  rowItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A2A2A',
    marginBottom: 6, paddingBottom: 12,
  },
  leadingIconGood: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#253718',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  leadingIconEvidence: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#252525',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  leadingIconWarn: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#3C2A17',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTextStrong: { flex: 1, color: '#EAF2F6', fontSize: 14, fontWeight: '600', lineHeight: 21 },
  stack: { gap: 10 },
  fixHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  fixTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  fixTitle: { color: '#F4F7FA', fontSize: 15, fontWeight: '700', lineHeight: 20, flexShrink: 1 },
  fixDetail: { color: '#9DA8B0', fontSize: 13, lineHeight: 19, fontWeight: '400' },
  severityPill: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#1A1A1A' },
  severityText: { fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  timePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4,
  },
  timeText: { color: '#9AA0A6', fontSize: 12, fontWeight: '700' },
  compareCard: { marginTop: 14, flexDirection: 'column', gap: 12 },
  compareCardLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  compareTitle: { color: '#F4F7FA', fontSize: 15, fontWeight: '700' },
  compareSub: { color: '#98A4AD', fontSize: 12, marginTop: 2, maxWidth: 200 },
  compareBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
  },
  compareBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  errorBtn: { backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', paddingHorizontal: 14, paddingVertical: 10 },
  errorBtnText: { color: '#B6FF2F', fontWeight: '700' },
  videoWrap: { width: '100%', height: '100%' },
  video: { width: '100%', height: '100%' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playCircle: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 10,
    backgroundColor: '#1A1A1A', borderRadius: 14, padding: 3,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  toggleBtnActive: { backgroundColor: '#2E7D32' },
  toggleBtnDisabled: { opacity: 0.5 },
  toggleText: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  toggleTextActive: { color: '#FFFFFF' },
  toggleTextDisabled: { color: '#555' },
  heroMeta: { marginHorizontal: 16, marginTop: 14, marginBottom: 4 },

  // Unused legacy styles kept so existing layout isn't broken
  heroTextWrap: { zIndex: 2 },
  playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#B6FF2F', alignItems: 'center', justifyContent: 'center' },
  metricsGrid: { marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '48.6%', backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 18, padding: 14, gap: 8 },
  metricLabel: { color: '#A8B2BA', fontSize: 13, letterSpacing: 1.2 },
  metricValue: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  metricBarTrack: { height: 5, borderRadius: 3, backgroundColor: '#2A2A2A', overflow: 'hidden' },
  metricBarFill: { height: '100%', borderRadius: 3 },
  metricTarget: { color: '#647381', fontSize: 13, marginTop: 2 },
  playOverlay2: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  activeDot: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(76,175,80,0.2)', alignItems: 'center', justifyContent: 'center' },
  activeDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Fullscreen styles
// ─────────────────────────────────────────────────────────────────────────────
const fs = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  topTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', flex: 1, textAlign: 'center' },
  topBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  videoArea: { width: SW, backgroundColor: '#000' },
  frameBadge: {
    position: 'absolute', top: 14, left: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(76,175,80,0.5)',
  },
  frameBadgeText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  coachingOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 18, paddingVertical: 14,
    gap: 4,
  },
  coachingLabel: { fontSize: 10, fontWeight: '700', color: '#4CAF50', letterSpacing: 1, textTransform: 'uppercase' },
  coachingText: { fontSize: 14, color: '#FFFFFF', lineHeight: 20 },
  framePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D0D0D', gap: 10 },
  framePlaceholderText: { fontSize: 14, color: '#444', textAlign: 'center' },
  pausedOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pausedCircle: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  strip: {
    flex: 1, backgroundColor: '#0D0D0D',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 10,
  },
  stripHint: { fontSize: 11, color: '#555', textAlign: 'center' },
  stripRow: { flexDirection: 'row', gap: 10 },
  stripCard: { flex: 1, alignItems: 'center', gap: 6, opacity: 0.55 },
  stripCardActive: { opacity: 1 },
  stripImage: { width: '100%', aspectRatio: 0.75, borderRadius: 10 },
  stripPlaceholder: {
    width: '100%', aspectRatio: 0.75, borderRadius: 10,
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  stripActiveRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 22, borderRadius: 10, borderWidth: 2, borderColor: '#4CAF50' },
  stripLabel: { fontSize: 10, fontWeight: '600', color: '#666' },
  overlayToggle: {
    position: 'absolute', top: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  overlayToggleActive: {
    backgroundColor: '#B6FF2F',
    borderColor: '#B6FF2F',
  },
  overlayToggleText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  overlayToggleTextActive: { color: '#0D0D0D' },
});
