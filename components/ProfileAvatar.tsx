import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/** Squircle corner radius for profile avatars (rounded square, not a circle). */
export function profileAvatarRadius(size: number) {
  return Math.round(size * 0.32);
}

export type ProfileAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<ProfileAvatarSize, number> = {
  xs: 42,
  sm: 52,
  md: 56,
  lg: 80,
  xl: 108,
};

const FONT_MAP: Record<ProfileAvatarSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 24,
  xl: 32,
};

const BORDER_WIDTH = 2.5;
const DEFAULT_BORDER = '#FFFFFF';
const DEFAULT_FALLBACK_BG = '#142218';
const DEFAULT_INITIALS_COLOR = '#34E06F';

export type ProfileAvatarProps = {
  /** Preset size or exact pixel dimension. */
  size?: ProfileAvatarSize | number;
  imageUri?: string | null;
  initials?: string;
  backgroundColor?: string;
  initialsColor?: string;
  borderColor?: string;
  style?: StyleProp<ViewStyle>;
};

export function ProfileAvatar({
  size = 'md',
  imageUri,
  initials = '?',
  backgroundColor = DEFAULT_FALLBACK_BG,
  initialsColor = DEFAULT_INITIALS_COLOR,
  borderColor = DEFAULT_BORDER,
  style,
}: ProfileAvatarProps) {
  const dim = typeof size === 'number' ? size : SIZE_MAP[size];
  const radius = profileAvatarRadius(dim);
  const fontSize =
    typeof size === 'number' ? Math.max(11, Math.round(dim * 0.3)) : FONT_MAP[size];

  return (
    <View
      style={[
        styles.shell,
        {
          width: dim,
          height: dim,
          borderRadius: radius,
          borderColor,
          backgroundColor: imageUri ? '#000' : backgroundColor,
        },
        style,
      ]}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={{ width: dim, height: dim, borderRadius: radius }}
          resizeMode="cover"
        />
      ) : (
        <Text style={[styles.initials, { fontSize, color: initialsColor }]} numberOfLines={1}>
          {initials}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderWidth: BORDER_WIDTH,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
