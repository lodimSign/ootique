import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, PixelRatio, Pressable, ScrollView, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { colorById, type OotdRecord } from '../domain';
import { t, tf } from '../i18n';
import { THEME, styles } from '../theme';
import { appLink, currentShareToken, shareMessage, voteLink } from '../voteSync';
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
      Alert.alert(t('share.linkSendFailTitle'), t('common.retryLater'));
    } finally {
      setLinking(false);
    }
  };

  const confirmUnpublish = () => {
    Alert.alert(t('share.unpublishConfirmTitle'), t('share.unpublishConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('share.unpublishAction'),
        style: 'destructive',
        onPress: async () => {
          try { await onUnpublish(); } catch { Alert.alert(t('share.unpublishFailTitle'), t('common.retryLater')); }
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
        Alert.alert(t('share.unavailableTitle'), t('share.unavailableBody'));
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
      // 매뉴얼 규칙 6 — 이미지만 나가는 공유는 만들지 않는다. Sharing.shareAsync는 글자를 못 실으므로
      // 링크를 클립보드에 올려 같은 대화에 바로 붙여넣게 한다.
      const link = record.shareToken ? voteLink(await currentShareToken(record.shareToken)) : appLink;
      const copied = await Clipboard.setStringAsync(link).then(() => true).catch(() => false);
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: tf('share.dialogTitle', { color: color.name }),
      });
      Alert.alert(
        copied ? t('share.linkCopiedTitle') : t('share.linkCopyFailTitle'),
        copied ? t('share.linkCopiedBody') : tf('share.linkCopyFailBody', { link }),
      );
    } catch {
      Alert.alert(t('share.cardFailTitle'), t('common.retryLater'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.shareContent}>
      <ScreenHeader title={t('share.title')} onBack={onBack} />
      <View ref={cardRef} collapsable={false} style={styles.shareCard}>
        <View style={styles.shareBrandRow}>
          <Text style={styles.shareBrand}>ootique</Text>
          <Text style={styles.shareDate}>{record.dateKey}</Text>
        </View>
        <View style={record.mode === 'friend' ? styles.friendPhotos : styles.soloPhoto}>
          <ZoomablePhoto label={t('common.myOotd')} style={styles.sharePhoto} uri={record.photoUri} />
          {record.mode === 'friend' && record.partnerPhotoUri && (
            <ZoomablePhoto label={t('common.friendOotd')} style={styles.sharePhoto} uri={record.partnerPhotoUri} />
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
            ? t('share.questionFriend')
            : t('share.questionSolo')}
        </Text>
        {record.mode === 'friend' && <Text style={styles.shareCode}>FRIEND CODE · {record.friendCode}</Text>}
      </View>
      {record.shareToken ? (
        <Pressable accessibilityRole="button" disabled={linking} onPress={shareLink} style={styles.primaryButton}>
          {linking ? <ActivityIndicator color={THEME.ink} /> : <Text style={styles.primaryButtonText}>{t('share.sendToFriend')}</Text>}
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
          <Text style={record.shareToken ? styles.secondaryButtonText : styles.primaryButtonText}>{t('share.cardImage')}</Text>
        )}
      </Pressable>

      {record.publicEntryId ? (
        <Pressable accessibilityRole="button" onPress={confirmUnpublish} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{t('share.unpublishButton')}</Text>
        </Pressable>
      ) : null}

      <Pressable accessibilityRole="button" onPress={onHistory} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>{t('share.viewHistory')}</Text>
      </Pressable>

      <Text style={styles.localOnly}>
        {record.shareToken
          ? t('share.footerWithLink')
          : t('share.footerPrivate')}
      </Text>
    </ScrollView>
  );
}

