# 제3자 저작물 및 변경 고지

## `jaeseongs95/humanizer-ko`

- 원본 저장소: [jaeseongs95/humanizer-ko](https://github.com/jaeseongs95/humanizer-ko)
- 공개 기준 버전: `v2.0.2`
- 공개 기준 커밋: `3326ce796be98e90ea23c807f36fe0482c14ec09`
- 원본 라이선스: MIT License
- 관계: `blader/humanizer`를 한국어 사용 환경에 맞게 현지화한 비공식 포크

`evals/legacy/`에는 동작 비교를 위해 `humanizer-ko`의 행동 사례, 평가 규약, 100문장 코퍼스와 실패 분석 자료를 포함한다. 일부 자료는 공개 `v2.0.2` 커밋과 같고, 나머지는 그 커밋을 기준으로 작성 중이던 미출시 로컬 작업본에서 복사했다. 이 고지는 `humanizer-ko v2.0.3`이 공개되었거나 태그가 존재한다는 뜻이 아니다.

복사한 파일의 원본 저장소 안 경로, 공개 기준 커밋과 각 snapshot의 SHA-256은 `evals/legacy/provenance.json`에 기록했다. 이 자료는 회귀 평가에만 사용하며 현재 `korean-prose-editor` Skill의 지침이나 정책을 정의하지 않는다. 이 저장소에서 새로 만든 계약, 스크립트와 평가 cycle은 복사 자료와 구분한다.

## `blader/humanizer`

- 원본 저장소: [blader/humanizer](https://github.com/blader/humanizer)
- `humanizer-ko`의 기준 버전: `v3.0.0`
- 기준 커밋: `9862685f575c65a8247f90369951df1b3416e3d6`
- 원저작권자: Copyright (c) 2025 Siqi Chen
- 원본 라이선스: MIT License

현재 실행 코드에 `blader/humanizer`의 소스 코드를 직접 복사하지는 않았다. 다만 `evals/legacy/` 자료가 해당 프로젝트의 현지화 포크를 거쳐 왔으므로 원저작권과 MIT 허가문을 함께 보존한다. 저장소의 `LICENSE`에는 원저작권 고지와 이 프로젝트 기여자 고지를 모두 기록했다.

## 개발 의존성

패키지 관리자가 설치하는 개발 의존성은 이 저장소에 소스 형태로 포함하지 않는다. 각 패키지에는 해당 배포물이 명시한 저작권과 라이선스가 적용된다.
