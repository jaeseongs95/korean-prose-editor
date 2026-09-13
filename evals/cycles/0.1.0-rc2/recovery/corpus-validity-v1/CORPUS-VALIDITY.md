# Recovery corpus 독립 타당성 판정

구현과 과거 attempt 작성에 참여하지 않은 corpus author가 신규 12건을 작성했고, 별도 adjudicator가 언어 실행 결과를 보기 전에 전 사례와 계약을 직접 검증했다.

판정은 `VALID`이다.

- 입력과 key는 각각 12건이며 ID와 순서가 일치한다.
- 분포는 edit 8, retain 2, infeasible 2다.
- 모든 `meaningConstraints`는 `sourceText`에서 파생한 보수적 확인 항목이다.
- 보호 문자열 13개는 모두 원문에 존재하며 edit 예시에도 보존된다.
- edit 8건에는 의미를 바꾸지 않는 명확한 국소 개선이 있다.
- retain 2건에는 객관적인 수정 결함이 없다.
- infeasible 2건은 각각 지시 대상 모호성과 원문에 없는 날짜 요청으로, 추정 없이 편집할 수 없다.
- feasible edit 상한은 8이므로 edit 최소 7, control 4/4, major meaning change 0, protected failure 0을 동시에 달성할 수 있다.
- 이 frame은 과거 시도와 비교할 수 없고 기존 9/11이나 정식 릴리스 기준을 변경하지 않는다.

검증 시점의 SHA-256은 다음과 같다.

- `input.jsonl`: `e618273fd47a89a711eb10e33c38fa529a5a6f88ca1a7ffeb5938cde8dd53365`
- `key.json`: `426b3bc962c4c6cb942cf29ce3d61941a0fbc8a45d2fd330cff62f180bb69f21`
- `INVALID-CORPUS-CLOSURE.md`: `6e9c896bdb0d221806239732869b33615b74210eb9a134b43f50201c3340b9e8`

R004의 예시 문장 외에도 제품성을 더 명시적으로 보존하는 안전한 대안이 있으므로 exact-match를 요구하지 않는다. R011의 모호성은 corpus 누락이 아니라 의도된 infeasible control이다.
