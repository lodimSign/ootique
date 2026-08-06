import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, PixelRatio, Pressable, ScrollView, Share, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { colorById, type OotdRecord } from '../domain';
import { THEME, styles } from '../theme';
import { currentShareToken, shareMessage } from '../voteSync';
import { ScreenHeader, ZoomablePhoto } from './ui';

export function ShareScreen({ record, onBack, onHistory, onUnpublish }: {
  record: OotdRecord;
  onBack: () => void;
  onHistory: () => void;
  onUnpublish: () => Promise<void>;
}) {
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const [linking, setLinking] = useState(false);
  const color = colorById(record.colorId);

  // 매뉴얼 규칙 6 — 공유에는 앱으로 들어오는 링크를 무조건 같이 보낸다.
  // Share.share의 url은 안드로이드에서 조용히 빠지므로 링크는 message에 넣는다.
  const shareLink = async () => {
    if (!record.shareToken) return;
    setLinking(true);
    try {
      const token = await currentShareToken(record.shareToken);
      await Share.share({ message: shareMessage(color.name, token) });
    } catch {
      Alert.alert('링크를 보내지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      setLinking(false);
    }
  };

  const confirmUnpublish = () => {
    Alert.alert('공개를 내릴까요?', '투표 페이지와 순위에서 바로 사라지고 서버의 사진도 지워집니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '내리기',
        style: 'destructive',
        onPress: async () => {
          try { await onUnpublish(); } catch { Alert.alert('내리지 못했어요', '잠시 후 다시 시도해 주세요.'); }
        },
      },
    ]);
  };

  const shareCard = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      // ponytail: RN Share의 url은 iOS 전용이라 안드로이드에서 이미지가 빠졌다. expo-sharing은 양쪽 다 파일을 보낸다.
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('이 기기에서는 공유를 열 수 없어요', '사진 앱으로 저장한 뒤 보내주세요.');
        return;
      }
      const pixelRatio = PixelRatio.get();
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: Math.round(1080 / pixelRatio),
        height: Math.round(1350 / pixelRatio),
      });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: `오늘의 컬러는 ${color.name}`,
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
          <ZoomablePhoto label="내 OOTD" style={styles.sharePhoto} uri={record.photoUri} />
          {record.mode === 'friend' && record.partnerPhotoUri && (
            <ZoomablePhoto label="친구 OOTD" style={styles.sharePhoto} uri={record.partnerPhotoUri} />
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
      {record.shareToken ? (
        <Pressable accessibilityRole="button" disabled={linking} onPress={shareLink} style={styles.primaryButton}>
          {linking ? <ActivityIndicator color={THEME.ink} /> : <Text style={styles.primaryButtonText}>친구에게 보내기</Text>}
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={sharing}
        onPress={shareCard}
        style={record.shareToken ? styles.secondaryButton : styles.primaryButton}
      >
        {sharing ? (
          <ActivityIndicator color={THEME.ink} />
        ) : (
          <Text style={record.shareToken ? styles.secondaryButtonText : styles.primaryButtonText}>카드 이미지 공유</Text>
        )}
      </Pressable>

      {record.publicEntryId ? (
        <Pressable accessibilityRole="button" onPress={confirmUnpublish} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>공개 내리기</Text>
        </Pressable>
      ) : null}

      <Pressable accessibilityRole="button" onPress={onHistory} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>지난 기록 보기</Text>
      </Pressable>

      <Text style={styles.localOnly}>
        {record.shareToken
          ? '보내는 링크를 누르면 앱이 없어도 바로 투표하고 앱을 받을 수 있어요.'
          : '이 기록은 비공개예요. 카드 이미지만 보내집니다.'}
      </Text>
    </ScrollView>
  );
}

