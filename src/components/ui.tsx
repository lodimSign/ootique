import { useState } from 'react';
import { Image, Modal, Pressable, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Screen } from '../domain';
import { styles } from '../theme';

export function BrandHeader() {
  return (
    <View style={styles.brandHeader}>
      <Text style={styles.brand}>ootique</Text>
      <Text style={styles.brandTagline}>SPIN YOUR STYLE</Text>
    </View>
  );
}

export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.screenHeader}>
      <Pressable accessibilityLabel="뒤로" accessibilityRole="button" onPress={onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>‹</Text>
      </Pressable>
      <Text style={styles.screenHeaderTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

export function SegmentButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.segmentButton, active && styles.segmentButtonActive]}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.smallButton}>
      <Text style={styles.smallButtonText}>{label}</Text>
    </Pressable>
  );
}

export function BottomNav({ active, onNavigate }: { active: Screen; onNavigate: (screen: Screen) => void }) {
  const items: { key: Screen; label: string; mark: string }[] = [
    { key: 'today', label: '오늘', mark: '⌂' },
    { key: 'capture', label: '촬영', mark: '＋' },
    { key: 'history', label: '기록', mark: '▣' },
  ];
  return (
    <SafeAreaView edges={['bottom']} style={styles.bottomNav}>
      {items.map((item) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: active === item.key }}
          key={item.key}
          onPress={() => onNavigate(item.key)}
          style={styles.navItem}
        >
          <Text style={[styles.navMark, active === item.key && styles.navActive]}>{item.mark}</Text>
          <Text style={[styles.navLabel, active === item.key && styles.navActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </SafeAreaView>
  );
}

export function ZoomablePhoto({ label, style, uri }: { label: string; style: StyleProp<ImageStyle>; uri: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <Pressable
      accessibilityLabel={`${label} 크게 보기`}
      accessibilityRole="imagebutton"
      onPress={() => setZoomed(true)}
      style={styles.zoomTouch}
    >
      <Image resizeMode="cover" source={{ uri }} style={style} />
      <Modal animationType="fade" onRequestClose={() => setZoomed(false)} transparent visible={zoomed}>
        <Pressable
          accessibilityLabel="원본 사진 닫기"
          accessibilityRole="button"
          onPress={() => setZoomed(false)}
          style={styles.zoomBackdrop}
        >
          <Image resizeMode="contain" source={{ uri }} style={styles.zoomImage} />
        </Pressable>
      </Modal>
    </Pressable>
  );
}

export function PhotoFrame({ label, style, uri }: { label: string; style?: StyleProp<ViewStyle>; uri: string | null }) {
  return (
    <View style={[styles.photoFrame, style]}>
      {uri ? (
        <ZoomablePhoto label={label} style={styles.photo} uri={uri} />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderMark}>＋</Text>
          <Text style={styles.photoPlaceholderText}>{label}</Text>
        </View>
      )}
    </View>
  );
}

