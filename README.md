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

추출기는 코드, URL, 이메일, Windows·POSIX 경로, Markdown 링크 대상, 직접 인용, 숫자·날짜·시각과 숫자에 붙은 단위를 보호 구간으로 기록한다. 예를 들어 `12건`, `1시간30분`, `09:30`, `12.5%`를 보호한다. 명령어는 코드로 표시됐거나 줄 처음에 `$ ` 또는 `PS 경로> ` 프롬프트가 있을 때 식별한다. 이름과 표시 없는 명령어 등은 입력의 `protectedStrings` 배열로 지정할 수 있다. API는 `extractProtectedSpans(source, protectedStrings)`를 제공하며, 지정 문자열이 비어 있거나 원문에 없으면 오류를 반환한다. 보호 구간이 겹치면 합집합을 보존하고 나머지 산문은 편집할 수 있게 남긴다.

검사기는 원문의 digest와 기록된 보호 구간의 문자·출현 순서를 확인한다. finalizer는 범위가 겹치지 않는 수정만 다루며, 검증자가 승인하지 않은 수정과 보호 구간을 건드리는 수정은 원문으로 남긴다. 입력 계약이나 최종 보호 검사를 만족하지 못하면 전체 원문으로 복귀한다. 이름을 자동으로 알아내거나 문맥 속 모든 명령어·단위를 식별하는 기능은 없으므로 중요한 고정 문자열은 명시적으로 지정해야 한다.

산문에 그대로 쓴 URL은 ASCII URI 문자와 `%HH` 인코딩까지만 추출하고 뒤의 한국어 조사와 문장 끝 구두점은 제외한다. 원래 URL이 비ASCII 문자나 끝 구두점을 포함하면 Markdown 링크 대상·코드·인용으로 표시하거나 `protectedStrings`로 전체 값을 지정해야 한다.

MCP 경로의 receipt에는 원문이나 결과문이 들어가지 않는다. 최종 receipt의 최상위 필드는 `schemaVersion`, `actorIds`, `digest`, `length`, `decisions`, `warnings`로 제한한다. `actorIds`에는 선정자·편집자·검증자의 UUID 세 개만 기록한다. MCP transport는 결과문을 receipt와 분리해 다뤄야 한다. MCP를 거치지 않고 직접 반환한 결과는 검사 성공 여부와 관계없이 `unverified`로 표시한다.

각 receipt의 경고는 해당 스키마의 유한한 `enum`에 있는 코드만 허용한다. finalizer 스키마는 런타임의 모든 결정적 경고를 열거한다. 역할 provider의 상세 설명은 별도 artifact에 남기고 receipt에는 계약에 정한 역할별 경고 코드만 넣는다.

## 평가 자료

`evals/legacy/translationese-100/corpus.jsonl`에는 이전 저장소의 100개 사례가 들어 있다. 평가 protocol, plan과 실패 회귀 사례도 함께 보존하며, `evals/legacy/provenance.json`이 원본 경로와 SHA-256을 고정한다. 이 자료는 회귀 평가에만 쓰며 현재 `SKILL.md`의 정본이 아니다. 독립 holdout은 `evals/FREEZE.json`의 digest로만 참조하고 구현 중에는 읽거나 수정하지 않는다.

현재 `0.1.0` 후보는 세 번의 주 검증에서 의미·보호 문자열·과잉 편집 억제 기준을 충족했지만, 개선율 기준을 통과하지 못했다. 판정 불일치 감사에서는 일부 채택 후보의 의미 보존을 불확실하다고 보아 주 검증과의 이견도 남아 있다. 따라서 릴리스나 플러그인 설치 대상으로 승인되지 않았다. 실행별 수치와 무효 처리한 시도는 [평가 보고서](evals/EVALUATION_REPORT.md)에서 확인할 수 있다.

평가 집계는 기록된 후보를 문자 diff로 나누고 실제 `finalizer-core.mjs`의 `finalizeRequest`를 `mode: "mcp"`로 실행한다. 원문과 후보에서 문자·개수·순서가 같은 보호 구간을 고정한 뒤, 그 사이의 산문만 최소 변경 범위로 나눈다. 보호 문자열 손상·정렬 불확실·입력 보호 문자열 누락이나 계산 한도 초과 시 원문으로 복원한다. 역할 출력, 사례와 합격선은 재집계로 바꾸지 않는다.

## 제한

스크립트는 모델이나 외부 API를 호출하지 않는다. 보호 구간 검사는 문자 보존을 확인하지만 문장 전체의 의미 동등성을 판정하지 않는다. 의미 판정은 별도의 verification provider가 맡으며, 애매한 수정은 `retain`으로 결정한다.

## 라이선스

MIT License. 자세한 내용은 `LICENSE`에서 확인할 수 있다.
