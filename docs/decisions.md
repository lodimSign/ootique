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
