# Ootique 제작 및 애플 출시 매뉴얼

> **최종 갱신**: 2026-08-04
> **기준 저장소**: `c:\workspace\projects\ootique`
> **범위**: 이 저장소에서 실제로 칠 명령과 통과 기준. 애플 출시 절차 일반론은
> `C:\workspace\260724\REALM\자료\애플 앱스토어 출시 매뉴얼.md` 하나에 있고 여기 복사하지 않는다.

---

## 규칙

1. 작업 전 `docs/git-strategy.md`, `docs/spec.md`, `docs/decisions.md`를 읽는다.
2. `docs/spec.md`의 완성 기능 로직을 함부로 바꾸지 않는다.
3. 1파일 1컴포넌트. 25줄 미만 공용 조각만 `src/components/ui.tsx`에 모은다 (ADR-005).
4. 과도한 추상화 금지. 직관적인 TS/TSX로 쓴다.
5. **자동 검사 통과를 동작 확인이라고 보고하지 않는다.** 아래 검사 종류를 구분한다.
6. **공유 기능에는 앱으로 들어오는 링크를 무조건 같이 보낸다. 링크 없이 나가는 공유는 하나도 두지 않는다.**
   - 기본 버튼은 `Share.share({ message })`로 문구와 링크를 보낸다. 두 OS가 같고 링크가 눌린다.
   - 이미지 파일을 보내는 보조 버튼은 `Sharing.shareAsync`를 쓰는데 **글자를 실을 수 없다.**
     그래서 공유 시트를 열기 전에 링크를 클립보드에 올리고, 닫힌 뒤 복사했다고 알린다.
   - 안드로이드는 한 번에 이미지와 눌리는 링크를 같이 보낼 방법이 없다. `Share.share`의 `url`은
     iOS 전용이라 조용히 빠지고, 메신저 대부분은 이미지에 붙인 글자를 버린다. 위 두 갈래가 최선이다.
   - 공개하지 않은 기록에는 투표 링크가 없다. 그때는 앱 주소(`voteSync.appLink`)를 대신 복사한다.
   주소와 링크 페이지 규칙은 `docs/friend-flow-scenario.md`의 `A단계 실행 스펙` 절에 있다.
7. **모든 사용자 노출 문자열은 다국어(최소 한국어+영어)로 둔다** (2026-08-07 lodim 결정 — 앱스토어는 처음부터 전 세계 노출이라 영어가 있으면 받을 수 있는 시장이 몇 배다).
   - 글자를 화면 코드에 바로 쓰지 않고 `src/i18n.ts`의 사전에 모은다. 기기 언어가 한국어면 한국어, 아니면 영어를 보여준다.
   - 새 화면·새 문구를 추가할 때 두 언어를 같이 넣는다. 한쪽만 넣으면 리뷰에서 되돌린다.
   - 스토어 등록정보(설명·스크린샷 문구)도 두 언어를 만든다 (`docs/app-store-metadata.md`).

---

## 검사 세 종류 — 무엇을 증명하는지 다르다

이걸 섞어서 "잘 동작한다"고 말해 2026-08-03에 하루를 잃었다.

- `npm run check` — **소스와 설정만 본다.** 타입, 도메인 순수함수, 소스 불변식, 출시 설정, Expo Doctor.
  `scripts/friend-sync-check.mjs`는 서버를 호출하지 않는다. 깨진 앱에서도 통과한다.
- `npm run test:friend-sync:e2e` — **배포된 Edge Function을 실제로 호출한다.** 서버가 정상인지 증명한다.
  앱 화면이 맞는지는 증명하지 못한다. 네트워크와 실 프로젝트를 쓴다.
- **두 기기 수동 확인** — 화면에 실제로 보이는지 증명한다. 위 둘로 대체할 수 없다.

```bash
cd c:\workspace\projects\ootique && npm run check
```

```bash
cd c:\workspace\projects\ootique && npm run test:friend-sync:e2e
```

---

## Phase 1. 기반 (완료)

- [x] Expo SDK 54 — iPhone Expo Go 호환. `npx expo-doctor` 18/18
- [x] 안전영역 — `react-native-safe-area-context` 5.6, 안드로이드 실기기 확인
- [x] 날짜 기반 오늘의 컬러, 6자리 친구 코드 규칙
- [x] 카메라·앨범, 기기 내부 사진 보관, 최근 7일 기록
- [x] `expo-iap` 5.0.0, `com.lodim.ootique.plus` 비소모성 구매·복원
- [x] Supabase 친구 동기화 (비공개 Storage, Edge Function, SecureStore 토큰)
- [x] `App.tsx` 모듈화 — `src/theme.ts`, `src/components/`로 분리

---

## Phase 2. 시나리오 수동 검증

### 2.1 혼자 모드

1. 앱 실행 → 같은 날짜에 같은 헥사코드와 룰렛이 나오는가
2. 카메라/앨범에서 사진을 고르면 기기에 저장되는가
3. 공유 카드에서 iOS 공유 시트가 열리는가
4. 앱을 껐다 켜도 기록이 남는가

### 2.2 친구 모드 — **두 기기가 필요하다**

1. A: `친구와` → `코드 만들기` → 클립보드 자동 복사 안내
2. B: `코드 붙여넣기` → `6/6` 표시 → `친구 코드로 연결`
3. A: `친구 참가 승인` → 양쪽 `친구 연결 완료`
4. A가 사진 저장 → **5초 안에 B의 `친구 OOTD` 칸에 자동 표시**
5. B가 사진 저장 → **A의 화면에도 자동 표시**
6. 두 장이 모이면 A/B 공유 카드 버튼이 열리는가
7. 한쪽이 사진을 교체하면 상대 화면도 바뀌는가
8. 앱을 껐다 켜도 저장된 기록의 친구 사진이 열리는가
9. 앨범의 **PNG 스크린샷**과 **고해상도 원본 사진**으로도 5번이 되는가

> 8번이 핵심이다. 친구 사진을 서버 URL로 들고 있으면 세션이 끝난 뒤 안 열린다.
> 2026-08-04에 이 경로를 기기 파일 저장으로 바꿨다 (`downloadPhoto`).
>
> 9번은 2026-08-05에 막혔던 경로다. 서버는 320~4096px 진짜 JPEG만 받는데 앱이 고른 파일을
> 그대로 올려서 PNG와 8160px 원본이 `invalid_photo`로 거절됐다. 지금은 `toUploadJpeg`가
> 올리기 전에 JPEG로 다시 인코딩하고 긴 변을 1600px로 줄인다.
> 실패하면 알림에 서버 오류 코드가 그대로 뜬다 — 그 코드를 그대로 옮겨 적어라.

### 2.3 7일 정리와 Ootique Plus

**Expo Go에서는 결제를 시험할 수 없다.** 개발 빌드가 필요하다.

```bash
cd c:\workspace\projects\ootique && npx eas build --platform ios --profile device
```

1. 무료: 오늘 포함 최근 7일만 남고 8일째 기록이 정리되는가
2. 구매 성공 → `isPlusUser` 판정, 8일째 정리 면제
3. 구매 취소·실패·보류를 각각 구분해 안내하는가
4. `구매 복원` 또는 앱 재실행으로 Plus가 살아나는가

---

## Phase 3. 자산

- [ ] `assets/icon.png` 1024×1024 교체 — **기본 Expo 아이콘으로 제출하면 반려된다.** 알파 채널 없이
- [ ] `assets/splash-icon.png` 교체
- [ ] Stitch 최종 디자인의 색상·로고·룰렛 자산 반영
- [ ] 스크린샷 4장 — 오늘의 컬러 / OOTD 결과 / A/B 공유 카드 / 기록+Plus

```bash
cd c:\workspace\projects\ootique && npm run check:release
```

---

## Phase 4. 출시

절차와 함정은 `자료\애플 앱스토어 출시 매뉴얼.md`에 있다. 이 저장소에서 할 일만 적는다.

- [ ] GitHub `lodimSign/ootique` 저장소 생성, Pages 소스를 `docs/`로 지정
- [ ] `https://lodimsign.github.io/ootique/#privacy` 와 `#support` 가 실제로 열리는지 확인
- [ ] `eas init` — 소유 계정을 개인과 `lodimsigns-team` 중 확정한 뒤
- [ ] App Store Connect 앱 생성 마무리, `com.lodim.ootique.plus` 4,900원 상품 생성
- [ ] `docs/app-store-metadata.md` 내용 입력 — **개인정보 표시는 그 문서의 갱신본을 쓴다**
- [ ] production 빌드 및 제출

```bash
cd c:\workspace\projects\ootique && npx eas build --platform ios --profile production
```

```bash
cd c:\workspace\projects\ootique && npx eas submit --platform ios
```

---

## 매뉴얼 갱신 절차

계획이나 비즈니스 로직이 바뀌면 **코드보다 이 문서와 `PROJECT_STATUS.md`를 먼저 고친다.**
문서와 실제 상태가 어긋나면 다음 세션이 잘못된 전제로 작업한다.

기능을 추가한 날 같이 열어야 하는 문서:

- 서버·저장소·수집 항목이 바뀌면 → `docs/app-store-metadata.md` 개인정보 표시 + `docs/index.html` 처리방침
- 검증 방법이 바뀌면 → 이 문서의 "검사 세 종류"
- 되돌릴 수 없는 결정을 내리면 → `docs/decisions.md`에 ADR 추가
