# Editing policy

selection에서 `edit`로 지정한 prose unit만 수정한다. 각 edit는 선정자가 기록한 `issueRanges` 중 하나와 겹쳐야 하며, 그 범위가 가리키는 구체적인 결함만 고친다. `retain`, `defer`, fenced-code unit에는 edit를 만들지 않는다. 원문과 문체 샘플에 없는 사실이나 표현상의 확신을 보태지 않으며, 자동 보호 구간과 `additionalProtectedStrings`에 걸치는 edit도 만들지 않는다.

사용자 대상 산문에서 명사구가 세 개 이상 쌓여 관계가 흐려졌다면 조사와 동사를 사용해 누가 무엇을 하는지 드러낸다. 내부 구현 개념을 옮긴 표현도 독자가 확인할 수 있는 행동이나 결과로 바꾼다. `영수증 연결`, `게이트`, `결속`은 이 현상의 예시일 뿐 금칙어 목록이 아니다. 반대로 같은 낱말이 기술 계약을 정확히 가리키면 바꾸지 않는다. 이 규칙을 코드·백틱, 스키마 필드, 명시적 고정 문자열과 보호 문자열에는 적용하지 않는다.

각 edit는 source unit의 `unitId`, 서로 겹치지 않는 UTF-16 `[start, end)` 범위와 replacement로 표현한다. 바뀌지 않는 공통 접두부와 접미부를 범위에 포함하지 말고 실제로 달라지는 최소 범위만 지정한다. 여러 안전한 수정과 불확실한 수정이 섞여 있으면 안전한 수정만 제안한다. 문장을 합치거나 나눌 때는 주어, 부정, 조건, 인과, 시간 관계와 병렬 구조를 다시 대조한다.

편집자는 `editing-draft`에 판단 결과인 edit만 기록한다. 호스트 recorder가 해당 사례의 selection work product를 `stableJson`으로 직렬화한 SHA-256을 `selectionDigest`로, 모든 edit를 역순으로 적용해 재구성한 후보 문자열의 SHA-256을 `candidateDigest`로 계산해 `editing-work-product`를 봉인한다. draft와 각 edit의 `actorId`는 editing provider의 ID와 같아야 한다.

검증자의 결정을 예상하거나 verification 결과를 작성하지 않는다.
