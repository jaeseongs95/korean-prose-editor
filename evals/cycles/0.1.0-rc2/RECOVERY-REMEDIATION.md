# Recovery 실패 보정

상태: `IMPLEMENTED_NOT_RERUN`

이 문서는 `recovery/corpus-validity-v1`의 `failed-recovery` 결과를 수정하거나 재해석하지 않는다. 기존 실행은 edit 5/8, restraint 4/4, major meaning change 0, protected failure 0과 `releaseDecision: not-evaluated`로 봉인해 보존한다.

## 판정된 원인

- R006은 불필요한 서두만 삭제해 문두 공백을 남긴 editor 범위 경계 오류다.
- R008은 기능 동사를 직접화하면서 `내용`이라는 대리 명사를 새로 넣어 결함을 제거하지 못한 editor 후보 오류다.
- R004는 `신제품` 전체를 삭제해 원문에 명시된 제품 범주를 잃은 과잉 삭제로 본다. key 예시가 같은 삭제를 허용한 점은 평가 계약 정렬 결함이다.
- selection은 edit가 issue range와 겹치기만 요구하며 세 안전한 대안을 막지 않았다. finalizer와 집계도 기록된 결정을 그대로 반영했다.

따라서 이번 결과는 특정 고정 실행의 실패다. 단일 실행만으로 제품이나 모델의 일반적인 편집 능력 실패를 주장하지 않는다.

## 적용한 최소 보정

1. editing policy가 원문에 명시된 범주·용어를 보존하고, 중복된 의미 성분만 제거하도록 한다.
2. 기능 동사 직접화에서 `내용`, `것`, `부분` 같은 대리 명사를 새로 만들지 않고 원래 대상과 술어 관계 전체를 한 edit로 고치도록 한다.
3. 모든 edit를 적용한 후보문을 다시 읽고 새 문두·문미 공백과 표면 artifact를 제거하도록 한다.
4. recorder와 work-product validator가 원문에 없던 문두·문미 공백을 결정적으로 거부한다.
5. R002·R004·R006·R008은 공개 회귀 fixture로 고정하며 새 gate의 점수 사례로 쓰지 않는다.
6. 다음 정식 evaluation은 run metadata v3의 실행 provenance가 없으면 집계를 거부한다. 관측할 수 없는 actual model, provider version, seed와 decoding 설정은 추정하지 않고 `unverified`로 기록한다.

## 다음 frame 진입 조건

- 새 ID와 새 freeze를 사용한다.
- 위 공개 회귀 검사가 통과한다.
- gate corpus는 결과를 보지 않은 신규 사례로 작성하고 source-authoritative 독립 타당성 검사를 먼저 통과한다.
- 기존 합격선과 안전 기준을 유지한다.
- 기존 recovery를 다시 실행하거나 R004를 사후 accept로 바꾸지 않는다.

이 조건을 충족해도 자동으로 릴리스 평가나 배포로 진행하지 않는다. 새 frame의 고정 실행이 통과한 뒤에만 기존 fixed diagnostic과 신규 private holdout 경로를 재개한다.
