import React, { useEffect, useRef, useState } from 'react';
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
import { generateVisualAnalysis, saveVisualAnalysis, VISUAL_ANALYSIS_VERSION } from '@/lib/visualAnalysis';
import { SwingOverlay } from '@/components/SwingOverlay';

const { width: SW, height: SH } = Dimensions.get('window');

const PHASE_LABEL: Record<SwingPhase, string> = {
  setup:  'Address',
  top:    'Top of Backswing',
  impact: 'Impact',
  finish: 'Follow-Through',
};

const CHAPTERS: { phase: SwingPhase; fallbackMs: number; ratio: number }[] = [
  { phase: 'setup',  fallbackMs: 200,  ratio: 0.04 },  // always near start
  { phase: 'top',    fallbackMs: 1400, ratio: 0.42 },
  { phase: 'impact', fallbackMs: 2200, ratio: 0.65 },
  { phase: 'finish', fallbackMs: 3200, ratio: 0.88 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fullscreen guided viewer — auto-pauses at key swing moments
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
  const [activePhase, setActivePhase]         = useState<SwingPhase | null>(null);
  const [donePhases, setDonePhases]           = useState<Set<SwingPhase>>(new Set());
  const [isPlaying, setIsPlaying]             = useState(false);
  const [showPose, setShowPose]               = useState(true);
  const [frameAspect, setFrameAspect]         = useState(9 / 16);
  const [playbackRate, setPlaybackRate]       = useState(0.35);

  const passedRef    = useRef<Set<SwingPhase>>(new Set());
  const intervalRef  = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const resumeTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const player = useVideoPlayer(url || null, (p) => {
    p.loop = false;
    p.muted = false;
    p.playbackRate = 0.35;
    p.pause();
  });

  // Keep player rate in sync with state
  useEffect(() => {
    player.playbackRate = playbackRate;
  }, [playbackRate]);

  function resetChapters() {
    passedRef.current = new Set();
    setActivePhase(null);
    setDonePhases(new Set());
    setShowPose(true);
  }

  function isAtEnd() {
    const duration = Number(player.duration);
    return Number.isFinite(duration) && duration > 0 && player.currentTime >= duration - 0.08;
  }

  function playFromStart() {
    resetChapters();
    player.currentTime = 0;
    player.play();
    setIsPlaying(true);
  }

  // Auto-play from start when modal opens
  useEffect(() => {
    if (!visible) return;
    playFromStart();

    // Poll video time every 100ms — pause at each chapter
    intervalRef.current = setInterval(() => {
      if (!player) return;
      const timeMs = player.currentTime * 1000;
      if (isAtEnd()) {
        setIsPlaying(false);
        return;
      }
      const durationMs = Number.isFinite(player.duration) && player.duration > 0
        ? player.duration * 1000
        : null;
      for (const { phase, fallbackMs, ratio } of CHAPTERS) {
        const detectedMark = visualAnalysis?.[phase]?.timeMs;
        // For Address: never pause later than 10% into video — it's always a static setup position
        const maxSetupMs = durationMs ? durationMs * 0.10 : 500;
        let mark = typeof detectedMark === 'number'
          ? detectedMark
          : durationMs ? Math.max(0, Math.min(durationMs - 80, durationMs * ratio)) : fallbackMs;
        if (phase === 'setup') mark = Math.min(mark, maxSetupMs);
        if (!passedRef.current.has(phase) && timeMs >= mark) {
          passedRef.current.add(phase);
          player.pause();
          setIsPlaying(false);
          setActivePhase(phase);
          setShowPose(true);
          setDonePhases(new Set(passedRef.current));
          break;
        }
      }
    }, 100);

    return () => {
      clearInterval(intervalRef.current);
      clearTimeout(resumeTimer.current);
    };
  }, [visible]);

  function resume() {
    clearTimeout(resumeTimer.current);
    setActivePhase(null);
    setShowPose(true);

    if (isAtEnd()) {
      playFromStart();
      return;
    }

    // Play from exactly where the video paused — no seek needed.
    // passedRef already marks this chapter as done so the interval won't re-fire.
    player.play();
    setIsPlaying(true);
  }

  function handleClose() {
    clearInterval(intervalRef.current);
    clearTimeout(resumeTimer.current);
    player.pause();
    onClose();
  }

  function togglePlayPause() {
    if (isPlaying) { player.pause(); setIsPlaying(false); }
    else if (isAtEnd()) { playFromStart(); }
    else           { player.play();  setIsPlaying(true);  }
  }

  const activeFrame = activePhase ? visualAnalysis?.[activePhase] : null;
  const videoH = SH * 0.56;
  const frameW = Math.min(SW, videoH * frameAspect);
  const frameH = frameW / frameAspect;
  const frameLeft = (SW - frameW) / 2;
  const frameTop = (videoH - frameH) / 2;

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={fs.container}>
        <StatusBar style="light" />

        {/* ── Header ── */}
        <View style={fs.topBar}>
          <TouchableOpacity onPress={handleClose} style={fs.topBtn}>
            <Ionicons name="close" size={20} color="#FFF" />
          </TouchableOpacity>

          {/* Chapter progress dots */}
          <View style={fs.dots}>
            {CHAPTERS.map(({ phase }) => (
              <View
                key={phase}
                style={[
                  fs.dot,
                  donePhases.has(phase) && fs.dotDone,
                  activePhase === phase && fs.dotActive,
                ]}
              />
            ))}
          </View>

          <TouchableOpacity onPress={activePhase ? resume : togglePlayPause} style={fs.topBtn}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* ── Video area ── */}
        <View style={[fs.videoArea, { height: videoH }]}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
          />

          {/* Frame snapshot + pose overlay when paused at a chapter */}
          {activeFrame?.imageUrl ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Image
                source={{ uri: activeFrame.imageUrl, cache: 'reload' }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                onLoad={(event) => {
                  const { width, height } = event.nativeEvent.source;
                  if (width > 0 && height > 0) setFrameAspect(width / height);
                }}
              />
              {showPose && activeFrame.overlayImageUrl && (
                <Image
                  source={{ uri: activeFrame.overlayImageUrl, cache: 'reload' }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                />
              )}
              {showPose && activeFrame.landmarks && activeFrame.landmarks.length >= 25 && (
                <View
                  style={[
                    fs.poseOverlayFrame,
                    { left: frameLeft, top: frameTop, width: frameW, height: frameH },
                  ]}
                >
                  <SwingOverlay
                    landmarks={activeFrame.landmarks}
                    width={frameW}
                    height={frameH}
                  />
                </View>
              )}
            </View>
          ) : null}

          {/* Phase label badge */}
          {activePhase && (
            <View style={fs.phaseBadge}>
              <View style={fs.phaseDot} />
              <Text style={fs.phaseBadgeText}>{PHASE_LABEL[activePhase]}</Text>
            </View>
          )}

          {/* Tap video to pause/play when no chapter is active */}
          {!activePhase && (
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={togglePlayPause} activeOpacity={1}>
              {!isPlaying && (
                <View style={fs.pausedOverlay} pointerEvents="none">
                  <View style={fs.pausedCircle}>
                    <Ionicons name="play" size={32} color="#FFF" />
                  </View>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* ── Coaching card (shown when paused at a chapter) ── */}
        {activePhase ? (
          <View style={fs.coachCard}>
            <View style={fs.coachTop}>
              <View style={fs.coachIconWrap}>
                <Ionicons name="golf" size={15} color="#4CAF50" />
              </View>
              <Text style={fs.coachPhaseLabel}>{PHASE_LABEL[activePhase]}</Text>
              {(activeFrame?.overlayImageUrl || (activeFrame?.landmarks && activeFrame.landmarks.length >= 25)) && (
                <TouchableOpacity
                  onPress={() => setShowPose((v) => !v)}
                  style={[fs.poseBtn, showPose && fs.poseBtnActive]}
                >
                  <Ionicons name="body-outline" size={13} color={showPose ? '#0D0D0D' : '#FFF'} />
                  <Text style={[fs.poseBtnText, showPose && fs.poseBtnTextActive]}>
                    {showPose ? 'Hide Pose' : 'Pose'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={fs.coachNote}>{activeFrame?.coachingNote ?? ''}</Text>
            <TouchableOpacity onPress={() => resume()} style={fs.resumeBtn} activeOpacity={0.85}>
              <Ionicons name="play" size={14} color="#0D0D0D" />
              <Text style={fs.resumeText}>Continue</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={fs.idleCard}>
            <Text style={fs.idleText}>
              {isPlaying ? '⛳  Pausing at key moments…' : 'Tap ▶ to start'}
            </Text>
            <View style={fs.speedRow}>
              {([0.25, 0.5, 0.75, 1.0] as const).map((rate) => (
                <TouchableOpacity
                  key={rate}
                  onPress={() => setPlaybackRate(rate)}
                  style={[fs.speedBtn, playbackRate === rate && fs.speedBtnActive]}
                  activeOpacity={0.8}
                >
                  <Text style={[fs.speedText, playbackRate === rate && fs.speedTextActive]}>
                    {rate === 1.0 ? '1×' : `${rate}×`}
                  </Text>
                </TouchableOpacity>
              ))}
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
  onRegenerate,
  hasVisualAnalysis,
  vaGenerating,
}: {
  url: string;
  onBack: () => void;
  onExpand: () => void;
  onRegenerate: () => void;
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

      {/* Expand / Overlay button — top right */}
      <TouchableOpacity onPress={onExpand} style={[styles.expandBtn, vaGenerating && styles.expandBtnGenerating]} activeOpacity={0.85}>
        {vaGenerating ? (
          <>
            <ActivityIndicator size="small" color="#4CAF50" />
            <Text style={styles.expandBtnGeneratingText}>Generating…</Text>
          </>
        ) : (
          <>
            <Ionicons name={hasVisualAnalysis ? 'body-outline' : 'expand-outline'} size={15} color="#FFFFFF" />
            {hasVisualAnalysis && <Text style={styles.expandBtnText}>Overlay</Text>}
          </>
        )}
      </TouchableOpacity>

      {/* Regenerate button — bottom right, only when overlay exists */}
      {hasVisualAnalysis && !vaGenerating && (
        <TouchableOpacity onPress={onRegenerate} style={styles.regenBtn} activeOpacity={0.8}>
          <Ionicons name="refresh-outline" size={12} color="#8E8E93" />
          <Text style={styles.regenBtnText}>Regenerate</Text>
        </TouchableOpacity>
      )}

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
    if (!swing?.id || !user?.id) return;
    if (swing.visual_analysis && (swing.analysis_version ?? 0) >= VISUAL_ANALYSIS_VERSION) return;
    if (!swing.video_url) return;
    if (vaGenerating) return;
    runVisualAnalysis(swing);
  }, [swing?.id, user?.id]);

  function runVisualAnalysis(target: Swing) {
    if (!user?.id || vaGenerating) return;
    console.log('[VA] starting generation for swing', target.id, 'video:', target.video_url.slice(0, 60));
    setVaGenerating(true);
    generateVisualAnalysis(target.video_url, user.id, target.id, target.result_json)
      .then((va) => {
        console.log('[VA] generation result:', va ? 'SUCCESS' : 'NULL — check logs above');
        if (va) {
          saveVisualAnalysis(target.id, va);
          setLiveSwing((prev) => prev
            ? { ...prev, visual_analysis: va, analysis_version: VISUAL_ANALYSIS_VERSION }
            : { ...(target as Swing), visual_analysis: va, analysis_version: VISUAL_ANALYSIS_VERSION });
        }
      })
      .catch((e) => console.error('[VA] generation threw:', e))
      .finally(() => setVaGenerating(false));
  }

  function regenerateVisualAnalysis() {
    if (!swing || vaGenerating) return;
    // Clear local visual_analysis so the viewer shows fresh data
    const cleared = { ...(swing as Swing), visual_analysis: undefined as unknown as typeof swing.visual_analysis };
    setLiveSwing(cleared);
    runVisualAnalysis(cleared);
  }

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
              onRegenerate={regenerateVisualAnalysis}
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
    minWidth: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(8,12,14,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
  },
  expandBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  expandBtnGenerating: { width: 'auto', paddingHorizontal: 10, gap: 6, flexDirection: 'row', alignItems: 'center' },
  expandBtnGeneratingText: { color: '#4CAF50', fontSize: 11, fontWeight: '700' },
  regenBtn: {
    position: 'absolute', bottom: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(8,12,14,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5,
  },
  regenBtnText: { color: '#8E8E93', fontSize: 11, fontWeight: '600' },
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
  container:  { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  topBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  // chapter progress dots
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotDone: { backgroundColor: '#4CAF50' },
  dotActive: { backgroundColor: '#B6FF2F', width: 20, borderRadius: 4 },
  // video
  videoArea: { width: SW, backgroundColor: '#000' },
  poseOverlayFrame: { position: 'absolute', zIndex: 4, elevation: 4 },
  phaseBadge: {
    position: 'absolute', top: 14, left: 14,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(76,175,80,0.4)',
  },
  phaseDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' },
  phaseBadgeText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  // paused hint
  pausedOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pausedCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  // coaching card
  coachCard: {
    flex: 1, backgroundColor: '#0D0D0D',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 30, gap: 12,
  },
  coachTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coachIconWrap: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#1B2E1B', alignItems: 'center', justifyContent: 'center',
  },
  coachPhaseLabel: { flex: 1, fontSize: 16, fontWeight: '800', color: '#FFF', letterSpacing: -0.3 },
  poseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  poseBtnActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  poseBtnText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
  poseBtnTextActive: { color: '#0D0D0D' },
  coachNote: { fontSize: 14, color: '#C8D6E0', lineHeight: 21, fontWeight: '400', flex: 1 },
  resumeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: '#4CAF50', borderRadius: 16,
    paddingVertical: 13, marginTop: 4,
  },
  resumeText: { fontSize: 15, fontWeight: '800', color: '#0D0D0D' },
  // idle card (video playing, no chapter active)
  idleCard: {
    flex: 1, backgroundColor: '#0D0D0D',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  idleText: { fontSize: 13, color: '#555', textAlign: 'center' },
  speedRow: { flexDirection: 'row', gap: 8 },
  speedBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
  },
  speedBtnActive: { backgroundColor: '#2E7D32', borderColor: '#4CAF50' },
  speedText: { fontSize: 13, fontWeight: '700', color: '#666' },
  speedTextActive: { color: '#FFFFFF' },
});
