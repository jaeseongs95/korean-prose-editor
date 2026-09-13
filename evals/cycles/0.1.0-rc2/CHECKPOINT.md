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

다섯 번째 시도의 선정은 세 실행 모두 11/11이었다. 편집 run 2에서 edit의 원문 digest 오류를 검출했지만 기존 recorder가 검증 전에 work product를 써 불완전 산출물이 남았으므로 이 시도는 검증 단계로 넘기지 않는다. 이후 recorder는 전체 draft·actor 검증이 끝난 뒤에만 work product를 새로 쓴다.

여섯 번째 시도는 변경되지 않은 다섯 번째 selection을 digest provenance와 함께 재사용했다. 최종 개선은 8/11, 10/11, 8/11로 한 run만 통과했고, 최종 주요 의미 변화와 보호 문자열 실패는 모두 0건이었다. 한 verifier는 의미가 바뀐 edit와 같은 사례에 있다는 이유로 독립적으로 안전한 edit까지 함께 유지했다. 다음 시도 전에는 edit별 판정이 다른 edit의 실패와 분리되고 전체 assessment가 승인된 edit 집합을 요약하도록 verification rubric을 명확히 한다.

일곱 번째 시도는 여섯 번째 selection·editing을 digest provenance와 함께 재사용하고 새 rubric으로만 검증했다. 최종 개선은 5/11, 7/11, 7/11이었다. edit를 독립적으로 적용했을 때 문법적으로 완결되지 않는 상호 의존 edit가 확인됐다. 다음 editing은 edit 하나가 단독으로 적용돼도 유효해야 하며, 서로 의존하는 변화는 하나의 최소 edit로 묶는다.

여덟 번째 시도는 유효한 확인 시도로 인정하지 않는다. verification meta 세 개와 final results가 없고 run 2의 T050 `editingDigest`가 canonical editing work-product digest와 일치하지 않는다. digest 오류만 메모리에서 바로잡아 재생한 결과도 5/11, 6/11, 6/11이었다. 기존 파일은 `invalid/incomplete` 증거로 보존하며 attempt 9로 이어가지 않는다.

독립 토론 결론에 따라 기존 시도와 비교하지 않는 1회성 `frozen-candidate feasibility calibration`을 별도 실행했다. `sourceText`와 `protectedStrings`를 의미 권위 원본으로 고정하고, `meaningConstraints`가 충돌하거나 맥락이 부족하면 편집을 강제하지 않고 `infeasible`로 분류했다. 신규 editor와 adjudicator가 같은 11건에서 canonical edit 7건과 infeasible 4건을 동결했고, 과거 참여자와 겹치지 않는 신규 verifier 세 명이 같은 candidate-set digest를 검증했다. 세 verifier 모두 편집 7건을 수용하고 infeasible 4건을 확인했으며 safety failure는 0건이었다.

최종 판정은 `failed-feasibility`다. 합의 수용 편집은 7건으로 고정 합격선 9건에 미달했다. 이 결과는 `comparableToPriorAttempts: false`, `releaseDecision: not-evaluated`, `executionCount: 1`로 봉인했으며 다음 경로는 `stop-and-diagnose`다. candidate freeze, fresh holdout, 통합, 릴리스, 태그, 배포, 설치와 push는 허용하지 않는다.

feasibility 실패 원인을 별도 진단해 새 실행 근거가 생기기 전에는 candidate commit 봉인과 새 비공개 holdout 30건으로 넘어가지 않는다. 정식 세 실행, 독립 감사, MCP 통합 저장소 편입, 로컬 설치 시험은 아직 수행하지 않았다. 기존 합격선, 실패 자료, 공개 설치본 `agent-governance-suite@agent-governance` `v1.0.5`는 변경하지 않는다.

사용자 승인에 따라 기존 11-case gate는 기록된 `failed-feasibility`, `releaseDecision: not-evaluated`를 바꾸지 않은 채 `invalid-corpus`로 종결했다. attempt 6 run 2의 원시 최고점 10/11은 후속 판정에서 infeasible인 T071, T087, T038을 포함하므로 성능 근거로 재사용하지 않았고, 세 verifier가 만장일치로 수용한 feasible 7/7의 추상 편집 패턴만 신규 corpus 설계에 참고했다.

별도 author와 adjudicator가 신규 12건의 source-authoritative 혼합 corpus를 언어 실행 전에 `VALID`로 판정했고, 후보 commit `8343430d5f79e0f37c353f2b267cd18669a36c7a`와 계약·입력·key·정책·실행기를 frame digest `68106d52fdae1a070950606fa78e1dc126610346dcb2292c1b93be78bcb29bd0`로 동결했다. 한 번의 role-separated recovery 실행 결과는 edit 5/8, restraint 4/4, major meaning change 0, protected failure 0으로 `failed-recovery`다. R004의 제품 범주 삭제, R006의 선행 공백, R008의 술어-대상 구조 변화가 독립 verifier에서 원복됐다. 실행 예산 1회를 소진했으므로 후보 수정·recovery 재실행·fixed diagnostic·private holdout·suite 통합·릴리스는 진행하지 않고 `stop-and-diagnose`에서 중단한다.

후속 독립 토론과 최종 판정은 selection·finalizer·집계가 아니라 editor 후보 완성 검사가 직접 보정 대상이라고 결론냈다. 봉인된 recovery는 그대로 보존하고, 범주·용어 보존, 대리 명사 없는 직접화, 적용 후 공백 검사를 editing 계약과 공개 회귀 fixture에 추가했다. 정식 실행 metadata는 provenance가 포함된 v3만 허용한다. 세부 범위와 다음 frame 진입 조건은 `RECOVERY-REMEDIATION.md`에 기록한다. 이 보정 자체는 recovery 재실행이나 릴리스 재개를 뜻하지 않는다.
