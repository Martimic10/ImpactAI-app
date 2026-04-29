import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

interface ImpactSnapshotProps {
  thumbnailUri?: string;
}

export function ImpactSnapshot({ thumbnailUri }: ImpactSnapshotProps) {
  return (
    <View style={styles.container}>
      {thumbnailUri ? (
        <Image source={{ uri: thumbnailUri }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={styles.placeholder}>
          <Text style={{ fontSize: 40, marginBottom: 8 }}>🏌️</Text>
          <Text style={styles.placeholderText}>Impact frame</Text>
        </View>
      )}

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.headBox}>
          <View style={styles.headLabel}>
            <Text style={styles.annotationText}>HEAD</Text>
          </View>
        </View>

        <View style={styles.hipLine} />
        <View style={styles.hipLabel}>
          <Text style={[styles.annotationText, { color: '#4CAF50' }]}>HIP LINE</Text>
        </View>

        <View style={styles.postureLine} />
        <View style={styles.postureLabel}>
          <Text style={[styles.annotationText, { color: '#64B5F6' }]}>POSTURE</Text>
        </View>
      </View>

      <View style={styles.caption}>
        <Text style={styles.captionText}>Impact snapshot — AI detected frame</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#0A0A1A' },
  image: { width: '100%', height: 220 },
  placeholder: { width: '100%', height: 220, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  headBox: {
    position: 'absolute',
    top: 28,
    left: '35%',
    width: 70,
    height: 70,
    borderWidth: 2,
    borderColor: '#FFD60A',
    borderRadius: 8,
  },
  headLabel: {
    position: 'absolute',
    top: -20,
    left: 0,
    backgroundColor: '#FFD60A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  annotationText: { color: '#000', fontSize: 10, fontWeight: '700' },
  hipLine: {
    position: 'absolute',
    top: 120,
    left: '10%',
    width: '80%',
    height: 2,
    backgroundColor: '#4CAF50',
    opacity: 0.85,
  },
  hipLabel: {
    position: 'absolute',
    top: 108,
    right: '8%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  postureLine: {
    position: 'absolute',
    top: 10,
    left: '50%',
    width: 2,
    height: 200,
    backgroundColor: '#64B5F6',
    opacity: 0.75,
    transform: [{ rotate: '8deg' }],
  },
  postureLabel: {
    position: 'absolute',
    top: 12,
    left: '52%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  caption: { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.7)' },
  captionText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },
});
