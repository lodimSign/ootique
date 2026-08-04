# Ootique 통합 앱 제작 & 애플 앱스토어 출시 마스터 매뉴얼

> **최종 갱신**: 2026-08-04  
> **기준 저장소**: `c:\workspace\projects\ootique`  
> **목적**: 김이현 Starter Kit의 1인 개발 표준 파이프라인과 Ootique의 시나리오 및 배포 자원을 합쳐, 차례대로 검증하고 앱스토어 심사까지 안전하게 완주하는 종합 마스터 매뉴얼입니다.

---

## 📌 규칙 준수 체크리스트 (Always Keep in Mind)

1. **시작 전 필수 읽기**: 코드를 수정하거나 작업을 시작하기 전 반드시 `docs/git-strategy.md`, `docs/spec.md`, `docs/decisions.md`를 읽을 것.
2. **기존 로직 보호**: `docs/spec.md`에 명시된 기존 완성 기능의 로직을 함부로 수정하지 말 것.
3. **1파일 1컴포넌트**: 하나의 파일에는 하나의 컴포넌트만 존재하게 모듈화.
4. **과도한 추상화 금지**: 직관적이고 명확한 TS/TSX 코드 작성.

---

## 🚀 Phase 1. 기본 인프라 및 아키텍처 정립 (Foundation)

- [x] **Expo SDK 54 환경 검증**: `npm run check` 및 `npx expo-doctor` 18/18 통과
- [x] **기본 안전영역(Safe Area)**: `react-native-safe-area-context` 적용으로 iOS Notch 및 안드로이드 시스템 바 미겹침 처리
- [ ] **`App.tsx` 모듈화 (1파일 1컴포넌트)**:
  - 거대한 monolithic UI를 `src/components/`로 분리
  - `RouletteSection.tsx` (오늘의 컬러 룰렛 애니메이션)
  - `PhotoCaptureCard.tsx` (혼자/친구 사진 촬영 및 기기 보관 카드)
  - `FriendCodeModal.tsx` (6자리 코드 생성, 자동 복사, 6/6 입력 및 승인)
  - `PlusBanner.tsx` (Ootique Plus 인앱결제 및 7일 정리 안내)

---

## 🧪 Phase 2. 앱 핵심 시나리오 단계별 수동 검증 (Scenario Verification)

### Step 2.1: 혼자 모드 (Solo Mode)
1. 앱 실행 시 날짜(YYYY-MM-DD) 기반 동일 헥사코드와 컬러 룰렛이 동작하는가?
2. 카메라/앨범에서 사진을 고르고 기기 저장소에 저장되는가?
3. 카드 클릭 시 공유 시트(iOS Share Sheet)가 정상 호출되는가?

### Step 2.2: 친구 동기화 모드 (Friend Sync 6-Digit Code)
1. **사용자 A**: `친구와` 선택 후 6자리 코드 생성 → 클립보드 복사 안내 출력.
2. **사용자 B**: 코드 입력칸에 붙여넣기 (`6/6` 확인) 후 참가 요청.
3. **사용자 A**: 승인 클릭 후 방 상태가 `active`로 전환.
4. **사진 자동 동기화**: A가 사진 등록 시 5초 이내 B 화면의 상대 사진 칸에 자동 표시.
5. **A/B 공유 카드**: 두 사진이 모두 모이면 2인 A/B 결합 공유 카드 생성 버튼 활성화.

### Step 2.3: 로컬 7일 자동 정리 & Ootique Plus 결제
1. **무료 권한**: 최근 7일(오늘 포함) 데이터만 남고 8일째 기록 자동 정리.
2. **Plus 구매 (`com.lodim.ootique.plus` 4,900원)**:
   - 구매 성공 시 `isPlusUser = true` 판정 및 StoreKit 영수증 기록.
   - 8일째 자동 정리 면제 확인.
3. **구매 복원 (Restore)**: 앱 재실행 또는 `구매 복원` 클릭 시 Apple 계정 영수증으로 Plus 상태 복구.

---

## 🎨 Phase 3. 자산 최적화 & Stitch 디자인 반영 (Assets & Polish)

- [ ] **1024×1024 메인 앱 아이콘**: `assets/icon.png` 교체
- [ ] **iOS 스플래시 이미지**: `assets/splash-icon.png` 교체
- [ ] **Stitch 디자인 토큰**: 최종 색상, 로고, 룰렛 자산 UI 테마 적용

---

## 📱 Phase 4. 애플 앱스토어 Connect 심사 제출 (Release & Submission)

### Checklist
1. **App Store Connect 앱 생성**: 번들 ID `com.lodim.ootique`, SKU `ootique-ios-001`
2. **비소모성 인앱결제 생성**: 상품 ID `com.lodim.ootique.plus`, 가격 4,900원, 스크린샷 첨부
3. **EAS Production 빌드**:
   ```bash
   npx eas build --platform ios --profile production
   ```
4. **App Store 제출 & 메타데이터**:
   - `docs/app-store-metadata.md` 내용 입력
   - Privacy Policy & Support URL 연결 (GitHub Pages 또는 전용 지원 페이지)
   - 인앱결제 1회 구매 상품 동시 제출 선택 후 최종 심사 요청.

---

## 🔄 매뉴얼 업데이트 절차 (Manual Update Process)

1. 기능 개발 중 계획이나 비즈니스 로직에 수정이 생기면 **먼저 이 매뉴얼과 `PROJECT_STATUS.md`를 갱신**합니다.
2. 갱신된 내용을 바탕으로 코드 작업을 진행하여 문서와 실증 상태의 불일치를 100% 방지합니다.
