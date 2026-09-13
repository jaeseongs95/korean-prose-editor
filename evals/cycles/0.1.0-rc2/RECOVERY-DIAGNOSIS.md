# 0.1.0-rc2 릴리스 차단 원인 진단

상태: `CAUSE_CONFIRMED`

이 문서는 attempt 3~8과 1회성 `frozen-candidate feasibility calibration`을 수정하거나 재해석하지 않는다. 기존 실패 증거, 합격선과 안전 계약은 그대로 보존한다.

## 확정 원인

현재 릴리스 차단의 직접 원인은 editor, verifier 또는 finalizer가 아니라 `new-candidates` corpus와 key의 불일치다. `scripts/prepare-new-semantic-candidates.mjs`는 과거 semantic-regression 원문 11건을 중복 제거한 뒤 사례의 실제 편집 가능성을 판정하지 않고 모두 `expectedDecision: edit`로 기록한다.

1회성 calibration은 `sourceText`와 `protectedStrings`를 의미 권위 원본으로 고정했다. 신규 editor와 adjudicator가 canonical edit 7건과 infeasible 4건을 동결했고, 과거 참여자와 다른 verifier 세 명이 같은 candidate digest를 독립 검증했다. 세 verifier 모두 7개 edit를 수용하고 다음 4건을 infeasible로 확인했다.

- `new:legacy:T071`: `SOURCE_CONSTRAINT_CONFLICT` — “8시까지 돌아오지 않음”과 “8시보다 늦게 귀가함”은 같은 조건이 아니다.
- `new:legacy:T086`: `SOURCE_CONSTRAINT_CONFLICT` — 원문의 `모든 것`·`제공해야 하는`과 `다양한 매력` 제약은 범위와 양태가 다르다.
- `new:legacy:T087`: `NO_SAFE_CLEAR_IMPROVEMENT` — 의미를 보존하며 반드시 고쳐야 할 명확한 원문 결함이 없다.
- `new:legacy:T038`: `SOURCE_CONSTRAINT_CONFLICT` — `유의미한 도전`을 `큰 위험`으로 바꾸면 주장 유형과 강도가 달라진다.

따라서 기존 frame에서 가능한 unanimous edit의 상한은 7건이고 합격선은 9건이다. 현 frame은 candidate의 성능과 무관하게 통과할 수 없다.

## 배제한 현재 원인

- editor 결함은 과거 attempt에 기여했지만 calibration에서 만든 안전한 7개 edit가 모두 만장일치로 수용돼 현재 blocker가 아니다.
- verifier의 case 단위 실패 전파는 과거 attempt 6에 있었지만 calibration의 gate 판단은 세 verifier가 11/11 일치했다.
- recorder/finalizer 결함은 과거 attempt 4·5·8에 있었지만 calibration의 canonical 결과와 final 결과는 digest 재구성에 정확히 일치했다.
- 보호 문자열 실패는 0건이다.

## 결속 근거

- 진단 request digest: `940f493702f1a7d3c2aa04e9a250687f4fcbbc674d6e9073fad8b170eb225129`
- calibration request digest: `c00b4f1312941f3de032d0a2330f73845c42961bfd2dccad4b8e42764138ecc8`
- calibration frame digest: `9fe156cc505ca9b7f91998b7cbb765906a0383c9e8ba504edf440a51567b7963`
- prior attempt evidence digest: `f836eef3195954ebbb1e5f26cf876a7f8bf08c04c886060304397fd87d904d1d`
- candidate-set digest: `480cd5d5cbce17af7653cbf513a44114c89328d7e4a9568117d5e53f6351016b`
- calibration freeze digest: `6bf3163522268a15b912971024b7247f273d84517bb175f2ef10e01e79cdb4de`

## 릴리스 영향과 recovery 경계

기존 calibration은 `failed-feasibility`, `releaseDecision: not-evaluated`로 유지한다. 이를 통과로 바꾸거나 9/11 합격선을 사후에 낮추지 않는다.

릴리스를 재개하려면 기존 11-case gate를 `invalid-corpus/frame`으로 종결하고, 과거 증거와 비교하지 않는 새 recovery frame이 필요하다. 새 frame은 다음을 강제해야 한다.

1. `sourceText`와 `protectedStrings`를 의미 권위 원본으로 사용한다.
2. feasible edit와 retain/infeasible control을 key에서 구분한다.
3. feasible upper bound가 합격 조건보다 작으면 candidate 실패가 아니라 `invalid-corpus`로 fail closed한다.
4. 새 ID와 freeze를 사용하고 기존 attempt·calibration 파일을 덮어쓰지 않는다.
5. recovery 진단 통과 후에만 기존 formal diagnostic과 신규 private holdout 릴리스 평가로 진행한다.
6. 기존 formal release threshold와 safety contract는 변경하지 않는다.

이 변경은 진단 입력, oracle과 aggregation 의미를 바꾸므로 이전 frame과 `non-comparable`이다. fresh-context frame audit의 판정은 `semantics-changing / non-comparable / needs-user`이며, 실제 recovery artifact 생성 전 사용자의 명시 승인이 필요하다.

최종 배포 대상은 private standalone 패키지가 아니라 `agent-governance-suite` 플러그인이다. 품질 게이트를 통과한 standalone commit을 공개 SHA로 고정한 뒤 별도 깨끗한 suite worktree에서 스킬 원본 편입, provider 활성화, 전체 검증, mutation preflight, `origin/main`, annotated tag와 GitHub Release, 설치 검증, 독립 사후감사를 순서대로 수행해야 한다.
