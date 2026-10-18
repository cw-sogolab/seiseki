/* 설치 때 한 번만 고치는 파일 (본판·개발판이 같이 씀).
 * API_URL.prod: 본판 기록장의 Apps Script 웹앱 주소 (https://script.google.com/macros/s/…/exec)
 * API_URL.dev : 개발판 기록장의 웹앱 주소. 주소가 /dev/ 로 열리면 이쪽을 씀
 * 비워 두면 서버 없이 예시 데이터로 도는 「미리보기 모드」로 열립니다. 주소 뒤에 ?demo 를 붙여도 미리보기 모드.
 */
window.SEISEKI_CONFIG = {
  API_URL: {
    prod: 'https://script.google.com/macros/s/AKfycbxuRR-RrgYh3F8__JPOF-qaC3RCwTiiGgOdYMw4kJ3KvQr_QVCQ-BUJqh8DSfFZCHjOEg/exec',
    dev: 'https://script.google.com/macros/s/AKfycbwRTtPTkc2s5W2AFriR-ARUy2YXjRudHk4Fv2YOyntm_ashG_UNisVfiTIaLwxFOe73/exec'
  }
};
