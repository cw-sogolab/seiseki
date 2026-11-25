# 시안 렌더 확인 방법 (헤드리스 크롬 — 앱 브라우저 창은 쓰지 않음)

로컬 서버가 `http://127.0.0.1:8768/` 에서 `~/ilgong/hub/docs` 를 보여 줍니다(이미 떠 있음. 응답이 없으면 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8768/dev/v2/sian.html` 로 확인 후 부모에게 보고).

```sh
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT=<자기 scratchpad 폴더>          # 예: …/scratchpad/dev-a
mkdir -p $OUT/prof
"$C" --headless=new --no-first-run --no-default-browser-check --user-data-dir=$OUT/prof \
  --disable-crash-reporter --disable-gpu --hide-scrollbars \
  --window-size=2300,1900 --virtual-time-budget=8000 \
  --screenshot=$OUT/shot.png "http://127.0.0.1:8768/dev/v2/sian-X.html"
```
- 다른 에이전트와 겹치지 않게 **자기만의 `--user-data-dir`** 를 쓸 것.
- 페이지 아래쪽(추가 화면)을 보려면 `--window-size=2300,3600` 처럼 세로를 늘리거나, URL 뒤에 `#extra` 같은 앵커로 이동.
- 휴대폰 폭 확인: `--window-size=390,2400`.
- 결과 PNG 는 Read 도구로 열어 눈으로 본다. 확대가 필요하면 `sips -c <h> <w> --cropOffset <y> <x> in.png --out crop.png` 로 잘라 본다.
