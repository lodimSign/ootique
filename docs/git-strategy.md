# Ootique Git 전략 및 커밋 컨벤션 (git-strategy.md)

> **최종 갱신**: 2026-08-04  
> **기준 저장소**: `c:\workspace\projects\ootique`  

---

## 1. 1인 개발 Git 브랜치 전략

- **`main`**: 상용 배포 가능 버전 (EAS Production Build 및 App Store 심사 제출 제출용)
- **`develop`**: 작업 통합 및 검증 브랜치 (일일 개발 및 빌드 검증 기준)
- **`feature/<기능명>`**: 단일 기능 구현 전용 브랜치 (작업 완료 후 `develop`에 머지)

---

## 2. 커밋 메시지 컨벤션 (Commit Convention)

커밋 메시지는 변경 목적을 명확히 하고 추후 추적이 용이하도록 다음 접두사를 사용합니다:

- `feat:` 새로운 기능 추가 (예: `feat: 6자리 친구 코드 자동 폴링 추가`)
- `fix:` 버그 수정 (예: `fix: iOS safe area 하단 여백 보정`)
- `refactor:` 코드 구조 개선 및 모듈화 (예: `refactor: App.tsx 컴포넌트 분리`)
- `docs:` 문서 관련 수정 (예: `docs: spec.md 및 앱 출시 매뉴얼 작성`)
- `chore:` 빌드 설정, 라이브러리 업데이트 등 (예: `chore: expo-iap 설정 검증`)

---

## 3. 배포 태그 (Release Tagging)

EAS Production 빌드 제출 시 버전을 명시적으로 태깅합니다:
```bash
git tag -a v1.0.0 -m "Ootique iOS Initial App Store Submission"
git push origin v1.0.0
```
