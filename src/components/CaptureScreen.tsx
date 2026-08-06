import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { type ChallengeMode } from '../domain';
import { type FriendSession, type FriendState } from '../friendSync';
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
      <ScreenHeader title="오늘의 OOTD" onBack={props.onBack} />
      <Text style={styles.captureGuide}>{props.colorName}을 살린 옷을 보여주세요.</Text>
      {props.mode === 'friend' ? (
        <View style={styles.capturePhotoRow}>
          <PhotoFrame label="내 OOTD" style={styles.photoColumn} uri={props.mineUri} />
          <PhotoFrame label="친구 OOTD" style={styles.photoColumn} uri={props.friendUri} />
        </View>
      ) : (
        <PhotoFrame label="내 OOTD" uri={props.mineUri} />
      )}
      <View style={styles.actionRow}>
        <SmallButton label="카메라" onPress={() => props.onChoose('mine', 'camera')} />
        <SmallButton label="앨범에서 선택" onPress={() => props.onChoose('mine', 'library')} />
      </View>

      {props.mode === 'friend' && !props.friendUri && (
        <Text style={styles.captureGuide}>친구가 사진을 올리면 자동으로 표시돼요.</Text>
      )}

      <View style={styles.optInRow}>
        <View style={styles.optInCopy}>
          <Text style={styles.optInTitle}>오늘의 투표에 공개</Text>
          <Text style={styles.optInHint}>
            {props.mode === 'friend'
              ? '둘 다 켜야 A/B 투표 링크가 만들어져요. 7일 뒤 자동으로 지워집니다.'
              : '누구나 링크로 볼 수 있게 됩니다. 7일 뒤 자동으로 지워집니다.'}
          </Text>
        </View>
        <Switch
          accessibilityLabel="오늘의 투표에 공개"
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
            {props.mode === 'friend' && !props.friendUri ? '내 사진 올리고 친구 기다리기' : '사진 저장하고 공유 카드 만들기'}
          </Text>
        )}
      </Pressable>
      <Text style={styles.localOnly}>
        {props.publicOptIn
          ? '공개한 사진은 링크를 받은 누구나 볼 수 있습니다. 공유 카드 화면에서 언제든 내릴 수 있어요.'
          : props.mode === 'friend'
            ? '친구 모드 사진은 연결된 두 사람만 볼 수 있게 전송됩니다.'
            : '사진은 서버로 전송되지 않고 이 기기에만 저장됩니다.'}
      </Text>
    </ScrollView>
  );
}
