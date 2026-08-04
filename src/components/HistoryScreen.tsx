import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { colorById, freeRetentionCutoffKey, isRecordWithinFreeRetention, type OotdRecord } from '../domain';
import { THEME, styles } from '../theme';
import { BrandHeader } from './ui';

export type HistoryScreenProps = {
  isPlus: boolean;
  plusPrice: string;
  purchaseBusy: boolean;
  storeConnected: boolean;
  records: OotdRecord[];
  onBuyPlus: () => void;
  onOpen: (record: OotdRecord) => void;
  onDelete: (record: OotdRecord) => void;
  onDeleteAll: () => void;
  onRestorePlus: () => void;
};

export function HistoryScreen({
  isPlus,
  plusPrice,
  purchaseBusy,
  storeConnected,
  records,
  onBuyPlus,
  onOpen,
  onDelete,
  onDeleteAll,
  onRestorePlus,
}: HistoryScreenProps) {
  const cutoffKey = freeRetentionCutoffKey();
  const recentRecords = isPlus
    ? records
    : records.filter((record) => isRecordWithinFreeRetention(record, cutoffKey));
  return (
    <ScrollView contentContainerStyle={styles.historyContent}>
      <BrandHeader />
      <Text style={styles.sectionTitle}>최근 7일의 OOTD</Text>
      <View style={styles.plusCard}>
        <Text style={styles.plusEyebrow}>OOTIQUE PLUS</Text>
        <Text style={styles.plusTitle}>{isPlus ? 'Plus 이용 중' : `전체 기록 보관 · ${plusPrice} 1회`}</Text>
        <Text style={styles.plusText}>
          {isPlus
            ? '이 기기의 지난 OOTD를 기간 제한 없이 보관해요.'
            : '무료 사용자는 최근 7일만 보관하고, Plus는 모든 로컬 기록을 보관해요.'}
        </Text>
        {!isPlus && (
          <Pressable
            accessibilityRole="button"
            disabled={purchaseBusy || !storeConnected}
            onPress={onBuyPlus}
            style={[styles.plusButton, (purchaseBusy || !storeConnected) && styles.disabledButton]}
          >
            {purchaseBusy ? (
              <ActivityIndicator color={THEME.ink} />
            ) : (
              <Text style={styles.plusButtonText}>Ootique Plus 구매</Text>
            )}
          </Pressable>
        )}
        <Pressable accessibilityRole="button" disabled={purchaseBusy} onPress={onRestorePlus}>
          <Text style={styles.restoreText}>구매 복원</Text>
        </Pressable>
      </View>
      {recentRecords.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>아직 남긴 OOTD가 없어요.</Text>
          <Text style={styles.emptyText}>오늘의 컬러를 입고 첫 기록을 만들어보세요.</Text>
        </View>
      ) : (
        recentRecords.map((record) => {
          const itemColor = colorById(record.colorId);
          return (
            <View key={record.id} style={styles.historyCard}>
              <Pressable accessibilityRole="button" onPress={() => onOpen(record)} style={styles.historyMain}>
                <Image source={{ uri: record.photoUri }} style={styles.historyImage} />
                <View style={styles.historyCopy}>
                  <Text style={styles.historyDate}>{record.dateKey}</Text>
                  <Text style={styles.historyColor}>{itemColor.name}</Text>
                  <Text style={styles.historyMode}>{record.mode === 'friend' ? '친구와' : '혼자'}</Text>
                </View>
                <View style={[styles.historySwatch, { backgroundColor: itemColor.hex }]} />
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => onDelete(record)} style={styles.deleteButton}>
                <Text style={styles.deleteButtonText}>삭제</Text>
              </Pressable>
            </View>
          );
        })
      )}

      <View style={styles.privacyCard}>
        <Text style={styles.privacyTitle}>개인정보</Text>
        <Text style={styles.privacyText}>
          혼자 모드 사진과 기록은 이 기기에만 저장됩니다. 친구 모드 사진은 연결된 두 사람이 함께 보는 동안 비공개 서버에 저장됩니다.
        </Text>
        {records.length > 0 && (
          <Pressable accessibilityRole="button" onPress={onDeleteAll} style={styles.deleteAllButton}>
            <Text style={styles.deleteAllText}>모든 로컬 데이터 삭제</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

