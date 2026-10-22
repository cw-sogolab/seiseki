#!/bin/sh
# 개발판(docs/dev/)에서 확인한 화면을 본판(docs/)으로 옮깁니다.
#   - 화면 파일(index.html — 학생·강사 한 파일, 강사는 #teacher)과 assets/*.js, *.css 를 복사. 개발판에 없는 html(예: 옛 admin.html)은 본판에서도 지움
#   - config.js 는 본판·개발판이 같이 쓰는 한 파일(docs/assets/config.js)이라 건드리지 않음
# 옮긴 뒤 커밋·푸시하면 본판에 반영. Apps Script 를 고쳤다면 본판 Apps Script 에도 Core.gs·Logic.gs·Code.gs 를 붙여넣고 「새 버전」으로 배포.
cd "$(dirname "$0")/.." || exit 1
for f in docs/dev/assets/*; do
  name=$(basename "$f")
  [ "$name" = "config.js" ] && continue
  cp "$f" "docs/assets/$name"
done
for f in docs/dev/*.html; do
  h=$(basename "$f")
  sed 's#\.\./assets/config\.js#assets/config.js#' "$f" > "docs/$h"
done
for f in docs/*.html; do
  h=$(basename "$f")
  [ -f "docs/dev/$h" ] || rm -f "$f"
done
echo "본판(docs/)에 반영했어요. 커밋·푸시하면 1~2분 뒤 열립니다."
