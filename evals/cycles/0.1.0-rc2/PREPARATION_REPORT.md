# 0.1.0-rc2 준비 결과

이 디렉터리에는 cycle별 freeze와 정확히 세 실행을 만들기 위한 schema, policy, protocol, threshold, 진단 inventory가 들어 있다. 새 30건 holdout과 언어 에이전트 출력은 아직 만들지 않았다. 실제 평가를 시작할 때 `scripts/prepare-evaluation-cycle.mjs`에 새 holdout 경로와 후보 commit을 넘겨 `FREEZE.json`, `input.jsonl`, `key.json`, `manifest.json`을 한 번만 생성한다.

진단 inventory는 반복해서 놓친 expected-edit 18건과 기존 holdout control 20건으로 고정했다. 과거 verifier가 거부한 changed candidate 13건은 `scripts/extract-semantic-drift-regressions.mjs`로 기존 증거에서 재현하며, 추출 결과는 새 파일에만 쓸 수 있다.

집계기는 네 작업 제품의 필드, digest, 개수, 순서, actor 분리와 run 번호를 검사한다. 후보문과 최종문은 `editing-work-product.edits`와 `verification-work-product.decisions`에서 계산한다. 기존 `candidateText`와의 diff로 편집을 추정하지 않는다.
