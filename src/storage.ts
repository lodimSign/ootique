import * as FileSystem from 'expo-file-system/legacy';

import type { OotdRecord } from './domain';

const ROOT_DIRECTORY = `${FileSystem.documentDirectory}ootique/`;
const PHOTO_DIRECTORY = `${ROOT_DIRECTORY}photos/`;
const RECORDS_FILE = `${ROOT_DIRECTORY}records.json`;

async function ensureStorage(): Promise<void> {
  await FileSystem.makeDirectoryAsync(PHOTO_DIRECTORY, { intermediates: true });
}

export async function loadRecords(): Promise<OotdRecord[]> {
  await ensureStorage();
  const info = await FileSystem.getInfoAsync(RECORDS_FILE);
  if (!info.exists) return [];

  const contents = await FileSystem.readAsStringAsync(RECORDS_FILE);
  const records: unknown = JSON.parse(contents);
  if (!Array.isArray(records)) throw new Error('Stored Ootique records are invalid.');
  return records as OotdRecord[];
}

async function writeRecords(records: OotdRecord[]): Promise<void> {
  await ensureStorage();
  await FileSystem.writeAsStringAsync(RECORDS_FILE, JSON.stringify(records));
}

export async function copyPhoto(sourceUri: string, fileName: string): Promise<string> {
  await ensureStorage();
  const destination = `${PHOTO_DIRECTORY}${fileName}.jpg`;
  await FileSystem.deleteAsync(destination, { idempotent: true });
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}

// 친구 사진은 인증 헤더가 있어야 열리는 서버 URL이다. 화면에 URL을 그대로 넘기면
// 세션이 끝난 뒤 기록에서 열리지 않으므로, 받는 즉시 기기 파일로 저장하고 그 경로만 쓴다.
export async function downloadPhoto(
  source: { uri: string; headers: Record<string, string> },
  fileName: string,
): Promise<string> {
  await ensureStorage();
  const destination = `${PHOTO_DIRECTORY}${fileName}.jpg`;
  const existing = await FileSystem.getInfoAsync(destination);
  if (existing.exists) return destination;

  const result = await FileSystem.downloadAsync(source.uri, destination, { headers: source.headers });
  if (result.status !== 200) {
    await FileSystem.deleteAsync(destination, { idempotent: true });
    throw new Error('photo_download_failed');
  }
  return destination;
}

export async function writeTemporaryJpeg(base64: string): Promise<string> {
  const destination = `${FileSystem.cacheDirectory}ootique-friend-upload.jpg`;
  await FileSystem.writeAsStringAsync(destination, base64, { encoding: FileSystem.EncodingType.Base64 });
  return destination;
}

export async function upsertRecord(record: OotdRecord): Promise<OotdRecord[]> {
  const records = await loadRecords();
  const nextRecords = [record, ...records.filter((item) => item.id !== record.id)].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  await writeRecords(nextRecords);
  return nextRecords;
}

export async function removeRecord(record: OotdRecord): Promise<OotdRecord[]> {
  const nextRecords = (await loadRecords()).filter((item) => item.id !== record.id);
  await writeRecords(nextRecords);
  await Promise.all([
    FileSystem.deleteAsync(record.photoUri, { idempotent: true }),
    record.partnerPhotoUri
      ? FileSystem.deleteAsync(record.partnerPhotoUri, { idempotent: true })
      : Promise.resolve(),
  ]);
  return nextRecords;
}

export async function pruneExpiredRecords(cutoffKey: string): Promise<OotdRecord[]> {
  const records = await loadRecords();
  const retained = records.filter((record) => record.dateKey >= cutoffKey);

  if (retained.length !== records.length) await writeRecords(retained);

  const retainedPhotos = new Set(
    retained.flatMap((record) => [record.photoUri, record.partnerPhotoUri].filter(Boolean)),
  );
  const photoNames = await FileSystem.readDirectoryAsync(PHOTO_DIRECTORY);
  await Promise.all(
    photoNames
      .map((name) => `${PHOTO_DIRECTORY}${name}`)
      .filter((uri) => !retainedPhotos.has(uri))
      .map((uri) => FileSystem.deleteAsync(uri, { idempotent: true })),
  );
  return retained;
}

export async function removeAllData(): Promise<void> {
  await FileSystem.deleteAsync(ROOT_DIRECTORY, { idempotent: true });
}
