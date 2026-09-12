# 무효 처리한 MCP 기록 시도

두 번째 run 2 기록 시도는 finalization provider의 `gate.policy`가 `mandatory`여서 MCP가 이를 독립 감사 gate로 해석했다. 이 provider는 결정적 finalizer이며 감사자 역할이 아니므로 `GATE_FAILED`가 맞는 결과다.

실패 데이터베이스를 보존하고 finalization gate를 `completion`/`conditional`로 정정한다. 단계 자체와 output schema 검증, reference-only 정책은 그대로 유지한다. 언어 판단 정책·후보·평가 규약은 바꾸지 않는다. 정정한 standalone commit을 다시 import한 뒤 새 데이터베이스에서 기록을 재실행한다.
