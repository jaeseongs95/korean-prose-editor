# 계약 사용법

모든 교환 객체는 `schemaVersion: "1.0.0"`을 사용한다. JSON Schema는 `contracts/`에 있다.

`provider-plan`은 selection, editing, verification 순서의 `actorIds` 세 개를 요구한다. 각 값은 격리된 역할 실행에서 새로 만든 canonical lowercase UUID여야 하고 서로 달라야 한다. `providers.finalization.kind`는 `deterministic`이며 `actorId`를 갖지 않는다. 호출 환경에서 서브에이전트를 사용할 수 없으면 계획을 유효한 것으로 축소하지 않는다. UUID 고유성은 협력적 역할 분리를 위한 실행 표식이며 암호학적 신원 증명은 아니다.

편집안은 UTF-16 코드 단위 기준의 반열린 범위 `[start, end)`를 쓴다. 각 edit에는 고유한 `id`, 원문 digest, `start`, `end`, `replacement`와 editing provider의 `actorId`가 들어간다. 범위가 겹치거나 원문 digest가 다르면 전체 fallback 대상이다.

verification 결과는 edit마다 하나의 결정을 가져야 한다. `accept`는 뜻과 보존 조건을 만족한다고 독립적으로 확인한 경우에만 쓴다. 나머지는 `retain`이다. 결정이 빠진 edit도 `retain`으로 처리한다.

최종 receipt의 허용 최상위 필드는 `schemaVersion`, `actorIds`, `digest`, `length`, `decisions`, `warnings`다. `actorIds`는 선정자·편집자·검증자 세 UUID를 순서대로 기록한다. 원문이나 결과문을 유추할 수 있는 발췌, edit replacement, 자유 서술 경고를 넣지 않는다.
