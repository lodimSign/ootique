import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { colorById, freeRetentionCutoffKey, isRecordWithinFreeRetention, type OotdRecord } from '../domain';
import { t, tf } from '../i18n';
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
      <Text style={styles.sectionTitle}>{t('history.recentTitle')}</Text>
      <View style={styles.plusCard}>
        <Text style={styles.plusEyebrow}>OOTIQUE PLUS</Text>
        <Text style={styles.plusTitle}>{isPlus ? t('history.plusActive') : tf('history.plusOffer', { price: plusPrice })}</Text>
        <Text style={styles.plusText}>
          {isPlus
            ? t('history.plusTextActive')
            : t('history.plusTextFree')}
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
              <Text style={styles.plusButtonText}>{t('history.buyPlus')}</Text>
            )}
          </Pressable>
        )}
        <Pressable accessibilityRole="button" disabled={purchaseBusy} onPress={onRestorePlus}>
          <Text style={styles.restoreText}>{t('history.restorePurchase')}</Text>
        </Pressable>
      </View>
      {recentRecords.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t('history.emptyTitle')}</Text>
          <Text style={styles.emptyText}>{t('history.emptyText')}</Text>
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
                  <Text style={styles.historyMode}>{record.mode === 'friend' ? t('common.modeFriend') : t('common.modeSolo')}</Text>
                </View>
                <View style={[styles.historySwatch, { backgroundColor: itemColor.hex }]} />
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => onDelete(record)} style={styles.deleteButton}>
                <Text style={styles.deleteButtonText}>{t('common.delete')}</Text>
              </Pressable>
            </View>
          );
        })
      )}

      <View style={styles.privacyCard}>
        <Text style={styles.privacyTitle}>{t('history.privacyTitle')}</Text>
        <Text style={styles.privacyText}>
          {t('history.privacyText')}
        </Text>
        {records.length > 0 && (
          <Pressable accessibilityRole="button" onPress={onDeleteAll} style={styles.deleteAllButton}>
            <Text style={styles.deleteAllText}>{t('history.deleteAll')}</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

