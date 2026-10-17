# 우리 미니홈피 (싸이월드 스타일)

GitHub Pages에 올리는 정적 사이트 + Firebase(Authentication, Firestore)로 동작해요.
설정값은 전부 `js/config.js` 한 파일에서 관리합니다.

```
index.html        페이지 뼈대
css/style.css     싸이월드 스타일
js/config.js      ★ 이름 목록, Firebase 설정 (여기만 고치면 됨)
js/items.js       미니룸 가구·미니미 픽셀 데이터, 벽지/바닥, 기분 목록
js/app.js         앱 로직
firestore.rules   Firestore 보안 규칙 (콘솔에 붙여넣기)
```

## 처음 설정 (10분)

1. **Firebase 프로젝트 만들기** — https://console.firebase.google.com 에서 프로젝트 추가. (애널리틱스는 꺼도 돼요)
2. **로그인 방법 켜기** — Authentication → 시작하기 → 로그인 방법 → **이메일/비밀번호** 사용 설정.
   - 실제 이메일은 쓰지 않아요. 이름을 변환한 가짜 주소(`u…@minihompy.example.com`)로 로그인해요.
3. **Firestore 만들기** — Firestore Database → 데이터베이스 만들기 → 프로덕션 모드 → 위치는 `asia-northeast3`(서울) 추천.
4. **보안 규칙 넣기** — Firestore → 규칙 탭에 이 저장소의 `firestore.rules` 내용을 통째로 붙여넣고 게시.
5. **웹 앱 등록** — 프로젝트 설정(톱니) → 내 앱 → 웹(`</>`) 추가 → 나오는 `firebaseConfig` 값을 `js/config.js`의 `firebase`에 그대로 넣기.
6. **이름 목록** — `js/config.js`의 `allowedNames`에 로그인을 허용할 실명을 적기.
7. **GitHub Pages 켜기** — 저장소 Settings → Pages → Source: *Deploy from a branch*, Branch: `main` / `(root)` → 저장.
   잠시 후 `https://<계정>.github.io/<저장소>/` 로 접속.

## 쓰는 법

- 첫 접속: 이름 + 비밀번호(6자 이상)를 넣으면 계정과 미니홈피가 만들어져요. 다음부터는 같은 이름·비밀번호로 로그인.
- 각 미니홈피 주소는 `…/#/@이름` 이에요. 상단 **주소 복사** 버튼으로 복사해 공유하세요.
- 남의 홈피에서는 방명록(공개/비밀글)과 일기 공감·댓글만 할 수 있어요. 프로필·미니룸·일기 쓰기는 본인만.

## 운영 팁

- **가입 마감**: 모두 가입한 뒤 Firebase 콘솔 → Authentication → 설정 → 사용자 작업에서 *만들기(가입) 사용 설정*을 끄면 새 계정이 더 못 생겨요. (이름 목록은 클라이언트에서만 검사하므로, 이 설정이 실제 잠금이에요)
- **비밀번호 초기화**: 콘솔 → Authentication → 사용자에서 해당 계정(`u…@` 주소)을 삭제하세요. 본인이 다시 로그인 화면에서 새 비밀번호를 넣고 **새 비밀번호로 다시 만들기**를 누르면 기존 홈피 데이터가 그대로 이어져요. (위 가입 마감을 켜 두었다면 잠시 풀어야 해요)
- **이름 빼기**: `allowedNames`에서 지우면 그 사람은 다음 접속부터 로그인이 막혀요. 데이터는 남아 있어요.
- **가구 추가**: `js/items.js`의 `ITEMS`에 픽셀 그리드(문자 한 칸 = 픽셀 하나, `.`은 투명)를 추가하면 꾸미기 팔레트에 바로 나타나요.
- Firebase 웹 설정값(apiKey 등)은 공개돼도 되는 값이에요. 보안은 `firestore.rules`가 맡아요.
- 무료 요금제(Spark)로 충분해요. 사진은 180px로 줄여 Firestore 문서에 저장하므로 Storage는 쓰지 않아요.
