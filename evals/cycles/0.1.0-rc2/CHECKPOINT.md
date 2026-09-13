# 0.1.0 개발 체크포인트

이 체크포인트는 구간 단위 편집 계약과 현재까지의 진단 근거를 보존한다. 릴리스 후보 승인이나 정식 평가 통과를 뜻하지 않는다.

## 고정한 구현

- `source-unit-manifest`, `selection-work-product`, `editing-draft`, `editing-work-product`, `verification-work-product`의 비공개 계약
- selection의 `issueRanges`와 편집 범위 결속
- edit별 `sourceDefect`·`invariantDelta` 검증
- 승인 edit만 적용하고 실패 edit만 원복하는 결정적 finalizer
- digest·actor·범위·보호 문자열 계약 오류의 전체 fallback
- 공개 receipt에 원문·replacement를 남기지 않는 경계
- 후보문에서 diff를 역산하지 않는 구조화 평가 경로

## 고정한 진단 근거

- 알려진 선정 18건과 유지·보류 20건: 세 실행 모두 진단 기준 통과
- 과거 verifier가 거부한 위험 후보 13건: 세 실행 모두 edit별 `retain` 및 원문 복원
- 사용자용 내부 표현 대조 10건: 세 선정자가 각각 10/10 구분
  - 대상은 `영수증 연결` 한 표현에 한정하지 않는다.
  - 내부 구현 은유, 관계가 흐린 명사 연쇄, 행위와 결과를 감춘 추상 표현을 함께 본다.
  - 같은 단어라도 실제 영수증, 기술 문서, 코드나 고정 식별자를 뜻하면 유지한다.

## 고도화로 넘긴 항목

새 편집 후보 11건의 두 번째 선정 시도는 6/11, 11/11, 9/11이었다. 번역투 하위 유형을 구체화한 뒤 균형 대조군 세 실행이 모두 10/10, 세 번째 선정 시도가 모두 11/11을 기록해 선정 재현성은 회복됐다.

세 번째 시도의 독립 편집·검증 결과는 최종 개선 6/11, 2/11, 1/11로 실패했다. 모든 run에서 최종 주요 의미 변화와 보호 문자열 실패는 0건이었지만, verifier가 예상과 의무, 과제와 위험, 조명 비유와 분석 주장 사이의 변화를 원복했다. 실패 증거는 `attempt-3-final-results.json`과 9개 고유 actor의 work product로 보존한다. 다음 시도 전에는 선택 범위를 수정 의무로 해석하지 않고, 양태·주장 유형·강도·수사 기능을 replacement 단계에서 보존하도록 editing policy를 강화한다.

네 번째 시도는 최종 개선 9/11, 9/11, 6/11이었다. 세 번째 run의 verifier는 9개 edit를 승인했지만 recorder가 공통 접미사를 포함한 비최소 범위 세 개를 통과시켰고 finalizer가 이를 보류했다. 언어 판단과 별개인 이 계약 불일치를 없애기 위해 editing draft sealer와 work-product validator가 finalizer와 같은 최소성 규칙을 적용한다.

이후에만 새 candidate commit을 봉인하고 새 비공개 holdout 30건을 만든다. 정식 세 실행, 독립 감사, MCP 통합 저장소 편입, 로컬 설치 시험은 아직 수행하지 않았다. 기존 합격선, 실패 자료, 공개 설치본 `agent-governance-suite@agent-governance` `v1.0.5`는 변경하지 않는다.
