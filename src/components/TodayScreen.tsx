import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { OOTIQUE_COLORS, type ChallengeMode } from '../domain';
import { type FriendSession, type FriendState } from '../friendSync';
import { t } from '../i18n';
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
          <SegmentButton active={props.mode === 'solo'} label={t('common.modeSolo')} onPress={() => props.onModeChange('solo')} />
          <SegmentButton
            active={props.mode === 'friend'}
            label={t('common.modeFriend')}
            onPress={() => props.onModeChange('friend')}
          />
        </View>

        {props.mode === 'friend' && (
          <View style={styles.codeCard}>
            <View>
              <Text style={styles.eyebrow}>FRIEND CODE</Text>
              <Text style={styles.codeHint}>{t('friend.codeHint')}</Text>
            </View>
            <View style={styles.codeRow}>
              <TextInput
                accessibilityLabel={t('friend.codeInputLabel')}
                autoCapitalize="characters"
                maxLength={6}
                onChangeText={props.onFriendCodeChange}
                placeholder={t('friend.codePlaceholder')}
                placeholderTextColor="#AAA59B"
                style={styles.codeInput}
                value={props.friendCode}
              />
            </View>
            <Text style={styles.codeLength}>{props.friendCode.length}/6</Text>
            <View style={styles.codeActions}>
              <SmallButton label={t('friend.pasteCode')} onPress={props.onPasteCode} />
              <SmallButton label={t('friend.createCode')} onPress={props.onGenerateCode} />
            </View>
            {!props.friendStatus && (
              <SmallButton label={props.friendBusy ? t('friend.connecting') : t('friend.joinWithCode')} onPress={props.onJoin} />
            )}
            {props.pendingJoin && (
              <SmallButton label={props.friendBusy ? t('friend.approving') : t('friend.approveJoin')} onPress={props.onApprove} />
            )}
            {props.friendStatus && (
              <Text style={styles.codeHint}>
                {props.friendStatus === 'active' ? t('friend.statusActive') : props.friendStatus === 'pending' ? t('friend.statusPending') : t('friend.statusWaiting')}
              </Text>
            )}
          </View>
        )}

        <Text style={styles.sectionTitle}>{t('today.rouletteTitle')}</Text>
        <Text style={styles.sectionSubtitle}>{t('today.rouletteSubtitle')}</Text>
        <RouletteMachine color={props.revealed ? props.color.hex : undefined} />

        {props.revealed ? (
          <View style={styles.resultCard}>
            <View style={[styles.largeSwatch, { backgroundColor: props.color.hex }]} />
            <View style={styles.resultCopy}>
              <Text style={styles.eyebrow}>{t('today.resultEyebrow')}</Text>
              <Text style={styles.colorName}>{props.color.name}</Text>
              <Text style={styles.colorMood}>{props.color.mood}</Text>
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={props.onReveal} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{t('today.reveal')}</Text>
          </Pressable>
        )}

        {props.revealed && (
          <Pressable
            accessibilityRole="button"
            onPress={props.hasRecord ? props.onOpenRecord : props.onCapture}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>
              {props.hasRecord ? t('today.openShareCard') : t('today.capture')}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

