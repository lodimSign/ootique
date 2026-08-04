import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { OOTIQUE_COLORS, type ChallengeMode } from '../domain';
import { type FriendSession, type FriendState } from '../friendSync';
import { styles } from '../theme';
import { RouletteMachine } from './RouletteMachine';
import { BrandHeader, SegmentButton, SmallButton } from './ui';

export type TodayScreenProps = {
  mode: ChallengeMode;
  friendCode: string;
  friendStatus: FriendSession['status'] | FriendState['status'] | null;
  pendingJoin: boolean;
  friendBusy: boolean;
  revealed: boolean;
  color: (typeof OOTIQUE_COLORS)[number];
  hasRecord: boolean;
  onModeChange: (mode: ChallengeMode) => void;
  onFriendCodeChange: (value: string) => void;
  onGenerateCode: () => void;
  onJoin: () => void;
  onPasteCode: () => void;
  onApprove: () => void;
  onReveal: () => void;
  onCapture: () => void;
  onOpenRecord: () => void;
};

export function TodayScreen(props: TodayScreenProps) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <BrandHeader />
        <View style={styles.segment}>
          <SegmentButton active={props.mode === 'solo'} label="혼자" onPress={() => props.onModeChange('solo')} />
          <SegmentButton
            active={props.mode === 'friend'}
            label="친구와"
            onPress={() => props.onModeChange('friend')}
          />
        </View>

        {props.mode === 'friend' && (
          <View style={styles.codeCard}>
            <View>
              <Text style={styles.eyebrow}>FRIEND CODE</Text>
              <Text style={styles.codeHint}>같은 코드를 넣으면 같은 컬러가 나와요.</Text>
            </View>
            <View style={styles.codeRow}>
              <TextInput
                accessibilityLabel="친구 코드"
                autoCapitalize="characters"
                maxLength={6}
                onChangeText={props.onFriendCodeChange}
                placeholder="6자리 코드"
                placeholderTextColor="#AAA59B"
                style={styles.codeInput}
                value={props.friendCode}
              />
            </View>
            <Text style={styles.codeLength}>{props.friendCode.length}/6</Text>
            <View style={styles.codeActions}>
              <SmallButton label="코드 붙여넣기" onPress={props.onPasteCode} />
              <SmallButton label="코드 만들기" onPress={props.onGenerateCode} />
            </View>
            {!props.friendStatus && (
              <SmallButton label={props.friendBusy ? '연결 중…' : '친구 코드로 연결'} onPress={props.onJoin} />
            )}
            {props.pendingJoin && (
              <SmallButton label={props.friendBusy ? '승인 중…' : '친구 참가 승인'} onPress={props.onApprove} />
            )}
            {props.friendStatus && (
              <Text style={styles.codeHint}>
                {props.friendStatus === 'active' ? '친구 연결 완료' : props.friendStatus === 'pending' ? '친구 승인 대기 중' : '친구 참가 대기 중'}
              </Text>
            )}
          </View>
        )}

        <Text style={styles.sectionTitle}>오늘의 컬러 룰렛</Text>
        <Text style={styles.sectionSubtitle}>하루에 한 번, 오늘 입을 색을 골라드려요.</Text>
        <RouletteMachine color={props.revealed ? props.color.hex : undefined} />

        {props.revealed ? (
          <View style={styles.resultCard}>
            <View style={[styles.largeSwatch, { backgroundColor: props.color.hex }]} />
            <View style={styles.resultCopy}>
              <Text style={styles.eyebrow}>오늘의 컬러 확정</Text>
              <Text style={styles.colorName}>{props.color.name}</Text>
              <Text style={styles.colorMood}>{props.color.mood}</Text>
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={props.onReveal} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>오늘의 컬러 뽑기</Text>
          </Pressable>
        )}

        {props.revealed && (
          <Pressable
            accessibilityRole="button"
            onPress={props.hasRecord ? props.onOpenRecord : props.onCapture}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>
              {props.hasRecord ? '오늘의 공유 카드 보기' : 'OOTD 촬영하기'}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

