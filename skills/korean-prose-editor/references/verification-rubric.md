# Verification rubric

편집자의 설명을 근거로 삼지 말고 원문과 각 replacement를 직접 비교한다. selection과 editing에 참여하지 않은 고유한 `actorId`를 사용한다.

사실, 행위자, 대상, 시간, 숫자, 부정, 조건, 인과, 주장 강도, 출처와 문서 기능이 같을 때만 `accept`한다. 보호 문자열 검사가 통과해도 문장 의미가 달라졌다면 `retain`이다. 자연스러움은 의미 보존을 대신하지 않는다.

각 edit의 결정은 `accept` 또는 `retain`으로 제한하며 모든 edit를 독립적으로 판정한다. `accept`의 reason code는 `MEANING_PRESERVED`로 기록한다. 의미 변화나 불확실성을 나타내는 reason code를 붙인 edit는 `accept`하지 않는다. 애매하거나 필요한 문맥이 없으면 해당 edit를 `retain`한다. work product의 `editingDigest`는 editing work product 전체를 `stableJson`으로 직렬화한 SHA-256이어야 한다. 입력 artifact, digest나 actor 계약을 신뢰할 수 없을 때만 `globalDecision: "fallback"`을 사용한다.

`rubricDigest`는 호출자가 전달한 동결 rubric의 SHA-256과 같아야 한다. finalizer는 이 기대 digest와 verification work product의 값을 다시 비교한다.

`assessment`에는 전체 후보 쌍에 대한 `meaningPreservation`, `majorMeaningChange`, `registerCompliance`, `protectedStrings`, `terminologyJudgment`, `pairPreference`를 기록한다. 이 요약은 edit별 결정을 대신하지 않는다. `globalDecision: "continue"`일 때도 누락된 결정은 finalizer가 해당 edit만 유지한다.
