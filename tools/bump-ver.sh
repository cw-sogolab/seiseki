#!/bin/sh
# 화면 파일(css·js)을 고친 뒤 푸시하기 전에 실행: html 의 ?v= 를 새 값으로 바꿔
# 브라우저가 옛 css·js 를 기억해 두고 새 html 과 섞어 쓰는 일을 막습니다. (2026-10-21 그런 일로 화면이 깨짐)
cd "$(dirname "$0")/.." || exit 1
V=$(date +%Y%m%d%H%M)
for f in docs/dev/index.html docs/dev/admin.html; do
  sed -i.bak -E "s/\?v=[0-9A-Za-z]+/?v=$V/g" "$f" && rm -f "$f.bak"
done
echo "개발판 화면 버전: $V"
