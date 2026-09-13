# 11-case gate 종결 및 recovery 승인

기존 11-case gate의 기록된 결과는 `failed-feasibility`, `releaseDecision: not-evaluated`로 보존한다. 그 결과를 합격으로 바꾸거나 9/11 임계값을 낮추지 않는다.

후속 진단에서 T071, T086, T038은 원문과 `meaningConstraints`가 충돌하고 T087은 안전한 필수 개선을 확정할 수 없다고 판정됐다. 따라서 edit 가능 상한은 7건이며, 사전 고정된 최소 9건보다 작다. 이 gate는 candidate의 성능 실패를 판별할 수 없는 `invalid-corpus`로 종결한다. attempt 9, 같은 11건의 재실행, calibration 반복은 하지 않는다.

사용자는 다음 문장으로 의미가 달라지는 recovery frame을 승인했다.

> 기존 실패와 안전·릴리스 기준을 보존하고, 기존 11-case gate를 `invalid-corpus`로 종결한 뒤 축소된 recovery 경로로 진행한다

UTF-8 SHA-256은 `76d4ddc0c5c8e089c019a955b7f3325fce298d6664b5bc8936afd936a6a33797`이다.

새 recovery는 과거 시도와 비교하지 않는 신규 12건 혼합 진단을 한 번만 실행한다. 8개 edit 사례 중 7개 이상을 안전하게 개선하고, retain 2개와 infeasible 2개를 모두 수정하지 않으며, major meaning change와 protected-string failure가 모두 0이어야 한다. 통과해도 릴리스 판정은 아니며 기존 fixed diagnostic과 신규 private holdout으로만 진행할 수 있다.

## 과거 최고 결과의 사용 범위

과거 원시 최고점은 attempt 6 run 2의 10/11이다. 그러나 전체 attempt는 8/11, 10/11, 8/11로 실패했고, run 2의 10건에는 후속 source-authoritative calibration에서 infeasible로 확정된 T071, T087, T038이 포함된다. 이 점수를 새 frame의 성능 근거로 재사용하지 않는다.

신뢰 가능한 참고 범위는 calibration에서 세 verifier가 모두 수용한 feasible 7/7과 safety failure 0건이다. 새 사례에는 원문을 복사하지 않고 다음 추상 패턴만 반영한다: 기능동사와 명사화의 직접화, 가능성·예상 강도 보존, 문법 호응 수정, 수사 기능 유지, 명확한 결함이 없는 문장의 retain, 원문과 제약이 충돌하거나 문맥이 부족한 사례의 defer. 한 edit는 단독으로 문법적·의미적으로 유효해야 한다.
