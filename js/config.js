/* =====================================================================
   미니홈피 설정 — 이 파일만 고치면 돼요. (GitHub에서 관리)
   ===================================================================== */
window.MINIHOMPY_CONFIG = {

  /* 상단에 보일 이름 */
  title: '우리 미니홈피',

  /* 마을별 명단. 마을장(leader)과 마을원(members) 모두 로그인할 수 있어요.
     이름을 지우면 그 사람은 다음 접속부터 로그인이 막혀요. (데이터는 남아요) */
  villages: [
    { name: '강영훈 마을', leader: '강영훈', members: ['김지우', '손주현', '차병석', '이수아'] },
    { name: '김수진 마을', leader: '김수진', members: ['김세경', '윤준석', '김혜성', '김정민', '김민지', '정우혁'] },
    { name: '박제니 마을', leader: '박제니', members: ['안채영', '장윤정', '김영준', '정다운'] },
    { name: '김예주 마을', leader: '김예주', members: ['김보람', '지세민', '최은총', '조설진', '유정현', '황윤진', '김유림'] },
    { name: '신지훈 마을', leader: '신지훈', members: ['이은진', '김미정', '서동혁', '송재용'] },
    { name: '이도연 마을', leader: '이도연', members: ['심효진'] },
    { name: '이혜진 마을', leader: '이혜진', members: ['김현식', '배수현', '배기원', '정하은', '전하라'] },
    { name: '조영주 마을', leader: '조영주', members: ['성민제', '김인경', '이은오', '최지희'] }
  ],

  /* 마을에 속하지 않는 분들 (목사님 등) */
  extras: ['박찬우', '최윤일'],

  /* 마을 구조 없이 이름만 쭉 적고 싶으면 위 둘 대신 이 배열을 쓰면 돼요. (비워두면 villages + extras 사용) */
  allowedNames: [],

  /* Firebase 인증에 쓰는 가짜 이메일 도메인. 실제 메일이 가지 않으니 아무 값이나 괜찮지만,
     한 번 정하면 바꾸지 마세요. (바꾸면 모두 새 계정이 돼요) */
  authEmailDomain: 'minihompy.example.com',

  /* Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) → SDK 설정에서 복사해 넣으세요. */
  firebase: {
    apiKey: 'AIzaSyDr6ytilz9SkZk6bAIFygt1cGhUArqSz68',
    authDomain: 'woori-2y2t-leadership.firebaseapp.com',
    projectId: 'woori-2y2t-leadership',
    storageBucket: 'woori-2y2t-leadership.firebasestorage.app',
    messagingSenderId: '395399249351',
    appId: '1:395399249351:web:a542181de79e8bf5832de2',
    measurementId: 'G-WJPYN6E5PH'
  }
};
