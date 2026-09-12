# 무효 처리한 MCP 기록 시도

run 2의 첫 MCP 기록 시도는 mandatory completion stage가 요구하는 `gate-verdict` artifact를 기록 스크립트가 제출하지 않아 `MISSING_EVIDENCE`로 종료됐다. 실패한 SQLite 파일을 삭제하거나 성공 결과로 덮지 않고 이 디렉터리에 보존했다. 언어 판단 산출물이나 고정 평가 결과에는 영향이 없으며, 기록 스크립트에 누락 artifact를 추가한 뒤 새 데이터베이스에서 다시 실행한다.
