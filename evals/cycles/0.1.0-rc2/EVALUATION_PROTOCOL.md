# 0.1.0-rc2 평가 규약

이 cycle은 실패한 기존 평가 증거를 보존하면서 다음 후보를 진단하고, 이후 새 holdout으로 릴리스 평가를 수행할 수 있도록 작업 제품과 입력을 분리한다. 기존 `evals/FREEZE.json`, `evals/results.json`, `evals/runs/`, `evals/holdout/`, `evals/audit/`는 읽기 전용 근거로만 사용한다.

## 작업 제품

평가는 `source-unit-manifest`, `selection-work-product`, `editing-work-product`, `verification-work-product`를 입력 순서대로 결합한다. 선정 단계의 `edit` 결정에는 실제 문제가 있는 원문 `issueRanges`와 제한된 결함 코드를 기록한다. 편집 단계는 이 범위와 겹치는 원문 범위와 대체 문자열을 `edits`에 기록한다. 검증 단계는 edit별 `sourceDefect`와 `invariantDelta`를 기록하며, 구체적 결함이 제거되고 의미 불변량 변화가 없고 후보가 분명히 나을 때만 승인한다. 집계기는 구조화된 편집을 원문에 적용해 후보문과 최종문을 만들며, 별도의 `candidateText`를 비교해 편집 내용을 추정하지 않는다.

각 실행에서 selection, editing, verification의 `actorId`는 서로 달라야 한다. 한 역할은 실행 안에서 같은 `actorId`를 유지한다. editing은 selection의 canonical digest를, verification은 editing의 canonical digest와 이 규약의 digest를 참조한다. 작업 제품의 수와 순서는 `input.jsonl`과 정확히 같아야 한다.

각 `runs/run-N/`에는 세 작업 제품 JSONL과 함께 `selection-meta.json`, `editing-meta.json`, `verification-meta.json`을 둔다. meta는 역할, 실행 번호, actor, 사례 수, 입력 digest, canonical 작업 제품 digest를 결합한다. 다음 정식 실행은 schema v3의 `executionProvenance`에 requested model, 관측 가능한 actual model과 provider version, prompt digest, seed와 decoding-parameter digest를 함께 기록한다. 관측할 수 없는 값은 추정하지 않고 `unverified`로 남긴다. selection·editing recorder에는 cycle 디렉터리 아래의 provenance JSON 경로를 `--provenance-file`로 전달한다. verification meta도 같은 객체를 포함해야 한다. v2 meta는 이미 봉인된 과거 증거를 읽기 위한 호환 형식일 뿐 새 정식 실행에는 사용할 수 없다. 집계 결과인 `final.jsonl`과 `metrics.json`도 같은 실행 디렉터리에 새 파일로 기록한다.

## 진단 세트

알려진 진단 세트는 이전 세 실행에서 모두 놓친 expected-edit 18건과 이전 holdout의 control 20건으로 고정한다. expected-edit 18건 중 15건 이상을 최종 편집하고, control 20건 중 18건 이상을 편집하지 않아야 진단 기준을 통과한다. 이 결과는 새 holdout 릴리스 평가를 대신하지 않는다.

과거 실행에서 expectedDecision이 `edit`이고 selection이 `edit`였지만 verifier가 거부한 변경 후보 13건은 negative semantic-drift 회귀 자료로 보존한다. 이 자료는 모델 판정을 새로 만들지 않으며, 당시 verifier 필드와 원문·후보 digest를 그대로 기록한다.

별도 `user-facing-jargon` 회귀 사례는 사용자용 진행 업데이트에서 추상적인 명사구를 구체적인 행동으로 풀 수 있는지 확인한다. 기존 18건·20건 분모에는 넣지 않는다. 이 사례는 지정한 보호 문자열을 100% 보존하고 최종 `pairPreference`가 `candidate`여야 한다.

### 새 편집 후보 feasibility calibration

새 편집 후보 11건의 반복 attempt는 중단한다. 이 세트의 gate는 candidate freeze 전에 편집 가능성을 확인하는 진단이며, 정식 릴리스 평가나 holdout 결과를 대신하지 않는다. 이전 attempt와 pass 조건이 다른 1회성 `frozen-candidate feasibility calibration` 결과를 이전 점수와 비교하거나 합산하지 않는다.

calibration에서는 `sourceText`와 `protectedStrings`를 의미 판정의 원자료로 고정한다. `meaningConstraints`는 원문에서 파생한 보수적 확인 항목일 뿐 원문에 없는 뜻을 보태거나 양태·주장 유형·수사 기능을 바꿀 권한을 주지 않는다. 둘이 충돌하거나 안전한 개선을 확정할 문맥이 부족하면 해당 사례를 `infeasible`로 기록한다.

독립 editor와 adjudicator가 사례마다 정확히 하나의 minimal atomic edit 또는 `infeasible`을 확정한다. recorder는 원문·제약·보호 문자열 digest와 단일 편집을 적용한 `candidateDigest`를 계산해 candidate set을 동결한다. 이후 이전 역할과 겹치지 않는 새 verifier 세 명이 같은 candidate set을 평가하고, 각 판단을 candidate set·canonical record·candidate digest와 결속하며 `independentValidity`와 `safetyFailure`를 기록한다.

동일한 edit 중 최소 9건을 세 verifier가 모두 승인하고 safety failure가 0건일 때만 feasibility를 통과한다. 결과와 무관하게 실행은 한 번으로 끝낸다. 통과하면 기존 full fixed diagnostic으로 돌아가고, 실패하면 새 candidate를 조정하거나 재실행하지 않고 원인을 진단한다. 어느 결과도 즉시 candidate freeze, holdout, 통합이나 릴리스를 허용하지 않는다.

## 새 릴리스 평가 준비

새 holdout은 30건이며 `edit`, `retain`, `defer`를 각각 10건 포함해야 한다. 실제 사례는 이 cycle 준비 작업에 포함하지 않는다. 평가를 시작할 때 후보 commit, 역할별 policy, private schema, 기존 corpus, 새 holdout, 이 규약, 합격선을 모두 SHA-256으로 동결한다. 입력 세트는 정확히 세 번 실행한다.

세 실행은 기존 릴리스 합격선을 그대로 적용한다. 진단 기준을 통과해도 기존 릴리스 합격선 하나라도 미달하거나, digest·개수·역할 분리·작업 제품 결합이 어긋나면 릴리스 통과로 판정하지 않는다. 스크립트는 이미 존재하는 freeze, 입력, key, manifest, final, metrics 파일을 덮어쓰지 않는다.
