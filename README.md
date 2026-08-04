# Ootique

하루 한 번 정해진 컬러로 OOTD를 남기고 외부에 공유하는 오프라인 우선 iOS 앱입니다.

## 현재 범위

- 혼자: 날짜마다 하나의 컬러를 고정해서 제공
- 친구와: 같은 날짜와 6자리 코드에 같은 컬러 제공
- 카메라 또는 사진 보관함에서 4:5 OOTD 구성
- 친구 모드의 두 사진 A/B 공유 카드
- 무료 최근 7일 기록과 Ootique Plus 전체 로컬 기록 보관
- Apple 비소모성 1회 구매와 구매 복원
- 계정, 서버, AI, 광고, 앱 내부 투표 없음

## 실행과 검사

```powershell
cd C:\workspace\projects\ootique; npm start
cd C:\workspace\projects\ootique; npm run check
```

## 디자인 교체 지점

- 색상과 공통 UI 스타일: `App.tsx`의 `THEME`와 `styles`
- 임시 룰렛: `App.tsx`의 `RouletteMachine`
- 최종 아이콘과 스플래시: `assets/`
- 색상 목록과 결정 규칙: `src/domain.ts`

최종 Stitch 결과는 화면 전체를 복사하지 않고 룰렛 자산, 로고, 색상 토큰 순서로 반영합니다.
