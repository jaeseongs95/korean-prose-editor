# Phase 0 독립 다각도 검토 판정

작성일: 2026-09-13

대상: `0.1.0-rc2` Phase 0 semantic regression 후보 선정 및 검증 흐름

상태: 검증 종료 후 작업 중단

## 1. Executive Verdict

즉시 작업을 중단한다. Phase 0는 미통과이며 attempt 8은 유효한 확인 시도로 인정하지 않는다.

현재 증거만으로는 반복 실패의 주원인이 generator 결함인지, verifier·corpus·gate 계약 결함인지 확정할 수 없다. 따라서 attempt 9, candidate freeze, fresh holdout, suite integration, 공개·설치로 진행하지 않는다.

## 2. Consensus Proposal

조건부 합의안은 재개 시 알려진 11-case gate를 대상으로 1회성 `frozen-candidate feasibility calibration`을 수행하는 것이다. 이 calibration은 formal release acceptance나 fresh holdout을 대체하지 않는다.

실행 전에 diagnostic gate의 권위 경계와 의미 판정 원칙을 고정하고, case별 canonical single edit 또는 `infeasible`을 동결해야 한다. 같은 동결 편집을 새 verifier 3명이 독립적으로 평가하며, 사전등록한 기준과 중단 규칙을 한 번만 적용한다.

## 3. Strong Consensus

- attempt 8은 불완전하고 증거 계약을 충족하지 않는다.
- attempt 8의 digest 오류를 메모리에서만 바로잡은 재생 결과도 `5/11`, `6/11`, `6/11`이므로 성공으로 마감할 수 없다.
- 알려진 11-case에 반복 적응한 결과는 일반화 증거가 아니다.
- 현재 `independently valid edit` 요구는 문서 수준이며 schema, recorder, finalizer 전 구간에서 기계적으로 결속되지 않았다.
- 기존 증거를 덮어쓰거나 임계값을 낮추거나 diagnostic을 조용히 건너뛰어서는 안 된다.
- 지금은 중단하고, 재개하더라도 원인 식별을 위한 단 한 번의 calibration만 먼저 수행해야 한다.

## 4. Material Disagreements

초기 통계 관점은 attempt 8을 confirmatory run으로 마감하는 방안을 제안했다. 교차검증 결과 run 2의 T050 `editingDigest` 불일치, 누락된 verification meta와 final results, 보정 재생의 `5/6/6` 실패가 확인되어 이 방안은 기각됐다.

11-case gate를 계속 유지할지 제거할지는 아직 합의 대상이 아니다. 현재 문서상 이 gate는 pre-freeze diagnostic이지 formal release acceptance가 아니지만, CHECKPOINT 흐름에서는 candidate freeze 전 통과 조건으로 사용된다. 소유권과 권위 결정을 하지 않은 채 제거하거나 완화할 수 없다.

## 5. Decision by Axis

| 판단 축 | 판정 |
| --- | --- |
| 계약 유효성 | 실패. attempt 8 증거가 불완전하고 digest가 불일치하며, 보정 재생도 기준 미달이다. |
| 진단 식별력 | 현재 낮음. 보완된 1회성 feasibility calibration만 generator와 gate·corpus·verifier 문제를 구분할 수 있다. |
| 과적합·중단 규율 | 알려진 11-case 반복 조정을 중단한다. 재개 시 새 verifier 3명, 사전등록 판정표와 1회 중단 규칙이 필요하다. |
| Phase 0 순서·범위 | 지금은 어떤 후속 실행도 하지 않는다. 재개 시 calibration이 attempt 9, holdout, integration보다 먼저다. |
| 증거 완결성 | attempt 8을 `invalid/incomplete` 상태로 보존한다. 새 실행은 meta, digest, staging과 finalizer 판정을 모두 완결해야 한다. |

## 6. Evidence

- attempt 3: `6/11`, `2/11`, `1/11`
- attempt 4: `9/11`, `9/11`, `6/11`
- attempt 5: recorder partial-write 결함으로 중단했으며 이후 recorder·finalizer 정합성과 검증 전 쓰기 방지를 수정했다.
- attempt 6: `8/11`, `10/11`, `8/11`
- attempt 7: `5/11`, `7/11`, `7/11`
- attempt 8: `verification-meta.json` 3개와 `attempt-8-final-results.json`이 없다.
- attempt 8 run 2의 T050 verification에 기록된 `editingDigest`는 candidate digest이며 canonical editing work-product digest와 다르다. 관측값은 `45339b7...aaa98`, 기대값은 `9ff574bf...ed8d`이다.
- digest 필드만 파일을 수정하지 않고 메모리에서 바로잡아 현재 evaluator로 재생한 결과는 run 1부터 `5/11`, `6/11`, `6/11`이다.
- T086은 반복적으로 실패했다. T087은 key상 `edit`이지만 여러 verifier가 `natural/retain`으로 판단해 의미 계약 충돌 가능성을 드러냈다.
- selection 단계의 `edit` 분류는 안전한 대체 표현이 실제로 존재한다는 증거가 아니다.
- candidate freeze, fresh holdout, suite integration, immutable public reference는 아직 완료되지 않았다.

## 7. Required Actions

지금은 이 판정 문서 작성 외의 변경, 재실행, 증거 마감, 통합, 게시를 하지 않고 중단한다.

재개가 명시적으로 승인되면 다음 순서를 따른다.

1. diagnostic gate와 formal release acceptance의 권위 경계를 고정한다.
2. `meaningConstraints`와 원문 표현이 충돌할 때의 의미 권위 원칙을 고정한다.
3. editor/adjudicator가 case별로 정확히 하나의 minimal atomic edit 또는 `infeasible`을 확정하고 실행 전에 digest를 동결한다.
4. canonical edit digest, verifier의 `independentValidity`, preflight와 staging을 schema부터 recorder와 finalizer까지 강제한다.
5. 새 verifier 3명이 동일한 동결 편집을 독립 평가한다.
6. 동일한 최소 9개 edit를 세 verifier 모두 수용하고 safety failure가 0인 경우에만 feasibility를 통과시킨다.
7. 결과별 다음 분기를 실행 전에 등록하고, 실행 뒤 추가 조정이나 재시도를 하지 않는다.

## 8. Optional Optimizations

- calibration 결과를 generator failure, infeasible edit, meaning-authority conflict, verifier disagreement로 분리 집계할 수 있다.
- evidence writer를 단일 staging 경로 뒤 원자적 finalization으로 구성해 부분 산출물이 남는 위험을 줄일 수 있다.
- public reference 불일치를 해소할 때 설치 캐시, Git commit·tag, 공개 release를 각각 별도 상태로 기록할 수 있다.

이 항목들은 재개 조건이나 필수 판정을 대체하지 않는다.

## 9. Unresolved

- I2: 11-case diagnostic gate와 formal release acceptance의 권위 경계
- I3: `meaningConstraints`와 원문 표현의 우선순위
- I5: standalone CHECKPOINT의 public installed `v1.0.5`와 suite roadmap의 current public release `v1.1.0` 불일치
- calibration이 성공해도 candidate freeze, fresh holdout, suite integration과 immutable public reference는 별도로 충족해야 한다.

## 10. Method / Run Summary

검토 위험도는 반복 실패와 계약 불명확성을 고려해 HIGH로 분류했다. 구현에 참여하지 않은 네 독립 관점이 서로의 결론을 보지 않고 검토했다.

- Contract Auditor: 증거 계약, digest, recorder·finalizer 원자성을 검토했다.
- Data/Statistics Reviewer: 반복 결과, 표본 한계와 과적합 위험을 검토했다.
- Minimalist/Scope Reviewer: Phase 0 범위, release sequencing과 중단선을 검토했다.
- System Architect: generator와 verifier·corpus 계약의 식별 가능성을 검토했다.

통계 관점의 attempt 8 마감 제안은 Contract Auditor의 교차검증과 직접 파일 재생으로 반박됐다. 이후 구현에 참여하지 않은 fresh Judge가 정제된 사실, 반박 결과와 미해결 쟁점만 받아 최종 판정했다.

판정 assurance는 `independent`로 기록한다. reviewer 4명과 fresh Judge 1명을 분리했으며, 별도 specialist나 adaptive reviewer는 추가하지 않았다. 요청한 모델·추론 수준은 reviewer에 `gpt-5.6-terra/xhigh`, Judge에 `gpt-5.6-sol/xhigh`였으나 provider 내부의 실제 실행 구성은 이 기록만으로 독립 검증할 수 없다.

최종 신뢰도는 높음이다. 즉시 중단, attempt 8 무효, 임계값 완화·attempt 9·holdout·integration 금지 판단은 확정적이다. calibration의 세부 계약은 I2와 I3을 결정하기 전까지 조건부다.
