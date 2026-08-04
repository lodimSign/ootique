# Ootique 기술 및 비즈니스 의사결정 기록 (decisions.md)

> **최종 갱신**: 2026-08-04  
> **기준 저장소**: `c:\workspace\projects\ootique`  

---

## 1. 주요 의사결정 (Key Decisions Log)

### ADR-001: Expo SDK 54 채택 (iOS Expo Go 호환)
- **배경**: 2026-08-03 기준 iPhone App Store의 Expo Go 앱은 SDK 54를 지원.
- **결정**: SDK 57/58 대신 SDK 54로 전환하여 실기기 Expo Go 테스트 환경을 즉시 확보함.
- **영향**: `react-native-safe-area-context` 5.6 버전 적용, 안정적인 iOS 번들링 확인.

### ADR-002: Supabase SDK 대신 표준 `fetch` REST 통신
- **배경**: 번들 크기 최소화 및 1인 개발 얇은 레이어유지.
- **결정**: `@supabase/supabase-js` 중량 패키지 대신 Supabase Edge Functions로의 표준 `fetch` 통신 채택.
- **영향**: 종속성 슬림화 및 Edge Function 기반의 정교한 인증/파일 서빙 제어.

### ADR-003: 서버 없는 영수증 기반 IAP (StoreKit 1회 구매)
- **배경**: 유료 사용자 DB 구축 비용 및 계정 관리 오버헤드 최소화 (무료 자본 원칙).
- **결정**: Apple StoreKit의 `com.lodim.ootique.plus` 4,900원 비소모성 상품 1회 구매 권한판정.
- **영향**: 서버/DB 계정 없이 Apple 영수증 조회로 Plus 기능을 복원하며 로컬 데이터 정리 면제.

### ADR-004: 1개 파일 1개 컴포넌트 구조화 및 과도한 추상화 금지
- **배경**: 복잡한 추상화나 거대한 단일 파일(monolithic file)은 AI 및 개발자의 수정을 어렵게 만듦.
- **결정**: 모든 UI 컴포넌트는 `src/components/` 디렉터리 내 독립된 파일로 분리하고, 직관적인 모듈화를 유지.
- **이행**: 2026-08-04에 `App.tsx` 1,200줄을 592줄로 줄이고 화면 4개와 공용 조각을 파일로 분리했다.

### ADR-005: 25줄 미만 공용 조각은 `src/components/ui.tsx` 하나에 모은다
- **배경**: ADR-004를 글자 그대로 지키면 8줄짜리 `SmallButton`에도 파일이 하나씩 생긴다. import만 늘고 읽기는 더 나빠진다.
- **결정**: 25줄 미만이면서 여러 화면이 함께 쓰는 조각은 `ui.tsx` 한 파일에 모은다.
  현재 `BrandHeader`, `ScreenHeader`, `SegmentButton`, `SmallButton`, `BottomNav`, `PhotoFrame`이 여기 있다.
- **영향**: 화면 컴포넌트는 ADR-004대로 1파일 1컴포넌트를 지킨다. 조각이 25줄을 넘기면 그때 파일로 뺀다.

### ADR-006: Expo Router를 도입하지 않는다
- **배경**: 김이현 Starter Kit의 표준 구조는 Expo Router 파일 기반 라우팅을 쓴다. 그 구조를 그대로 따를지 검토했다.
- **결정**: 도입하지 않는다. Ootique는 화면 4개를 `useState`로 전환하는 단일 화면 앱이다.
  라우팅 라이브러리를 넣으면 IAP, 5초 폴링, safe area를 전부 다시 배선해야 하고 얻는 것이 없다.
  킷에서 가져온 것은 1파일 1컴포넌트 구조 하나다.
- **재검토 조건**: 화면이 깊은 계층을 갖거나 딥링크가 필요해지면 다시 본다.

### ADR-007: 친구 사진은 URL이 아니라 기기 파일로 보관한다
- **배경**: 친구 사진은 인증 헤더가 있어야 열리는 서버 URL이었다. 화면과 기록이 그 URL을 그대로 들고 있어
  세션이 끝나면 기록에서 열리지 않았고, 파일이 아니라 URL이라 자동 정리의 삭제 대상도 되지 못했다.
- **결정**: 폴링이 `FileSystem.downloadAsync`로 사진을 기기에 받고, 화면과 기록은 `file://` 경로만 쓴다
  (`src/storage.ts`의 `downloadPhoto`). 파일명에 version을 넣어 같은 버전은 다시 받지 않는다.
- **영향**: `Image source.headers` 동작에 의존하지 않는다. `friendHeaders` 상태와 관련 props가 사라졌다.
