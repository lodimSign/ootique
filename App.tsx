import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { finishTransaction, useIAP } from 'expo-iap';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import {
  OOTIQUE_COLORS,
  type ChallengeMode,
  type OotdRecord,
  colorById,
  colorForChallenge,
  freeRetentionCutoffKey,
  friendSessionMatchesCode,
  isRecordWithinFreeRetention,
  localDateKey,
  normalizeFriendCode,
  recordId,
} from './src/domain';
import {
  copyPhoto,
  downloadPhoto,
  loadRecords,
  pruneExpiredRecords,
  removeAllData,
  removeRecord,
  upsertRecord,
  writeTemporaryJpeg,
} from './src/storage';
import { PLUS_PRODUCT_ID, hasPlusPurchase, purchaseErrorMessage } from './src/purchases';
import {
  approveFriendJoin,
  createFriendPair,
  friendPhotoSource,
  friendSyncConfigured,
  getFriendState,
  joinFriendPair,
  loadFriendSession,
  uploadOwnFriendPhoto,
  type FriendSession,
  type FriendState,
} from './src/friendSync';

type Screen = 'today' | 'capture' | 'share' | 'history';
type PhotoTarget = 'mine' | 'friend';

const THEME = {
  background: '#FBF8F1',
  surface: '#FFFFFF',
  ink: '#252421',
  muted: '#716E67',
  line: '#E8E1D6',
  yellow: '#F4D36A',
  yellowDark: '#7C671E',
  coral: '#D77969',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <OotiqueApp />
    </SafeAreaProvider>
  );
}

function OotiqueApp() {
  const [screen, setScreen] = useState<Screen>('today');
  const [mode, setMode] = useState<ChallengeMode>('solo');
  const [friendCode, setFriendCode] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [records, setRecords] = useState<OotdRecord[]>([]);
  const [mineUri, setMineUri] = useState<string | null>(null);
  const [mineUploadUri, setMineUploadUri] = useState<string | null>(null);
  const [friendUri, setFriendUri] = useState<string | null>(null);
  const [friendSession, setFriendSession] = useState<FriendSession | null>(null);
  const [friendState, setFriendState] = useState<FriendState | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [activeRecord, setActiveRecord] = useState<OotdRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isPlus, setIsPlus] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [purchaseChecked, setPurchaseChecked] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [retentionDate, setRetentionDate] = useState(() => localDateKey());
  const storeLoaded = useRef(false);
  const retentionDisabled = useRef(false);
  const lastPrunedCutoff = useRef<string | null>(null);
  const operationBusy = useRef(false);
  const retentionPending = useRef(false);
  const restoring = useRef(false);

  const {
    availablePurchases,
    connected: storeConnected,
    fetchProducts,
    getAvailablePurchases,
    products,
    requestPurchase,
    restorePurchases,
  } = useIAP({
    onPurchaseSuccess: async (purchase) => {
      if (purchase.productId !== PLUS_PRODUCT_ID || purchase.purchaseState !== 'purchased') return;
      try {
        await finishTransaction({ purchase, isConsumable: false });
        setIsPlus(true);
        Alert.alert('Ootique Plus가 열렸어요', '이 기기의 모든 로컬 기록을 계속 보관할 수 있어요.');
      } catch {
        Alert.alert('구매 확인을 마치지 못했어요', '앱을 다시 실행하거나 구매 복원을 눌러 주세요.');
      } finally {
        setPurchaseBusy(false);
      }
    },
    onPurchaseError: (error) => {
      setPurchaseBusy(false);
      const message = purchaseErrorMessage(error.code ?? 'unknown');
      if (message) Alert.alert('구매를 확인해 주세요', message);
    },
    onError: () => setPurchaseBusy(false),
  });

  const today = localDateKey();
  const normalizedCode = normalizeFriendCode(friendCode);
  const matchingFriendSession =
    friendSession && friendSessionMatchesCode(friendSession.inviteCode, normalizedCode)
      ? friendSession
      : null;
  const matchingFriendState =
    matchingFriendSession && friendState?.pairId === matchingFriendSession.pairId
      ? friendState
      : null;
  const currentFriendStatus = matchingFriendState?.status ?? matchingFriendSession?.status ?? null;
  const color = useMemo(
    () => colorForChallenge(today, mode, normalizedCode),
    [mode, normalizedCode, today],
  );
  const todayRecord = records.find(
    (record) => record.id === recordId(today, mode, normalizedCode),
  );

  useEffect(() => {
    loadRecords()
      .then(setRecords)
      .catch(() => Alert.alert('기록을 불러오지 못했어요', '앱을 다시 실행해 주세요.'))
      .finally(() => setRecordsLoaded(true));
  }, []);

  useEffect(() => {
    loadFriendSession().then((session) => {
      if (!session) return;
      setFriendSession(session);
      if (session.inviteCode) setFriendCode(session.inviteCode);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!matchingFriendSession || mode !== 'friend') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const state = await getFriendState(matchingFriendSession);
        if (cancelled) return;
        setFriendState(state);
        if (state.status === 'active' && matchingFriendSession.status !== 'active') {
          setFriendSession({ ...matchingFriendSession, status: 'active' });
        }
        const partnerSlot = matchingFriendSession.slot === 1 ? 2 : 1;
        const partnerPhoto = state.photos.find((photo) => photo.slot === partnerSlot && photo.available);
        if (partnerPhoto) {
          const source = friendPhotoSource(matchingFriendSession, partnerSlot, partnerPhoto.version);
          const localUri = await downloadPhoto(
            source,
            `friend-${matchingFriendSession.pairId}-${partnerSlot}-${partnerPhoto.version}`,
          );
          if (cancelled) return;
          setFriendUri(localUri);
        } else {
          setFriendUri(null);
        }
      } catch { /* A temporary network failure must not erase the saved session or the shown photo. */ }
    };
    refresh();
    const timer = setInterval(refresh, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [matchingFriendSession, mode]);

  useEffect(() => {
    const checkRetentionDate = () => {
      if (operationBusy.current) retentionPending.current = true;
      else setRetentionDate(localDateKey());
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkRetentionDate();
    });
    const timer = setInterval(checkRetentionDate, 60_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);

  const setOperationBusy = (value: boolean) => {
    operationBusy.current = value;
    setBusy(value);
    if (!value && retentionPending.current) {
      retentionPending.current = false;
      setRetentionDate(localDateKey());
    }
  };

  useEffect(() => {
    if (!recordsLoaded || storeConnected) return;
    const timer = setTimeout(() => {
      retentionDisabled.current = true;
      setLoading(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [recordsLoaded, storeConnected]);

  useEffect(() => {
    if (!storeConnected || storeLoaded.current) return;
    storeLoaded.current = true;
    fetchProducts({ skus: [PLUS_PRODUCT_ID], type: 'in-app' }).catch(() => undefined);
    getAvailablePurchases()
      .then(() => setPurchaseChecked(true))
      .catch(() => {
        storeLoaded.current = false;
        retentionDisabled.current = true;
        setLoading(false);
      });
  }, [fetchProducts, getAvailablePurchases, storeConnected]);

  useEffect(() => {
    const purchased = hasPlusPurchase(availablePurchases);
    setIsPlus(purchased);
    if (restoring.current) {
      restoring.current = false;
      setPurchaseBusy(false);
      Alert.alert(
        purchased ? '구매를 복원했어요' : '복원할 구매가 없어요',
        purchased
          ? 'Ootique Plus를 다시 사용할 수 있어요.'
          : '현재 Apple 계정에서 Ootique Plus 구매를 찾지 못했어요.',
      );
    }
  }, [availablePurchases]);

  useEffect(() => {
    if (!recordsLoaded || !purchaseChecked) return;
    if (operationBusy.current) {
      retentionPending.current = true;
      return;
    }
    if (retentionDisabled.current) {
      setLoading(false);
      return;
    }
    const cutoffKey = freeRetentionCutoffKey(new Date(`${retentionDate}T12:00:00`));
    if (hasPlusPurchase(availablePurchases)) {
      setLoading(false);
      return;
    }
    if (lastPrunedCutoff.current === cutoffKey) {
      setLoading(false);
      return;
    }
    lastPrunedCutoff.current = cutoffKey;
    setOperationBusy(true);
    setLoading(true);

    pruneExpiredRecords(cutoffKey)
      .then(setRecords)
      .catch(() => {
        lastPrunedCutoff.current = null;
        Alert.alert('오래된 기록을 정리하지 못했어요', '앱을 다시 실행하면 남은 사진 정리를 다시 시도해요.');
      })
      .finally(() => {
        setOperationBusy(false);
        setLoading(false);
      });
  }, [availablePurchases, purchaseChecked, recordsLoaded, retentionDate]);

  const buyPlus = async () => {
    if (!storeConnected) {
      Alert.alert('App Store에 연결할 수 없어요', '잠시 후 다시 시도해 주세요.');
      return;
    }
    setPurchaseBusy(true);
    try {
      await requestPurchase({
        request: { apple: { sku: PLUS_PRODUCT_ID } },
        type: 'in-app',
      });
    } catch {
      setPurchaseBusy(false);
      Alert.alert('구매를 시작하지 못했어요', '잠시 후 다시 시도해 주세요.');
    }
  };

  const restorePlus = async () => {
    if (!storeConnected) {
      Alert.alert('App Store에 연결할 수 없어요', '잠시 후 다시 시도해 주세요.');
      return;
    }
    restoring.current = true;
    setPurchaseBusy(true);
    try {
      await restorePurchases();
    } catch {
      restoring.current = false;
      setPurchaseBusy(false);
      Alert.alert('구매를 복원하지 못했어요', '네트워크를 확인한 뒤 다시 시도해 주세요.');
    }
  };

  useEffect(() => {
    setRevealed(Boolean(todayRecord));
  }, [todayRecord]);

  const changeMode = (nextMode: ChallengeMode) => {
    setMode(nextMode);
    setRevealed(false);
    setMineUri(null);
    setMineUploadUri(null);
    setFriendUri(null);
  };

  const openCapture = () => {
    if (mode === 'friend' && normalizedCode.length !== 6) {
      Alert.alert('친구 코드가 필요해요', '6자리 코드를 입력하거나 새로 만들어 주세요.');
      return;
    }
    setMineUri(todayRecord?.photoUri ?? null);
    setMineUploadUri(null);
    // 친구 사진은 폴링이 관리한다. 여기서 기록값으로 덮으면 방금 받은 친구 사진이 사라진다.
    if (mode !== 'friend') setFriendUri(null);
    setScreen('capture');
  };

  const choosePhoto = async (target: PhotoTarget, source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('카메라 권한이 필요해요', '설정에서 Ootique의 카메라 접근을 허용해 주세요.');
          return;
        }
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ base64: mode === 'friend', mediaTypes: ['images'], quality: mode === 'friend' ? 0.7 : 0.9 })
          : await ImagePicker.launchImageLibraryAsync({
              base64: mode === 'friend',
              mediaTypes: ['images'],
              preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
              quality: mode === 'friend' ? 0.7 : 0.9,
            });

      if (!result.canceled) {
        if (target === 'mine') {
          setMineUri(result.assets[0].uri);
          setMineUploadUri(
            mode === 'friend' && result.assets[0].base64
              ? await writeTemporaryJpeg(result.assets[0].base64)
              : null,
          );
        }
        else setFriendUri(result.assets[0].uri);
      }
    } catch {
      Alert.alert('사진을 열지 못했어요', '잠시 후 다시 시도해 주세요.');
    }
  };

  const createPair = async () => {
    if (!friendSyncConfigured) {
      Alert.alert('친구 연결 준비 중이에요', 'Supabase 공개 설정값을 연결한 빌드에서 사용할 수 있어요.');
      return;
    }
    setFriendBusy(true);
    try {
      const session = await createFriendPair();
      setFriendSession(session);
      setFriendState(null);
      setFriendUri(null);
      setFriendCode(session.inviteCode ?? '');
      setRevealed(false);
      if (session.inviteCode) {
        Clipboard.setStringAsync(session.inviteCode)
          .then(() => Alert.alert('친구 코드가 복사됐어요', '카카오톡이나 다른 메신저에 바로 붙여넣을 수 있어요.'))
          .catch(() => Alert.alert('코드는 만들었어요', '자동 복사는 실패했어요. 화면의 코드를 길게 눌러 복사해 주세요.'));
      }
    } catch {
      Alert.alert('코드를 만들지 못했어요', '네트워크를 확인한 뒤 다시 시도해 주세요.');
    } finally { setFriendBusy(false); }
  };

  const joinPair = async () => {
    if (normalizedCode.length !== 6) {
      Alert.alert('친구 코드가 필요해요', '친구가 보낸 6자리 코드를 입력해 주세요.');
      return;
    }
    setFriendBusy(true);
    try {
      const session = await joinFriendPair(normalizedCode);
      setFriendSession(session);
      setFriendState(null);
      setFriendUri(null);
      Alert.alert('참가 요청을 보냈어요', '코드를 만든 친구가 승인하면 사진이 자동 연결돼요.');
    } catch {
      Alert.alert('친구에게 연결하지 못했어요', '코드가 만료됐거나 이미 사용됐는지 확인해 주세요.');
    } finally { setFriendBusy(false); }
  };

  const pasteFriendCode = async () => {
    try {
      const pasted = normalizeFriendCode(await Clipboard.getStringAsync());
      setFriendCode(pasted);
      setRevealed(false);
      if (pasted.length !== 6) {
        Alert.alert('6자리 코드가 아니에요', `현재 ${pasted.length}자리예요. 친구에게 코드를 다시 받아 주세요.`);
      }
    } catch {
      Alert.alert('코드를 붙여넣지 못했어요', '클립보드 접근을 확인한 뒤 다시 시도해 주세요.');
    }
  };

  const approveJoin = async () => {
    if (!matchingFriendSession) return;
    setFriendBusy(true);
    try {
      const session = await approveFriendJoin(matchingFriendSession);
      setFriendSession(session);
      setFriendState(await getFriendState(session));
    } catch {
      Alert.alert('승인하지 못했어요', '참가 요청 상태를 다시 확인해 주세요.');
    } finally { setFriendBusy(false); }
  };

  const saveOotd = async () => {
    if (!mineUri) return;
    setOperationBusy(true);
    const id = recordId(today, mode, normalizedCode);

    try {
      if (mode === 'friend') {
        if (!matchingFriendSession || !matchingFriendState || matchingFriendState.status !== 'active') {
          throw new Error('friend_not_active');
        }
        const ownVersion = matchingFriendState.photos.find((photo) => photo.slot === matchingFriendSession.slot)?.version ?? 0;
        const uploaded = await uploadOwnFriendPhoto(matchingFriendSession, mineUploadUri ?? mineUri, ownVersion);
        setFriendState({
          ...matchingFriendState,
          photos: [
            ...matchingFriendState.photos.filter((photo) => photo.slot !== matchingFriendSession.slot),
            { slot: matchingFriendSession.slot, version: uploaded.version, available: true },
          ],
        });
        if (!friendUri) {
          Alert.alert('내 사진을 올렸어요', '친구가 사진을 올리면 이 화면에 자동으로 나타나요.');
          return;
        }
      }
      const savedMineUri = mineUri === todayRecord?.photoUri ? mineUri : await copyPhoto(mineUri, `${id}-mine`);
      const savedFriendUri =
        mode === 'friend' && friendUri
          ? await copyPhoto(friendUri, `${id}-friend`)
          : undefined;
      const record: OotdRecord = {
        id,
        dateKey: today,
        mode,
        friendCode: mode === 'friend' ? normalizedCode : undefined,
        colorId: color.id,
        photoUri: savedMineUri,
        partnerPhotoUri: savedFriendUri,
        createdAt: new Date().toISOString(),
      };
      setRecords(await upsertRecord(record));
      setActiveRecord(record);
      setScreen('share');
    } catch {
      Alert.alert('사진을 저장하지 못했어요', '기기 저장 공간을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setOperationBusy(false);
    }
  };

  const confirmDelete = (record: OotdRecord) => {
    Alert.alert('이 기록을 삭제할까요?', '사진과 기록이 이 기기에서 완전히 삭제됩니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setOperationBusy(true);
          try {
            setRecords(await removeRecord(record));
          } catch {
            Alert.alert('삭제하지 못했어요', '잠시 후 다시 시도해 주세요.');
          } finally {
            setOperationBusy(false);
          }
        },
      },
    ]);
  };

  const confirmDeleteAll = () => {
    Alert.alert('모든 로컬 데이터를 삭제할까요?', '저장된 OOTD 사진과 기록은 복구할 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '모두 삭제',
        style: 'destructive',
        onPress: async () => {
          setOperationBusy(true);
          try {
            await removeAllData();
            setRecords([]);
            setActiveRecord(null);
          } catch {
            Alert.alert('삭제하지 못했어요', '잠시 후 다시 시도해 주세요.');
          } finally {
            setOperationBusy(false);
          }
        },
      },
    ]);
  };

  const navigate = (next: Screen) => {
    if (next === 'capture') openCapture();
    else setScreen(next);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color={THEME.yellowDark} />
        <Text style={styles.loadingText}>Ootique를 준비하고 있어요</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <StatusBar style="dark" />
      {screen === 'today' && (
        <TodayScreen
          mode={mode}
          friendCode={friendCode}
          friendStatus={currentFriendStatus}
          pendingJoin={Boolean(matchingFriendState?.pendingJoin)}
          friendBusy={friendBusy}
          revealed={revealed}
          color={color}
          hasRecord={Boolean(todayRecord)}
          onModeChange={changeMode}
          onFriendCodeChange={(value) => {
            setFriendCode(normalizeFriendCode(value));
            setFriendState(null);
            setFriendUri(null);
            setRevealed(false);
          }}
          onGenerateCode={createPair}
          onJoin={joinPair}
          onPasteCode={pasteFriendCode}
          onApprove={approveJoin}
          onReveal={() => {
            if (mode === 'friend' && normalizedCode.length !== 6) {
              Alert.alert('친구 코드가 필요해요', '같은 6자리 코드를 입력하면 같은 컬러가 나와요.');
              return;
            }
            setRevealed(true);
          }}
          onCapture={openCapture}
          onOpenRecord={() => {
            if (todayRecord) {
              setActiveRecord(todayRecord);
              setScreen('share');
            }
          }}
        />
      )}
      {screen === 'capture' && (
        <CaptureScreen
          mode={mode}
          colorName={color.name}
          mineUri={mineUri}
          friendUri={friendUri}
          friendStatus={currentFriendStatus}
          busy={busy}
          onBack={() => setScreen('today')}
          onChoose={choosePhoto}
          onSave={saveOotd}
        />
      )}
      {screen === 'share' && activeRecord && (
        <ShareScreen
          record={activeRecord}
          onBack={() => setScreen('today')}
          onHistory={() => setScreen('history')}
        />
      )}
      {screen === 'history' && (
        <HistoryScreen
          isPlus={isPlus}
          plusPrice={products.find((product) => product.id === PLUS_PRODUCT_ID)?.displayPrice ?? '4,900원'}
          purchaseBusy={purchaseBusy}
          storeConnected={storeConnected}
          records={records}
          onBuyPlus={buyPlus}
          onOpen={(record) => {
            setActiveRecord(record);
            setScreen('share');
          }}
          onDelete={confirmDelete}
          onDeleteAll={confirmDeleteAll}
          onRestorePlus={restorePlus}
        />
      )}
      {(screen === 'today' || screen === 'history') && (
        <BottomNav active={screen} onNavigate={navigate} />
      )}
    </SafeAreaView>
  );
}

type TodayScreenProps = {
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

function TodayScreen(props: TodayScreenProps) {
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

function BrandHeader() {
  return (
    <View style={styles.brandHeader}>
      <Text style={styles.brand}>ootique</Text>
      <Text style={styles.brandTagline}>SPIN YOUR STYLE</Text>
    </View>
  );
}

function RouletteMachine({ color }: { color?: string }) {
  return (
    <View accessibilityLabel="빈티지 컬러 룰렛" style={styles.machineShell}>
      <View style={styles.machineLabel}>
        <Text style={styles.machineLabelText}>✦ COLOR ROULETTE MACHINE ✦</Text>
      </View>
      <View style={styles.reelWindow}>
        {OOTIQUE_COLORS.slice(0, 8).map((item) => (
          <View key={item.id} style={[styles.reel, { backgroundColor: item.hex }]} />
        ))}
        <View style={styles.selector}>
          <View style={[styles.selectorColor, { backgroundColor: color ?? THEME.surface }]} />
        </View>
      </View>
      <View style={styles.machineControls}>
        <View style={styles.smallLight} />
        <View style={[styles.smallLight, { backgroundColor: THEME.yellow }]} />
        <View style={styles.speaker}>
          <View style={styles.speakerLine} />
          <View style={styles.speakerLine} />
          <View style={styles.speakerLine} />
        </View>
        <View style={styles.dial} />
      </View>
    </View>
  );
}

type CaptureScreenProps = {
  mode: ChallengeMode;
  colorName: string;
  mineUri: string | null;
  friendUri: string | null;
  friendStatus: FriendSession['status'] | FriendState['status'] | null;
  busy: boolean;
  onBack: () => void;
  onChoose: (target: PhotoTarget, source: 'camera' | 'library') => void;
  onSave: () => void;
};

function CaptureScreen(props: CaptureScreenProps) {
  const canSave = Boolean(props.mineUri && (props.mode === 'solo' || props.friendStatus === 'active'));
  return (
    <ScrollView contentContainerStyle={styles.captureContent}>
      <ScreenHeader title="오늘의 OOTD" onBack={props.onBack} />
      <Text style={styles.captureGuide}>{props.colorName}을 살린 옷을 보여주세요.</Text>
      <PhotoFrame label="내 OOTD" uri={props.mineUri} />
      <View style={styles.actionRow}>
        <SmallButton label="카메라" onPress={() => props.onChoose('mine', 'camera')} />
        <SmallButton label="앨범에서 선택" onPress={() => props.onChoose('mine', 'library')} />
      </View>

      {props.mode === 'friend' && (
        <>
          <PhotoFrame compact label="친구 OOTD" uri={props.friendUri} />
          {!props.friendUri && <Text style={styles.captureGuide}>친구가 사진을 올리면 자동으로 표시돼요.</Text>}
        </>
      )}

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
        {props.mode === 'friend' ? '친구 모드 사진은 연결된 두 사람만 볼 수 있게 전송됩니다.' : '사진은 서버로 전송되지 않고 이 기기에만 저장됩니다.'}
      </Text>
    </ScrollView>
  );
}

function PhotoFrame({ compact = false, label, uri }: { compact?: boolean; label: string; uri: string | null }) {
  return (
    <View style={[styles.photoFrame, compact && styles.compactPhotoFrame]}>
      {uri ? (
        <Image accessibilityLabel={label} resizeMode="cover" source={{ uri }} style={styles.photo} />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderMark}>＋</Text>
          <Text style={styles.photoPlaceholderText}>{label}</Text>
        </View>
      )}
    </View>
  );
}

function ShareScreen({ record, onBack, onHistory }: { record: OotdRecord; onBack: () => void; onHistory: () => void }) {
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

type HistoryScreenProps = {
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

function HistoryScreen({
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

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
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

function SegmentButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
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

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.smallButton}>
      <Text style={styles.smallButtonText}>{label}</Text>
    </Pressable>
  );
}

function BottomNav({ active, onNavigate }: { active: Screen; onNavigate: (screen: Screen) => void }) {
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

const shadow = {
  shadowColor: '#6D604A',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 10,
  elevation: 3,
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: THEME.background },
  screen: { flex: 1 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.background },
  loadingText: { marginTop: 12, color: THEME.muted, fontSize: 14 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 110 },
  brandHeader: { alignItems: 'center', marginBottom: 18 },
  brand: { color: THEME.ink, fontSize: 36, fontWeight: '800', letterSpacing: -2 },
  brandTagline: { color: THEME.yellowDark, fontSize: 10, fontWeight: '700', letterSpacing: 2.2, marginTop: 2 },
  segment: { alignSelf: 'center', backgroundColor: '#EDE9E1', borderRadius: 22, flexDirection: 'row', padding: 4 },
  segmentButton: { borderRadius: 18, paddingHorizontal: 26, paddingVertical: 9 },
  segmentButtonActive: { backgroundColor: THEME.surface, ...shadow },
  segmentText: { color: THEME.muted, fontSize: 14, fontWeight: '600' },
  segmentTextActive: { color: THEME.ink },
  codeCard: { backgroundColor: THEME.surface, borderColor: THEME.line, borderRadius: 20, borderWidth: 1, marginTop: 16, padding: 16, ...shadow },
  eyebrow: { color: THEME.yellowDark, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  codeHint: { color: THEME.muted, fontSize: 12, marginTop: 4 },
  codeRow: { marginTop: 12 },
  codeInput: { backgroundColor: THEME.background, borderColor: THEME.line, borderRadius: 12, borderWidth: 1, color: THEME.ink, flex: 1, fontSize: 18, fontWeight: '800', letterSpacing: 3, paddingHorizontal: 14, paddingVertical: 10 },
  codeLength: { color: THEME.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  codeActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 8 },
  sectionTitle: { color: THEME.ink, fontSize: 24, fontWeight: '800', marginTop: 24, textAlign: 'center' },
  sectionSubtitle: { color: THEME.muted, fontSize: 13, marginBottom: 16, marginTop: 5, textAlign: 'center' },
  machineShell: { backgroundColor: '#FFF3C8', borderColor: '#E4CF8C', borderRadius: 28, borderWidth: 2, padding: 12, ...shadow },
  machineLabel: { alignItems: 'center', paddingBottom: 10 },
  machineLabelText: { color: '#6F5B20', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  reelWindow: { alignItems: 'stretch', backgroundColor: '#D8CDB4', borderColor: '#B5A27B', borderRadius: 18, borderWidth: 5, flexDirection: 'row', height: 190, justifyContent: 'center', overflow: 'hidden', padding: 7, position: 'relative' },
  reel: { borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1, flex: 1 },
  selector: { alignItems: 'center', backgroundColor: '#F9F6EE', borderColor: '#D6CDB9', borderRadius: 15, borderWidth: 2, height: 82, justifyContent: 'center', left: '39%', padding: 9, position: 'absolute', top: 50, width: '22%', ...shadow },
  selectorColor: { borderColor: '#D7CCB6', borderRadius: 8, borderWidth: 1, height: '100%', width: '100%' },
  machineControls: { alignItems: 'center', flexDirection: 'row', height: 50, paddingHorizontal: 8, paddingTop: 10 },
  smallLight: { backgroundColor: '#E99B8F', borderColor: '#A76C62', borderRadius: 8, borderWidth: 1, height: 16, marginRight: 8, width: 16 },
  speaker: { gap: 4, marginLeft: 10 },
  speakerLine: { backgroundColor: '#9E8954', borderRadius: 2, height: 3, width: 44 },
  dial: { backgroundColor: '#F7F2E8', borderColor: '#A99565', borderRadius: 18, borderWidth: 2, height: 36, marginLeft: 'auto', width: 36 },
  resultCard: { alignItems: 'center', backgroundColor: THEME.surface, borderColor: THEME.line, borderRadius: 22, borderWidth: 1, flexDirection: 'row', marginTop: 16, padding: 16, ...shadow },
  largeSwatch: { borderRadius: 18, height: 92, width: 92 },
  resultCopy: { flex: 1, marginLeft: 16 },
  colorName: { color: THEME.ink, fontSize: 25, fontWeight: '800', marginTop: 4 },
  colorMood: { color: THEME.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  primaryButton: { alignItems: 'center', backgroundColor: THEME.yellow, borderColor: '#DDBA4E', borderRadius: 16, borderWidth: 1, justifyContent: 'center', marginTop: 16, minHeight: 54, paddingHorizontal: 18, ...shadow },
  primaryButtonText: { color: THEME.ink, fontSize: 16, fontWeight: '800' },
  disabledButton: { opacity: 0.42 },
  smallButton: { alignItems: 'center', backgroundColor: THEME.surface, borderColor: THEME.line, borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  smallButtonText: { color: THEME.ink, fontSize: 13, fontWeight: '700' },
  captureContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 42 },
  screenHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  backButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  backButtonText: { color: THEME.ink, fontSize: 36, lineHeight: 38 },
  screenHeaderTitle: { color: THEME.ink, fontSize: 20, fontWeight: '800' },
  headerSpacer: { width: 44 },
  captureGuide: { color: THEME.muted, fontSize: 14, marginBottom: 16, textAlign: 'center' },
  photoFrame: { aspectRatio: 4 / 5, backgroundColor: '#EFEAE1', borderColor: THEME.line, borderRadius: 24, borderWidth: 1, overflow: 'hidden', ...shadow },
  compactPhotoFrame: { alignSelf: 'center', marginTop: 24, width: '62%' },
  photo: { height: '100%', width: '100%' },
  photoPlaceholder: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  photoPlaceholderMark: { color: '#A79E91', fontSize: 42, fontWeight: '200' },
  photoPlaceholderText: { color: THEME.muted, fontSize: 14, fontWeight: '700', marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 14 },
  localOnly: { color: THEME.muted, fontSize: 11, lineHeight: 17, marginTop: 12, textAlign: 'center' },
  shareContent: { alignItems: 'stretch', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 42 },
  shareCard: { aspectRatio: 4 / 5, backgroundColor: '#FFF9E9', borderColor: '#D9C998', borderRadius: 22, borderWidth: 1, overflow: 'hidden', padding: 20 },
  shareBrandRow: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  shareBrand: { color: THEME.ink, fontSize: 28, fontWeight: '900', letterSpacing: -1.5 },
  shareDate: { color: THEME.muted, fontSize: 11, fontWeight: '600' },
  soloPhoto: { flex: 1, marginVertical: 14, overflow: 'hidden' },
  friendPhotos: { flex: 1, flexDirection: 'row', gap: 7, marginVertical: 14, overflow: 'hidden' },
  sharePhoto: { borderRadius: 14, flex: 1, height: '100%', resizeMode: 'cover' },
  shareResultRow: { alignItems: 'center', flexDirection: 'row' },
  shareSwatch: { borderRadius: 14, height: 56, width: 56 },
  shareResultCopy: { marginLeft: 12 },
  shareEyebrow: { color: THEME.yellowDark, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  shareColorName: { color: THEME.ink, fontSize: 22, fontWeight: '900', marginTop: 2 },
  shareQuestion: { color: THEME.ink, fontSize: 15, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  shareCode: { color: THEME.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, marginTop: 7, textAlign: 'center' },
  secondaryButton: { alignItems: 'center', borderColor: THEME.line, borderRadius: 16, borderWidth: 1, justifyContent: 'center', marginTop: 10, minHeight: 50 },
  secondaryButtonText: { color: THEME.ink, fontSize: 14, fontWeight: '700' },
  historyContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 120 },
  plusCard: { backgroundColor: '#FFF3C8', borderColor: '#E4CF8C', borderRadius: 20, borderWidth: 1, marginTop: 16, padding: 18, ...shadow },
  plusEyebrow: { color: THEME.yellowDark, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  plusTitle: { color: THEME.ink, fontSize: 18, fontWeight: '800', marginTop: 6 },
  plusText: { color: THEME.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  plusButton: { alignItems: 'center', backgroundColor: THEME.yellow, borderRadius: 14, marginTop: 14, minHeight: 46, justifyContent: 'center', paddingHorizontal: 16 },
  plusButtonText: { color: THEME.ink, fontSize: 15, fontWeight: '800' },
  restoreText: { color: THEME.yellowDark, fontSize: 13, fontWeight: '700', marginTop: 13, textAlign: 'center', textDecorationLine: 'underline' },
  emptyCard: { alignItems: 'center', backgroundColor: THEME.surface, borderColor: THEME.line, borderRadius: 20, borderWidth: 1, marginTop: 18, padding: 28 },
  emptyTitle: { color: THEME.ink, fontSize: 16, fontWeight: '800' },
  emptyText: { color: THEME.muted, fontSize: 13, marginTop: 7, textAlign: 'center' },
  historyCard: { backgroundColor: THEME.surface, borderColor: THEME.line, borderRadius: 18, borderWidth: 1, marginTop: 12, overflow: 'hidden', ...shadow },
  historyMain: { alignItems: 'center', flexDirection: 'row', padding: 12 },
  historyImage: { borderRadius: 12, height: 70, width: 56 },
  historyCopy: { flex: 1, marginLeft: 12 },
  historyDate: { color: THEME.muted, fontSize: 11 },
  historyColor: { color: THEME.ink, fontSize: 17, fontWeight: '800', marginTop: 3 },
  historyMode: { color: THEME.muted, fontSize: 12, marginTop: 2 },
  historySwatch: { borderRadius: 12, height: 42, width: 42 },
  deleteButton: { alignItems: 'center', borderTopColor: THEME.line, borderTopWidth: 1, paddingVertical: 10 },
  deleteButtonText: { color: '#A1493E', fontSize: 12, fontWeight: '700' },
  privacyCard: { backgroundColor: '#F2EEE5', borderRadius: 18, marginTop: 24, padding: 18 },
  privacyTitle: { color: THEME.ink, fontSize: 16, fontWeight: '800' },
  privacyText: { color: THEME.muted, fontSize: 12, lineHeight: 19, marginTop: 7 },
  deleteAllButton: { alignItems: 'center', borderColor: '#D9B7B0', borderRadius: 12, borderWidth: 1, marginTop: 14, padding: 11 },
  deleteAllText: { color: '#983F34', fontSize: 12, fontWeight: '800' },
  bottomNav: { backgroundColor: 'rgba(255,255,255,0.97)', borderTopColor: THEME.line, borderTopWidth: 1, bottom: 0, flexDirection: 'row', left: 0, paddingTop: 8, position: 'absolute', right: 0 },
  navItem: { alignItems: 'center', flex: 1, minHeight: 48 },
  navMark: { color: THEME.muted, fontSize: 23, lineHeight: 26 },
  navLabel: { color: THEME.muted, fontSize: 11, marginTop: 2 },
  navActive: { color: THEME.yellowDark, fontWeight: '800' },
});
