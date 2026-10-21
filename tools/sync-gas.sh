#!/bin/sh
# 공통 로직(개발판 기준)을 Apps Script 폴더로 복사합니다. core.js·logic.js·Code.gs 를 고친 뒤 실행하세요.
# 버전: core.js + logic.js + Code.gs 내용의 해시를 logic.js 의 VERSION 에 넣음 → 서버와 화면이 다르면 강사 화면이 경고
cd "$(dirname "$0")/.." || exit 1
V=$(node -e "
const fs=require('fs'),c=require('crypto');
const s=f=>fs.readFileSync(f,'utf8').replace(/var VERSION = '[^']*';/,\"var VERSION = '';\");
process.stdout.write(c.createHash('sha1').update(s('docs/dev/assets/core.js')+s('docs/dev/assets/logic.js')+s('apps-script/Code.gs')).digest('hex').slice(0,10));")
sed -i.bak -E "s/var VERSION = '[^']*';/var VERSION = '$V';/" docs/dev/assets/logic.js && rm -f docs/dev/assets/logic.js.bak
cp docs/dev/assets/core.js apps-script/Core.gs
cp docs/dev/assets/logic.js apps-script/Logic.gs
echo "복사 완료: apps-script/Core.gs, apps-script/Logic.gs (개발판 기준, 버전 $V)"
