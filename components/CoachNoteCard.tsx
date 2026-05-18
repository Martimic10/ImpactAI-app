import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { overlayTheme } from '@/lib/overlayTheme';

interface Props {
  phaseName: string;
  insight: string;
  onLearnMore?: () => void;
}

export function CoachNoteCard({ phaseName, insight, onLearnMore }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="golf-outline" size={15} color={overlayTheme.green} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.kicker}>Phase</Text>
          <Text style={styles.title}>{phaseName}</Text>
        </View>
        {onLearnMore && (
          <TouchableOpacity onPress={onLearnMore} style={styles.learnBtn} activeOpacity={0.8}>
            <Text style={styles.learnText}>Learn more</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.insight}>{insight}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#151716',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262C28',
    padding: 14,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(76,175,80,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1 },
  kicker: {
    fontSize: 10,
    fontWeight: '700',
    color: '#788078',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 1,
  },
  learnBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  learnText: {
    fontSize: 12,
    fontWeight: '700',
    color: overlayTheme.green,
  },
  insight: {
    fontSize: 14,
    lineHeight: 20,
    color: '#D7DED8',
  },
});

