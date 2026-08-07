import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { finishTransaction, useIAP } from 'expo-iap';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Text,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  type ChallengeMode,
  type OotdRecord,
  type Screen,
  colorForChallenge,
  freeRetentionCutoffKey,
  friendSessionMatchesCode,
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
  toThumbJpeg,
  toUploadJpeg,
  upsertRecord,
} from './src/storage';
import { publishEntry, unpublishEntry } from './src/voteSync';
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
import { t, tf } from './src/i18n';
import { THEME, styles } from './src/theme';
import { BottomNav } from './src/components/ui';
import { TodayScreen } from './src/components/TodayScreen';
import { CaptureScreen } from './src/components/CaptureScreen';
import { ShareScreen } from './src/components/ShareScreen';
import { HistoryScreen } from './src/components/HistoryScreen';

type PhotoTarget = 'mine' | 'friend';


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
  // 공개는 사용자가 직접 켜는 opt-in이고 저장할 때마다 다시 꺼진다.
  const [publicOptIn, setPublicOptIn] = useState(false);
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
        Alert.alert(t('plus.unlockedTitle'), t('plus.unlockedBody'));
      } catch {
        Alert.alert(t('plus.finishFailTitle'), t('plus.finishFailBody'));
      } finally {
        setPurchaseBusy(false);
      }
    },
    onPurchaseError: (error) => {
      setPurchaseBusy(false);
      const message = purchaseErrorMessage(error.code ?? 'unknown');
      if (message) Alert.alert(t('plus.errorTitle'), message);
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
      .catch(() => Alert.alert(t('app.loadFailTitle'), t('app.loadFailBody')))
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
        purchased ? t('plus.restoredTitle') : t('plus.noRestoreTitle'),
        purchased ? t('plus.restoredBody') : t('plus.noRestoreBody'),
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
        Alert.alert(t('app.pruneFailTitle'), t('app.pruneFailBody'));
      })
      .finally(() => {
        setOperationBusy(false);
        setLoading(false);
      });
  }, [availablePurchases, purchaseChecked, recordsLoaded, retentionDate]);

  const buyPlus = async () => {
    if (!storeConnected) {
      Alert.alert(t('plus.storeOfflineTitle'), t('common.retryLater'));
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
      Alert.alert(t('plus.buyStartFailTitle'), t('common.retryLater'));
    }
  };

  const restorePlus = async () => {
    if (!storeConnected) {
      Alert.alert(t('plus.storeOfflineTitle'), t('common.retryLater'));
      return;
    }
    restoring.current = true;
    setPurchaseBusy(true);
    try {
      await restorePurchases();
    } catch {
      restoring.current = false;
      setPurchaseBusy(false);
      Alert.alert(t('plus.restoreFailTitle'), t('common.checkNetworkRetry'));
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
      Alert.alert(t('friend.codeNeededTitle'), t('friend.codeNeededEnterOrCreate'));
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
          Alert.alert(t('capture.cameraPermTitle'), t('capture.cameraPermBody'));
          return;
        }
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
              quality: 0.9,
            });

      if (!result.canceled) {
        if (target === 'mine') {
          setMineUri(result.assets[0].uri);
          setMineUploadUri(mode === 'friend' ? await toUploadJpeg(result.assets[0].uri) : null);
        }
        else setFriendUri(result.assets[0].uri);
      }
    } catch {
      Alert.alert(t('capture.photoOpenFailTitle'), t('common.retryLater'));
    }
  };

  const createPair = async () => {
    if (!friendSyncConfigured) {
      Alert.alert(t('friend.notConfiguredTitle'), t('friend.notConfiguredBody'));
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
          .then(() => Alert.alert(t('friend.codeCopiedTitle'), t('friend.codeCopiedBody')))
          .catch(() => Alert.alert(t('friend.codeMadeNoCopyTitle'), t('friend.codeMadeNoCopyBody')));
      }
    } catch {
      Alert.alert(t('friend.codeCreateFailTitle'), t('common.checkNetworkRetry'));
    } finally { setFriendBusy(false); }
  };

  const joinPair = async () => {
    if (normalizedCode.length !== 6) {
      Alert.alert(t('friend.codeNeededTitle'), t('friend.codeNeededFromFriend'));
      return;
    }
    setFriendBusy(true);
    try {
      const session = await joinFriendPair(normalizedCode);
      setFriendSession(session);
      setFriendState(null);
      setFriendUri(null);
      Alert.alert(t('friend.joinSentTitle'), t('friend.joinSentBody'));
    } catch {
      Alert.alert(t('friend.joinFailTitle'), t('friend.joinFailBody'));
    } finally { setFriendBusy(false); }
  };

  const pasteFriendCode = async () => {
    try {
      const pasted = normalizeFriendCode(await Clipboard.getStringAsync());
      setFriendCode(pasted);
      setRevealed(false);
      if (pasted.length !== 6) {
        Alert.alert(t('friend.pasteNot6Title'), tf('friend.pasteNot6Body', { n: pasted.length }));
      }
    } catch {
      Alert.alert(t('friend.pasteFailTitle'), t('friend.pasteFailBody'));
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
      Alert.alert(t('friend.approveFailTitle'), t('friend.approveFailBody'));
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
          Alert.alert(t('save.uploadedMineTitle'), t('save.uploadedMineBody'));
          return;
        }
      }
      const savedMineUri = mineUri === todayRecord?.photoUri ? mineUri : await copyPhoto(mineUri, `${id}-mine`);
      const savedFriendUri =
        mode === 'friend' && friendUri
          ? await copyPhoto(friendUri, `${id}-friend`)
          : undefined;
      // 공개를 켠 사진만 서버로 올라간다. 실패해도 기기 기록은 남긴다 — 저장을 통째로 잃는 것이 더 나쁘다.
      let published: { entryId: string; shareToken: string; matchShareToken: string | null } | null = null;
      if (publicOptIn) {
        try {
          published = await publishEntry({
            photoUri: mineUploadUri ?? (await toUploadJpeg(mineUri)),
            thumbUri: await toThumbJpeg(mineUri),
            colorId: color.id,
            pairId: mode === 'friend' ? matchingFriendSession?.pairId : undefined,
            slot: mode === 'friend' ? matchingFriendSession?.slot : undefined,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          Alert.alert(t('save.publishFailTitle'), tf('save.publishFailBody', { reason }));
        }
      }

      const record: OotdRecord = {
        id,
        dateKey: today,
        mode,
        friendCode: mode === 'friend' ? normalizedCode : undefined,
        colorId: color.id,
        photoUri: savedMineUri,
        partnerPhotoUri: savedFriendUri,
        createdAt: new Date().toISOString(),
        publicEntryId: published?.entryId,
        shareToken: published ? published.matchShareToken ?? published.shareToken : undefined,
      };
      setRecords(await upsertRecord(record));
      setActiveRecord(record);
      setPublicOptIn(false);
      setScreen('share');
    } catch (error) {
      // 원인을 삼키면 실기기에서 서버 거절(invalid_photo 등)과 기기 저장 실패를 구분할 수 없다.
      const reason = error instanceof Error ? error.message : String(error);
      Alert.alert(t('save.failTitle'), tf('save.failBody', { reason }));
    } finally {
      setOperationBusy(false);
    }
  };

  const unpublishActive = async () => {
    if (!activeRecord?.publicEntryId) return;
    await unpublishEntry(activeRecord.publicEntryId);
    const next: OotdRecord = { ...activeRecord, publicEntryId: undefined, shareToken: undefined };
    setRecords(await upsertRecord(next));
    setActiveRecord(next);
  };

  const confirmDelete = (record: OotdRecord) => {
    Alert.alert(t('history.deleteConfirmTitle'), t('history.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setOperationBusy(true);
          try {
            // 기기에서 지웠는데 서버에 공개본이 남아 있으면 안 된다. 실패해도 로컬 삭제는 진행한다.
            if (record.publicEntryId) await unpublishEntry(record.publicEntryId).catch(() => {});
            setRecords(await removeRecord(record));
          } catch {
            Alert.alert(t('history.deleteFailTitle'), t('common.retryLater'));
          } finally {
            setOperationBusy(false);
          }
        },
      },
    ]);
  };

  const confirmDeleteAll = () => {
    Alert.alert(t('history.deleteAllConfirmTitle'), t('history.deleteAllConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('history.deleteAllAction'),
        style: 'destructive',
        onPress: async () => {
          setOperationBusy(true);
          try {
            await Promise.all(records
              .filter((item) => item.publicEntryId)
              .map((item) => unpublishEntry(item.publicEntryId!).catch(() => {})));
            await removeAllData();
            setRecords([]);
            setActiveRecord(null);
          } catch {
            Alert.alert(t('history.deleteFailTitle'), t('common.retryLater'));
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
        <Text style={styles.loadingText}>{t('app.loading')}</Text>
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
              Alert.alert(t('friend.codeNeededTitle'), t('friend.codeNeededSameColor'));
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
          publicOptIn={publicOptIn}
          onBack={() => setScreen('today')}
          onChoose={choosePhoto}
          onTogglePublic={setPublicOptIn}
          onSave={saveOotd}
        />
      )}
      {screen === 'share' && activeRecord && (
        <ShareScreen
          record={activeRecord}
          onBack={() => setScreen('today')}
          onHistory={() => setScreen('history')}
          onUnpublish={unpublishActive}
        />
      )}
      {screen === 'history' && (
        <HistoryScreen
          isPlus={isPlus}
          plusPrice={products.find((product) => product.id === PLUS_PRODUCT_ID)?.displayPrice ?? t('plus.priceFallback')}
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




