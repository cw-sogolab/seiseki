#!/bin/sh
# Core.gs + Logic.gs + Code.gs 를 한 파일(apps-script/_합본.gs)로 합칩니다.
# Apps Script 편집기에는 이 파일 하나만 Code.gs 에 통째로 붙여넣어도 됩니다 (파일 3개로 나눠 붙여도 같음).
cd "$(dirname "$0")/.." || exit 1
sh tools/sync-gas.sh >/dev/null
{ printf '/* 성적노트 서버 — Core.gs + Logic.gs + Code.gs 를 한 파일로 합친 것 (편집기에 한 번에 붙여넣기용). 원본은 GitHub cw-sogolab/seiseki 의 apps-script/ */\n\n'
  cat apps-script/Core.gs; printf '\n\n'; cat apps-script/Logic.gs; printf '\n\n'; cat apps-script/Code.gs; } > apps-script/_합본.gs
echo "만듦: apps-script/_합본.gs"
