import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Share, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VideoPlayer } from '@/components/analyze/VideoPlayer';
import { ImpactSnapshot } from '@/components/analyze/ImpactSnapshot';
import { AIAnalysisCard } from '@/components/analyze/AIAnalysisCard';
import { Button } from '@/components/ui/Button';
import { SwingResult } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppColors } from '@/lib/theme';

export default function ResultsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { uri, result } = useLocalSearchParams<{ uri: string; result: string }>();
  const [activeTab, setActiveTab] = useState<'analysis' | 'drill'>('analysis');

  let parsedResult: SwingResult | null = null;
  try {
    parsedResult = result ? JSON.parse(result) : null;
  } catch {
    // ignore
  }

  if (!parsedResult || !uri) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorState}>
          <Text style={styles.errorText}>No results to display.</Text>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/analyze')}>
            <Text style={styles.errorLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Swing Analysis</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>AI coaching results</Text>
        </View>
        <TouchableOpacity
          onPress={() =>
            Share.share({
              message: `My swing analysis: ${parsedResult?.primaryIssue}. Fix: ${parsedResult?.fixes?.[0]}`,
            })
          }
          style={styles.shareBtn}
        >
          <Text style={styles.shareIcon}>↗</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabSwitcher}>
        {(['analysis', 'drill'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'analysis' ? '📊 Analysis' : '🎯 Drill & Lesson'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.videoWrap}>
          <VideoPlayer uri={uri} />
        </View>

        {activeTab === 'analysis' ? (
          <View style={styles.tabContent}>
            <View>
              <Text style={styles.sectionLabel}>Impact Snapshot</Text>
              <ImpactSnapshot />
            </View>
            <AIAnalysisCard result={parsedResult} />
          </View>
        ) : (
          <View style={styles.tabContent}>
            {parsedResult.drill && (
              <View style={styles.drillCard}>
                <Text style={styles.sectionLabel}>Recommended Drill</Text>
                <Text style={styles.drillText}>{parsedResult.drill.name}</Text>
                <Text style={styles.drillText}>{parsedResult.drill.whyThisDrill}</Text>
                {parsedResult.drill.steps.map((step, i) => (
                  <Text key={i} style={styles.drillText}>{`${i + 1}. ${step}`}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.cta}>
          <Button
            title="Practice & Re-Analyze"
            onPress={() => router.replace('/(tabs)/analyze')}
            fullWidth
            size="lg"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#8E8E93' },
  errorLink: { color: '#4CAF50', fontWeight: '600', marginTop: 12 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  shareIcon: { fontSize: 16, color: '#FFFFFF' },
  tabSwitcher: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#2E7D32' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  tabTextActive: { color: '#FFFFFF' },
  videoWrap: { marginHorizontal: 16, marginBottom: 20 },
  tabContent: { paddingHorizontal: 16, gap: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  drillCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  drillText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  cta: { paddingHorizontal: 16, marginTop: 24 },
});
