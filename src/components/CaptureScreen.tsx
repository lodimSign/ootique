import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { type ChallengeMode } from '../domain';
import { type FriendSession, type FriendState } from '../friendSync';
import { t, tf } from '../i18n';
import { THEME, styles } from '../theme';
import { PhotoFrame, ScreenHeader, SmallButton } from './ui';

export type CaptureScreenProps = {
  mode: ChallengeMode;
  colorName: string;
  mineUri: string | null;
  friendUri: string | null;
  friendStatus: FriendSession['status'] | FriendState['status'] | null;
  busy: boolean;
  publicOptIn: boolean;
  onBack: () => void;
  onChoose: (target: 'mine' | 'friend', source: 'camera' | 'library') => void;
  onTogglePublic: (next: boolean) => void;
  onSave: () => void;
};

export function CaptureScreen(props: CaptureScreenProps) {
  const canSave = Boolean(props.mineUri && (props.mode === 'solo' || props.friendStatus === 'active'));
  return (
    <ScrollView contentContainerStyle={styles.captureContent}>
      <ScreenHeader title={t('capture.title')} onBack={props.onBack} />
      <Text style={styles.captureGuide}>{tf('capture.guide', { color: props.colorName })}</Text>
      {props.mode === 'friend' ? (
        <View style={styles.capturePhotoRow}>
          <PhotoFrame label={t('common.myOotd')} style={styles.photoColumn} uri={props.mineUri} />
          <PhotoFrame label={t('common.friendOotd')} style={styles.photoColumn} uri={props.friendUri} />
        </View>
      ) : (
        <PhotoFrame label={t('common.myOotd')} uri={props.mineUri} />
      )}
      <View style={styles.actionRow}>
        <SmallButton label={t('capture.camera')} onPress={() => props.onChoose('mine', 'camera')} />
        <SmallButton label={t('capture.fromAlbum')} onPress={() => props.onChoose('mine', 'library')} />
      </View>

      {props.mode === 'friend' && !props.friendUri && (
        <Text style={styles.captureGuide}>{t('capture.friendAutoShow')}</Text>
      )}

      <View style={styles.optInRow}>
        <View style={styles.optInCopy}>
          <Text style={styles.optInTitle}>{t('capture.optInTitle')}</Text>
          <Text style={styles.optInHint}>
            {props.mode === 'friend'
              ? t('capture.optInHintFriend')
              : t('capture.optInHintSolo')}
          </Text>
        </View>
        <Switch
          accessibilityLabel={t('capture.optInTitle')}
          onValueChange={props.onTogglePublic}
          trackColor={{ false: THEME.line, true: THEME.ink }}
          value={props.publicOptIn}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!canSave || props.busy}
        onPress={props.onSave}
        style={[styles.primaryButton, (!canSave || props.busy) && styles.disabledButton]}
      >
        {props.busy ? (
          <ActivityIndicator color={THEME.ink} />
        ) : (
          <Text style={styles.primaryButtonText}>
            {props.mode === 'friend' && !props.friendUri ? t('capture.saveWaitFriend') : t('capture.saveAndCard')}
          </Text>
        )}
      </Pressable>
      <Text style={styles.localOnly}>
        {props.publicOptIn
          ? t('capture.footerPublic')
          : props.mode === 'friend'
            ? t('capture.footerFriend')
            : t('capture.footerSolo')}
      </Text>
    </ScrollView>
  );
}
