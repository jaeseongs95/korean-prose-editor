# 무효 처리한 평가 실행

첫 평가 입력은 holdout의 원본 `category`와 의미 있는 사례 ID를 그대로 노출했다. `translationese_needing_edit`, `natural_original` 같은 값이 selection과 verification 판단에 정답 힌트를 주므로 맹검 조건을 충족하지 않는다.

진행 중이던 실행을 발견 즉시 중단했고, 이미 작성된 모든 산출물과 당시 입력·키·manifest를 이 디렉터리에 보존했다. 이 결과는 품질 지표나 릴리스 판정에 사용하지 않는다. 원문 사례, 정답과 합격선은 바꾸지 않고 평가용 ID를 불투명하게 바꾸며 장르를 `holdout`으로 통일한 새 입력에서 세 실행을 처음부터 다시 수행한다.
