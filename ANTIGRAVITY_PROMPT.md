# Antigravity에 붙여 넣을 프롬프트

아래 점선 안의 내용을 그대로 복사해서 Antigravity 채팅창에 붙여 넣으세요.
(붙여 넣기 전에 ① Firebase 설정 값 6개, ② 관리자 구글 이메일을 준비해 두세요. Firebase 콘솔 → ⚙ 프로젝트 설정 → 내 앱 → SDK 설정에 있습니다.)

---------------------------------------------------------------

이 폴더(home)는 Vite + React + Firebase로 만든 '선생님 홈' 웹앱이야. README.md를 먼저 읽고 아래 순서대로 진행해 줘.
초보자니까 한 단계씩 쉬운 말로 설명하면서 하고, 브라우저에서 내가 직접 로그인하거나 허용/승인 버튼을 눌러야 하는 순간에는 반드시 멈추고 알려 줘.

지켜야 할 원칙
- 내 개인정보(이메일, 학교 이름 등)와 API 키는 코드 파일에 절대 넣지 말고 .env 와 환경변수로만 처리해.
- .env 는 깃허브에 올리지 마 (.gitignore에 이미 들어 있음).
- 깃허브 저장소는 반드시 비공개(private)로 만들어.
- 내가 요청하지 않은 기능이나 디자인은 바꾸지 마.

1단계. 환경 파일 만들기
- .env.example 을 복사해서 .env 를 만들어 줘. 값은 내가 지금부터 알려 줄게. 먼저 필요한 값 목록(VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID, VITE_ADMIN_EMAILS, VITE_DAILY_UPLOAD_GB)을 보여 주고 물어봐 줘.
- 나이스 관련 값(VITE_NEIS_*)은 비워 둬. 앱 안의 'API 변경' 버튼으로 넣을 거야.

2단계. Firebase 보안 규칙 준비
- firestore.rules 맨 위의 'your-email@gmail.com' 을 내가 알려 주는 관리자 이메일로 바꿔 줘 (.env 의 VITE_ADMIN_EMAILS 와 같은 값).
- 그다음 firestore.rules, storage.rules, firestore.indexes.json 을 Firebase 콘솔(프로젝트 jjinDB)에 어떻게 붙여 넣고 게시하는지 화면 위치를 알려 주고, 내가 했다고 말할 때까지 기다려 줘. (Firebase CLI가 설치되어 있고 로그인돼 있으면 `firebase deploy --only firestore,storage` 로 해도 돼. 그 경우 firebase.json 은 이미 있어. 실행 전에 나한테 확인받아.)

3단계. 로컬 실행 확인
- `npm install` 하고 `npm run dev` 로 실행한 뒤 http://localhost:5173 을 열어 보라고 알려 줘.
- 구글 로그인 → 첫 화면(학사일정 달력)이 뜨는지, 왼쪽 탭 4개(링크 모음/파일 모음/웹앱/메모)가 자동으로 생기는지 확인하게 해 줘.
- 콘솔(F12)에 "The query requires an index" 오류가 나오면, 그 메시지 안의 링크를 클릭해 인덱스를 만들라고 안내해 줘.
- 오류가 나면 원인을 설명하고 고쳐 줘. 단, 기능은 바꾸지 마.

4단계. 깃허브 푸시
- git 저장소를 초기화하고, 커밋 메시지 '선생님 홈 MVP' 로 커밋해 줘.
- gh CLI가 있으면 `gh repo create` 로 비공개 저장소를 만들어 푸시하고, 없으면 깃허브 웹에서 비공개 저장소를 만드는 방법을 알려 준 뒤 remote 추가와 push 명령을 실행해 줘. 로그인 창이나 승인 화면이 뜨면 멈추고 나에게 알려 줘.

5단계. Vercel 배포
- Vercel에서 이 저장소를 Import 해서 배포하는 절차를 알려 줘 (Framework: Vite, 그대로 두면 됨). vercel CLI가 있으면 `vercel` 명령으로 해도 되는데, 실행 전에 확인받아.
- Environment Variables 에 .env 의 항목을 하나씩 넣어야 한다고 알려 주고, 그 목록을 보여 줘 (값은 화면에 출력하지 말고 .env 에서 보라고 해).
- api/comcigan.js 는 Vercel 서버 함수야. 배포 후 https://배포주소/api/comcigan?school=학교이름 으로 열어 JSON이 나오는지 확인하는 방법을 알려 줘.
- 배포가 끝나면 Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 Vercel 주소(xxx.vercel.app)를 추가해야 로그인이 된다고 안내해 줘.

6단계. 마무리
- 배포 주소로 접속해 관리자로 로그인 → 첫 화면 오른쪽 위 '⚙ API 변경' 에 나이스 인증키·시도교육청코드·행정표준코드·학교 이름을 넣으라고 안내해 줘 (이 값들은 코드에 넣지 않고 앱 안에서만 저장함).
- 내가 나중에 따라 할 수 있도록, 이번에 실제로 한 명령과 순서를 정리한 안내서를 DEPLOY_NOTES.md 로 저장해 줘.

---------------------------------------------------------------
