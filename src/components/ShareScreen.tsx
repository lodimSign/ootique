import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, PixelRatio, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { colorById, type OotdRecord } from '../domain';
import { THEME, styles } from '../theme';
import { ScreenHeader } from './ui';

export function ShareScreen({ record, onBack, onHistory }: { record: OotdRecord; onBack: () => void; onHistory: () => void }) {
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const color = colorById(record.colorId);

  const shareCard = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const pixelRatio = PixelRatio.get();
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: Math.round(1080 / pixelRatio),
        height: Math.round(1350 / pixelRatio),
      });
      await Share.share({
        title: 'Ootique 오늘의 컬러',
        message: `오늘의 컬러는 ${color.name}. Ootique에서 함께 도전해요.`,
        url: uri,
      });
    } catch {
      Alert.alert('공유 카드를 만들지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.shareContent}>
      <ScreenHeader title="공유 카드" onBack={onBack} />
      <View ref={cardRef} collapsable={false} style={styles.shareCard}>
        <View style={styles.shareBrandRow}>
          <Text style={styles.shareBrand}>ootique</Text>
          <Text style={styles.shareDate}>{record.dateKey}</Text>
        </View>
        <View style={record.mode === 'friend' ? styles.friendPhotos : styles.soloPhoto}>
          <Image source={{ uri: record.photoUri }} style={styles.sharePhoto} />
          {record.mode === 'friend' && record.partnerPhotoUri && (
            <Image source={{ uri: record.partnerPhotoUri }} style={styles.sharePhoto} />
          )}
        </View>
        <View style={styles.shareResultRow}>
          <View style={[styles.shareSwatch, { backgroundColor: color.hex }]} />
          <View style={styles.shareResultCopy}>
            <Text style={styles.shareEyebrow}>TODAY'S COLOR</Text>
            <Text style={styles.shareColorName}>{color.name}</Text>
          </View>
        </View>
        <Text style={styles.shareQuestion}>
          {record.mode === 'friend'
            ? '누가 오늘의 컬러를 더 잘 살렸나요?'
            : '오늘의 컬러를 입고 나왔어요.'}
        </Text>
        {record.mode === 'friend' && <Text style={styles.shareCode}>FRIEND CODE · {record.friendCode}</Text>}
      </View>
      <Pressable accessibilityRole="button" disabled={sharing} onPress={shareCard} style={styles.primaryButton}>
        {sharing ? <ActivityIndicator color={THEME.ink} /> : <Text style={styles.primaryButtonText}>이미지로 공유하기</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onHistory} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>지난 기록 보기</Text>
      </Pressable>
    </ScrollView>
  );
}

