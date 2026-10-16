#!/bin/sh
# 공통 로직(개발판 기준)을 Apps Script 폴더로 복사합니다. core.js·logic.js 를 고친 뒤 실행하세요.
cd "$(dirname "$0")/.." || exit 1
cp docs/dev/assets/core.js apps-script/Core.gs
cp docs/dev/assets/logic.js apps-script/Logic.gs
echo "복사 완료: apps-script/Core.gs, apps-script/Logic.gs (개발판 기준)"
