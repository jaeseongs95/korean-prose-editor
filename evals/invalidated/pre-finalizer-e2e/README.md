# 무효 처리한 MCP 종단 기록

세 실행의 최초 `workflow-receipt.json`과 `workflow.sqlite3`는 평가 집계기가 배포 대상 `finalizer-core.mjs`를 호출하기 전에 만든 `final.jsonl`을 가리킨다. receipt 자체의 단계 순서·actor 결속·본문 비저장 검사는 통과했지만, 실제 finalizer 결과의 종단 증거로는 사용할 수 없다.

기존 파일은 성공 증거로 덮어쓰지 않고 이 디렉터리에 보존했다. 보호 구간 추출, 실제 finalizer 연결, 유한 warning enum과 최종 actor 배열 결속을 수정한 뒤 새 candidate commit으로 집계하고 MCP 기록을 다시 만든다. 원문, 역할 출력, 평가 규약, 정답과 합격선은 바꾸지 않았다.
