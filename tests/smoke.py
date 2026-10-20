"""python3 tests/smoke.py — 미리보기 모드로 학생·강사 화면을 실제 브라우저에서 눌러 봅니다."""
import pathlib, sys, tempfile
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'docs'
tmp = pathlib.Path(tempfile.mkdtemp()) / 'page.jpg'
Image.new('RGB', (1200, 1600), (240, 240, 230)).save(tmp)
fails = []
def check(cond, what):
    print(('  ok  ' if cond else '  FAIL ') + what)
    if not cond: fails.append(what)

with sync_playwright() as p:
    b = p.chromium.launch()
    for base, width in ((ROOT, 1200), (ROOT, 390), (ROOT / 'dev', 390)):
        isdev = base.name == 'dev'
        pg = b.new_page(viewport={'width': width, 'height': 900}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        print(f'student {"개발판" if isdev else "본판"} @{width}')
        pg.goto((base / 'index.html').as_uri() + '?demo')  # 서버 주소가 있어도 미리보기 모드로
        check(pg.is_visible('.devbar') == isdev and pg.title().startswith('[개발판]') == isdev, '개발판 띠·제목 ' + ('있음' if isdev else '없음'))
        check(pg.is_visible('#demo'), '미리보기 안내 표시')
        pg.fill('#sid', '1234 ab'); pg.click('#go'); pg.wait_for_timeout(300)
        check('영문 2자' in pg.inner_text('#loginMsg'), '잘못된 번호 안내')
        pg.fill('#sid', 'km 482 919'); pg.click('#go'); pg.wait_for_selector('#app:not([hidden])')
        txt = pg.inner_text('#panel')
        check(('1주차 소테스트' in txt or '경제 1주차' in txt) and '틀린 문항' in txt, '테스트 결과 표시')
        check('3주차 숙제' in txt or '3주차 일문일답' in txt, '숙제 목록 표시')
        pg.click('#panel button[data-hw="H3"]')
        pg.set_input_files('#ph', [str(tmp), str(tmp)]); pg.fill('#cnt', '60'); pg.click('#send')
        pg.wait_for_function("document.querySelector('#panel').innerText.includes('사진 2장')", timeout=8000)
        check(True, '사진 2장 제출 → 제출 완료로 바뀜')
        check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), '가로 스크롤 없음')
        check(not errs, '스크립트 오류 없음 ' + ' / '.join(errs))
        pg.close()

        print(f'admin {"개발판" if isdev else "본판"} @{width}')
        pg = b.new_page(viewport={'width': width, 'height': 900}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        pg.goto((base / 'admin.html').as_uri() + '?demo')
        check(pg.is_visible('.devbar') == isdev, '개발판 띠 ' + ('있음' if isdev else '없음'))
        check(not pg.is_visible('#topRight'), '로그인 전 머리띠 메뉴 숨김')
        pg.fill('#pw', 'nope'); pg.click('#go'); pg.wait_for_timeout(300)
        check('달라요' in pg.inner_text('#loginMsg'), '틀린 비밀번호 안내')
        pg.fill('#pw', 'demo'); pg.click('#go'); pg.wait_for_selector('#view:not([hidden])')
        pg.select_option('#exSel', 'E3')
        pg.fill('#stIn', '최더미'); pg.fill('#ansIn', '111111111111111'); pg.press('#ansIn', 'Enter')
        pg.wait_for_function("document.querySelector('#emsg').innerText.includes('저장')")
        check('최더미 저장' in pg.inner_text('#emsg'), '답안 입력 → 저장·채점')
        pg.click('nav button[data-t="exams"]')
        if pg.query_selector('.chiprow'):   # 새 시험 탭 (개발판 먼저 — 본판은 promote 뒤에 같아짐)
            pg.click('.chiprow [data-es="정치"]'); pg.click('[data-reg="GN-정치-T1"]')
            pg.wait_for_function("document.querySelector('#nMsg').innerText.includes('등록했어요')")
            check('정치 1주차' in pg.inner_text('#view') and '등록됨' in pg.inner_text('.plist'), '답지 목록에서 한 번에 시험 등록')
            pg.click('details.manual summary')
            pg.fill('#nL', '정치 4주차'); pg.fill('#nT', '5'); pg.fill('#nA', '12341'); pg.click('#nAdd')
            pg.wait_for_function("document.querySelector('#nMsg').innerText.includes('정치 4주차')")
            check('정치 4주차' in pg.inner_text('#view'), '목록에 없는 시험 직접 등록')
        else:
            pg.fill('#nL', '4주차 소테스트'); pg.fill('#nT', '5'); pg.fill('#nA', '12341'); pg.click('#nAdd')
            pg.wait_for_function("document.querySelector('#nMsg').innerText.includes('등록')")
            check('4주차 소테스트' in pg.inner_text('#view'), '시험 등록')
        pg.click('nav button[data-t="hw"]')
        pg.wait_for_selector('#hSel')
        check('미제출' in pg.inner_text('#view'), '숙제 현황 표')
        pg.click('nav button[data-t="stu"]')
        pg.fill('#paste', '홍길동(예시고)\t종합과목 개념(경제)(화목20:20)\n모르는반\t영어반')
        pg.click('#issue'); pg.wait_for_selector('#iOut .okbox')
        out = pg.inner_text('#iOut')
        check('새 번호 1명' in out and '확인이 필요한 줄 1개' in out, '명단 붙여넣기 → 새 원생 1명 번호 발급, 1줄 확인 요청')
        pg.click('nav button[data-t="month"]'); pg.select_option('#mC', 'GN-HM')
        t = pg.inner_text('#view')
        check('평균' in t and '홍길동' in t, '월말 표에 새 학생 포함')
        pg.fill('textarea[data-ev="TR520615"]', '복습을 꾸준히 함'); pg.press('textarea[data-ev="TR520615"]', 'Tab')
        pg.wait_for_function("document.querySelector('#mOut').innerText.includes('저장')")
        check(True, '학생평가 저장')
        pg.click('#mCp'); pg.wait_for_timeout(300)
        check('복사' in pg.inner_text('#mOut'), '표 복사(또는 수동 복사 안내)')
        check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), '가로 스크롤 없음')
        check(not errs, '스크립트 오류 없음 ' + ' / '.join(errs))
        pg.click('nav button[data-t="stu"]'); pg.click('[data-ed="TR520615"]'); pg.uncheck('[data-cc="GN-HM"]'); pg.click('#ccSave')
        pg.wait_for_function("document.querySelector('#sMsg').innerText.includes('저장')")
        check(True, '반 수정 저장')
        if isdev: pg.screenshot(path=str(ROOT.parent / 'tests' / '_admin_dev.png'), full_page=True)
        pg.close()
    b.close()
print('\n실패 ' + str(len(fails)) + '건' if fails else '\n전부 통과')
sys.exit(1 if fails else 0)
