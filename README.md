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
- `skills/korean-prose-editor/scripts/`: 보호 구간·원문 단위 추출기, 결과 검사기, finalizer
- `skills/korean-prose-editor/integration/skill-descriptor.json`: 설치 도구가 읽는 기술자
- `tests/`: 결정적 동작과 계약 검증
- `evals/legacy/`: 출처와 해시가 고정된 이전 평가 자료
- `evals/cycles/`: 후보별 진단, 비공개 holdout과 역할 분리 평가 자료

통합 descriptor는 `korean-prose-selection`, `korean-prose-editing`, `korean-prose-verification`, `korean-prose-finalization`을 각각 50, 55, 60, 65 순서로 실행한다. 네 단계는 `edit-decision-set`, `edit-candidate`, `edit-verification-report`, `final-text-receipt` artifact를 차례로 만든다. provider 결과는 원문을 싣지 않는 reference-only receipt이며, 실제 글은 검증 가능한 locator와 digest를 가진 별도 artifact로 전달한다.

## 결정적 도구

각 도구는 JSON을 표준 입력으로 받고 JSON을 표준 출력으로 보낸다.

```bash
node skills/korean-prose-editor/scripts/extract-protected-spans.mjs < request.json
node skills/korean-prose-editor/scripts/check-result.mjs < check.json
node skills/korean-prose-editor/scripts/finalize.mjs < finalization.json
```

추출기는 코드, URL, 이메일, Windows·POSIX 경로, Markdown 링크 대상, 직접 인용, 숫자·날짜·시각과 숫자에 붙은 단위를 보호 구간으로 기록한다. 예를 들어 `12건`, `1시간30분`, `09:30`, `12.5%`를 보호한다. 명령어는 코드로 표시됐거나 줄 처음에 `$ ` 또는 `PS 경로> ` 프롬프트가 있을 때 식별한다. 이름과 표시 없는 명령어 등은 입력의 `protectedStrings` 배열로 지정할 수 있다. API는 `extractProtectedSpans(source, protectedStrings)`를 제공하며, 지정 문자열이 비어 있거나 원문에 없으면 오류를 반환한다. 보호 구간이 겹치면 합집합을 보존하고 나머지 산문은 편집할 수 있게 남긴다.

원문 단위 추출기는 fenced code block과 빈 줄로 나뉜 prose block에 UTF-16 반개구간과 digest를 부여한다. 선정자는 단위마다 `edit`, `retain`, `defer`를 기록하고, 편집자는 `edit` 단위 안의 국소 범위만 제안한다. 검사기는 원문의 digest와 기록된 보호 구간의 문자·출현 순서를 확인한다. finalizer는 선정·편집·검증 산출물의 digest와 actor를 연결한 뒤 edit별 판정을 적용한다. 검증자가 거부했거나 결정하지 않은 수정, 선정 범위 밖 수정과 보호 구간을 건드리는 수정은 그 부분만 원문으로 남긴다. digest 불일치, 겹치는 edit, 손상된 선정 계약이나 최종 보호 검사 실패는 전체 원문으로 복귀시킨다. 이름을 자동으로 알아내거나 문맥 속 모든 명령어·단위를 식별하는 기능은 없으므로 중요한 고정 문자열은 명시적으로 지정해야 한다.

산문에 그대로 쓴 URL은 ASCII URI 문자와 `%HH` 인코딩까지만 추출하고 뒤의 한국어 조사와 문장 끝 구두점은 제외한다. 원래 URL이 비ASCII 문자나 끝 구두점을 포함하면 Markdown 링크 대상·코드·인용으로 표시하거나 `protectedStrings`로 전체 값을 지정해야 한다.

MCP 경로의 receipt에는 원문이나 결과문이 들어가지 않는다. 최종 receipt의 최상위 필드는 `schemaVersion`, `actorIds`, `digest`, `length`, `decisions`, `warnings`로 제한한다. `actorIds`에는 선정자·편집자·검증자의 UUID 세 개만 기록한다. MCP transport는 결과문을 receipt와 분리해 다뤄야 한다. MCP를 거치지 않고 직접 반환한 결과는 검사 성공 여부와 관계없이 `unverified`로 표시한다.

각 receipt의 경고는 해당 스키마의 유한한 `enum`에 있는 코드만 허용한다. finalizer 스키마는 런타임의 모든 결정적 경고를 열거한다. 역할 provider의 상세 설명은 별도 artifact에 남기고 receipt에는 계약에 정한 역할별 경고 코드만 넣는다.

## 평가 자료

`evals/legacy/translationese-100/corpus.jsonl`에는 이전 저장소의 100개 사례가 들어 있다. 평가 protocol, plan과 실패 회귀 사례도 함께 보존하며, `evals/legacy/provenance.json`이 원본 경로와 SHA-256을 고정한다. 이 자료는 회귀 평가에만 쓰며 현재 `SKILL.md`의 정본이 아니다. 독립 holdout은 `evals/FREEZE.json`의 digest로만 참조하고 구현 중에는 읽거나 수정하지 않는다.

기존 `ab87e153…` 후보의 실패 결과는 기준선으로 보존한다. 이 후보는 의미·보호 문자열·과잉 편집 억제 기준을 충족했지만 개선율 기준을 통과하지 못했고, 일부 채택 후보의 의미 보존에도 이견이 남았다. 실행별 수치와 무효 처리한 시도는 [평가 보고서](evals/EVALUATION_REPORT.md)에서 확인할 수 있다.

새 `0.1.0-rc2` 평가 경로는 후보문에서 문자 diff를 역산하지 않는다. 선정·편집·검증 역할이 구조화된 work product를 남기고, 평가 adapter가 기록된 edit 목록을 그대로 `finalizer-core.mjs`에 전달한다. 알려진 누락 18건과 유지·보류 20건의 진단을 먼저 세 번 통과해야 새 holdout을 만들 수 있다. 후보 commit과 정책·스키마·평가 기준을 동결한 뒤 비공개 holdout 30건을 포함해 정확히 세 번 실행하며, 세 실행의 역할 actor 9개가 모두 달라야 한다. 실행 결과는 새 파일에만 기록하고 기존 실패 결과나 동결 기준을 덮어쓰지 않는다.

사용자에게 보여 주는 진행 설명도 품질 대상이다. 예를 들어 `평가 영수증 연결`, `finalization까지 결속`처럼 내부 구현 개념을 직역해 명사를 쌓은 표현은 실제로 어떤 결과를 어느 단계까지 전달하고 무엇을 검사하는지 풀어 쓴다. 다만 코드, 스키마 필드와 사용자가 보호하라고 지정한 기술 식별자는 바꾸지 않는다.

## 제한

스크립트는 모델이나 외부 API를 호출하지 않는다. 보호 구간 검사는 문자 보존을 확인하지만 문장 전체의 의미 동등성을 판정하지 않는다. 의미 판정은 별도의 verification provider가 맡으며, 애매한 수정은 `retain`으로 결정한다.

## 라이선스

MIT License. 자세한 내용은 `LICENSE`에서 확인할 수 있다.
