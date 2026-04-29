import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SwingThumbnail } from '@/components/SwingThumbnail';
import { Swing, getSwingScore } from '@/types';

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function scoreColor(score: number) {
  if (score >= 70) return '#4CAF50';
  if (score >= 50) return '#FF9F0A';
  return '#FF453A';
}

interface SwingHistoryCardProps {
  swing: Swing;
  onView: () => void;
  onReAnalyze: () => void;
  onCompare: () => void;
}

export function SwingHistoryCard({ swing, onView, onReAnalyze, onCompare }: SwingHistoryCardProps) {
  const score = Math.round(getSwingScore(swing.result_json));
  const sc = scoreColor(score);
  const version = swing.analysis_version ?? 1;

  return (
    <View style={styles.card}>
      {/* Top row: thumbnail + main info */}
      <TouchableOpacity style={styles.topRow} onPress={onView} activeOpacity={0.8}>
        <SwingThumbnail swing={swing} size="lg" />

        <View style={styles.info}>
          <View style={styles.infoTop}>
            <Text style={styles.issue} numberOfLines={2}>{swing.result_json.primaryIssue}</Text>
            <View style={[styles.scorePill, { backgroundColor: sc + '22' }]}>
              <Text style={[styles.scoreText, { color: sc }]}>{score}</Text>
            </View>
          </View>

          <View style={styles.meta}>
            <Text style={styles.metaText}>{formatDate(swing.created_at)}</Text>
            {swing.club && (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText}>{swing.club}</Text>
              </>
            )}
            {version > 1 && (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.versionText}>v{version}</Text>
              </>
            )}
          </View>

          <View style={styles.issuePill}>
            <Text style={styles.issuePillText}>{swing.result_json.issueCategory}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={onView} activeOpacity={0.8}>
          <Ionicons name="eye-outline" size={14} color="#FFFFFF" />
          <Text style={styles.actionText}>View</Text>
        </TouchableOpacity>

        <View style={styles.actionDivider} />

        <TouchableOpacity style={styles.actionBtn} onPress={onReAnalyze} activeOpacity={0.8}>
          <Ionicons name="refresh-outline" size={14} color="#4CAF50" />
          <Text style={[styles.actionText, { color: '#4CAF50' }]}>Re-Analyze</Text>
        </TouchableOpacity>

        <View style={styles.actionDivider} />

        <TouchableOpacity style={styles.actionBtn} onPress={onCompare} activeOpacity={0.8}>
          <Ionicons name="git-compare-outline" size={14} color="#8E8E93" />
          <Text style={[styles.actionText, { color: '#8E8E93' }]}>Compare</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#161616',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  info: {
    flex: 1,
    justifyContent: 'space-between',
  },
  infoTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  issue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  scorePill: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scoreText: {
    fontSize: 16,
    fontWeight: '800',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#666666',
  },
  metaDot: {
    fontSize: 12,
    color: '#444444',
  },
  versionText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '600',
  },
  issuePill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  issuePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'capitalize',
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
  },
  actionDivider: {
    width: 1,
    backgroundColor: '#2A2A2A',
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
