# korean-prose-editor

`korean-prose-editor`는 한국어 산문을 보수적으로 다듬는 Codex Skill이다. 표현을 자연스럽게 바꾸되 사실, 이름, 숫자, 날짜, 인용, 링크, 코드와 문서의 확신 수준을 보존한다. 편집 결과가 의미를 바꿨는지 확신할 수 없으면 해당 부분을 원문으로 되돌린다.

이 저장소는 네 provider를 사용한다. selection provider가 편집 범위와 보존 조건을 정하고, editing provider가 범위가 명시된 수정안을 만든다. verification provider는 수정안의 의미 보존 여부를 독립적으로 판정한다. finalization provider는 모델이 아니라 결정적 스크립트이며, 검증에서 승인된 수정만 반영한다. 언어 판단을 맡는 세 provider의 `actorIds`는 격리된 역할 실행에서 새로 만든 canonical lowercase UUID여야 하고 서로 달라야 한다. 서브에이전트를 사용할 수 없으면 단일 행위자로 축소하지 않고 실패한다.

UUID 고유성은 협력적 역할 분리를 확인하기 위한 표식이다. 암호학적 신원 증명이나 적대적 실행자 사이의 독립성을 보장하지 않는다.

## 요구 환경

- Node.js 22 이상
- pnpm 11.19.0

의존성을 설치하고 전체 검증을 실행한다.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test
pnpm validate
```

## 구조

- `skills/korean-prose-editor/SKILL.md`: 호출 경계와 provider 흐름
- `skills/korean-prose-editor/references/`: 편집·검증·통합 정책
- `skills/korean-prose-editor/contracts/`: 교환 객체와 receipt의 JSON Schema
- `skills/korean-prose-editor/scripts/`: 보호 구간 추출기, 결과 검사기, finalizer
- `skills/korean-prose-editor/integration/skill-descriptor.json`: 설치 도구가 읽는 기술자
- `tests/`: 결정적 동작과 계약 검증
- `evals/legacy/`: 출처와 해시가 고정된 이전 평가 자료

통합 descriptor는 `korean-prose-selection`, `korean-prose-editing`, `korean-prose-verification`, `korean-prose-finalization`을 각각 50, 55, 60, 65 순서로 실행한다. 네 단계는 `edit-decision-set`, `edit-candidate`, `edit-verification-report`, `final-text-receipt` artifact를 차례로 만든다. provider 결과는 원문을 싣지 않는 reference-only receipt이며, 실제 글은 검증 가능한 locator와 digest를 가진 별도 artifact로 전달한다.

## 결정적 도구

각 도구는 JSON을 표준 입력으로 받고 JSON을 표준 출력으로 보낸다.

```bash
node skills/korean-prose-editor/scripts/extract-protected-spans.mjs < request.json
node skills/korean-prose-editor/scripts/check-result.mjs < check.json
node skills/korean-prose-editor/scripts/finalize.mjs < finalization.json
```

추출기는 코드, URL, Markdown 링크 대상, 직접 인용, 숫자와 날짜를 보호 구간으로 기록한다. 검사기는 원문의 digest와 보호 구간의 문자·개수·순서를 확인한다. finalizer는 범위가 겹치지 않는 수정만 다루며, 검증자가 승인하지 않은 수정은 원문으로 남긴다. 입력 계약이나 보호 조건을 만족하지 못하면 전체 원문으로 복귀한다.

MCP 경로의 receipt에는 원문이나 결과문이 들어가지 않는다. 최종 receipt의 최상위 필드는 `schemaVersion`, `actorIds`, `digest`, `length`, `decisions`, `warnings`로 제한한다. `actorIds`에는 선정자·편집자·검증자의 UUID 세 개만 기록한다. MCP transport는 결과문을 receipt와 분리해 다뤄야 한다. MCP를 거치지 않고 직접 반환한 결과는 검사 성공 여부와 관계없이 `unverified`로 표시한다.

## 평가 자료

`evals/legacy/translationese-100/corpus.jsonl`에는 이전 저장소의 100개 사례가 들어 있다. 평가 protocol, plan과 실패 회귀 사례도 함께 보존하며, `evals/legacy/provenance.json`이 원본 경로와 SHA-256을 고정한다. 이 자료는 회귀 평가에만 쓰며 현재 `SKILL.md`의 정본이 아니다. 독립 holdout은 `evals/FREEZE.json`의 digest로만 참조하고 구현 중에는 읽거나 수정하지 않는다.

## 제한

스크립트는 모델이나 외부 API를 호출하지 않는다. 보호 구간 검사는 문자 보존을 확인하지만 문장 전체의 의미 동등성을 판정하지 않는다. 의미 판정은 별도의 verification provider가 맡으며, 애매한 수정은 `retain`으로 결정한다.

## 라이선스

MIT License. 자세한 내용은 `LICENSE`에서 확인할 수 있다.
