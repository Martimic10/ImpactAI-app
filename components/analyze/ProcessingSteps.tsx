import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
} from 'react-native-reanimated';

const STEPS = [
  { label: 'Checking setup', duration: 1800 },
  { label: 'Analyzing swing path', duration: 2400 },
  { label: 'Detecting impact position', duration: 2000 },
  { label: 'Generating coaching tips', duration: 2200 },
];

interface ProcessingStepsProps {
  onComplete?: () => void;
}

export function ProcessingSteps({ onComplete }: ProcessingStepsProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  const dotOpacity = useSharedValue(1);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  useEffect(() => {
    dotOpacity.value = withRepeat(
      withSequence(withTiming(0.2, { duration: 600 }), withTiming(1, { duration: 600 })),
      -1,
      false
    );
  }, []);

  useEffect(() => {
    const step = STEPS[currentStep];
    if (!step) return;

    const timer = setTimeout(() => {
      setCompletedSteps((prev) => [...prev, currentStep]);
      if (currentStep < STEPS.length - 1) {
        setCurrentStep((s) => s + 1);
      } else {
        onComplete?.();
      }
    }, step.duration);

    return () => clearTimeout(timer);
  }, [currentStep]);

  return (
    <View style={styles.container}>
      {STEPS.map((step, i) => {
        const isCompleted = completedSteps.includes(i);
        const isActive = i === currentStep;

        return (
          <View key={step.label} style={styles.row}>
            <View
              style={[
                styles.indicator,
                isCompleted && styles.indicatorDone,
                isActive && styles.indicatorActive,
                !isCompleted && !isActive && styles.indicatorIdle,
              ]}
            >
              {isCompleted ? (
                <Text style={styles.checkmark}>✓</Text>
              ) : isActive ? (
                <Animated.View style={[styles.dot, dotStyle]} />
              ) : (
                <View style={styles.dotIdle} />
              )}
            </View>
            <Text
              style={[
                styles.label,
                isCompleted && styles.labelDone,
                isActive && styles.labelActive,
                !isCompleted && !isActive && styles.labelIdle,
              ]}
            >
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16, width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  indicator: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorDone: { backgroundColor: '#2E7D32' },
  indicatorActive: { backgroundColor: '#1B2E1B', borderWidth: 2, borderColor: '#2E7D32' },
  indicatorIdle: { backgroundColor: '#2A2A2A' },
  checkmark: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' },
  dotIdle: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#48484A' },
  label: { fontSize: 15 },
  labelDone: { color: '#4CAF50', fontWeight: '500' },
  labelActive: { color: '#FFFFFF', fontWeight: '600' },
  labelIdle: { color: '#48484A', fontWeight: '400' },
});
