import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, setDoc, addDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, writeBatch, runTransaction } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/* ===== 설정 ===== */
const C = window.MINIHOMPY_CONFIG || {};
const normName = n => String(n || '').replace(/\s+/g, '').trim();
const VILLAGES = (C.villages || []).map(v => ({ name: v.name || (v.leader + ' 마을'), leader: normName(v.leader), members: (v.members || []).map(normName).filter(Boolean) }));
const EXTRAS = (C.extras || []).map(normName).filter(Boolean);
const ALLOWED = (() => {
  const list = (C.allowedNames && C.allowedNames.length) ? C.allowedNames.map(normName) : [].concat(...VILLAGES.map(v => [v.leader].concat(v.members)), EXTRAS);
  return list.filter((n, i) => n && list.indexOf(n) === i);
})();
const VILLAGE_OF = {}; VILLAGES.forEach(v => { if (v.leader) VILLAGE_OF[v.leader] = v.name; v.members.forEach(m => { VILLAGE_OF[m] = v.name; }); });
const LEADERS = new Set(VILLAGES.map(v => v.leader));
const EMAIL_DOMAIN = C.authEmailDomain || 'minihompy.example.com';
const TITLE = C.title || '미니홈피';

/* ===== 유틸 ===== */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => (n < 10 ? '0' : '') + n;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function fmtDate(ts, withTime) {
  if (!ts) return '';
  const d = new Date(ts);
  let s = d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  if (withTime) s += ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  return s;
}
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }
function nameKey(name) { const b = new TextEncoder().encode(name); let s = 'u'; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
const KEY2NAME = {}; ALLOWED.forEach(n => { KEY2NAME[nameKey(n)] = n; });
const emailOf = key => key + '@' + EMAIL_DOMAIN;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const firstLine = s => (String(s || '').split('\n')[0] || '(제목 없음)');
const MOOD_ICON = { 즐거움: '😊', 행복: '😄', 감사: '🙏', 설렘: '💗', 평온: '😌', 심심: '😑', 피곤: '😪', 우울: '🌧️', 화남: '😠', 그리움: '🌙' };
const moodIcon = m => MOOD_ICON[m] || '😊';

/* ===== 상태 ===== */
let fs = null, auth = null, authReady = false;
const S = { session: null, route: null, key: null, name: null, room: null, visits: null, gbPublic: [], gbSecret: [], gb: [], diary: [], comments: [], likes: [], profiles: {}, editing: false, unsubs: [], profUnsub: null, lastMain: '' };
const curProfile = () => (S.key && S.profiles[S.key]) || null;
const isOwner = () => !!(S.session && S.key && S.session.key === S.key);

/* ===== 라우팅 ===== */
const TABS = [['home', '홈'], ['profile', '프로필'], ['diary', '다이어리'], ['room', '미니룸'], ['guestbook', '방명록'], ['friends', '일촌']];
function parseHash() {
  let h = location.hash.replace(/^#\/?/, '');
  try { h = decodeURIComponent(h); } catch (e) {}
  const parts = h.split('/').filter(Boolean);
  if (parts[0] && parts[0].charAt(0) === '@') return { page: parts[1] || 'home', sub: parts[2] || '', name: normName(parts[0].slice(1)) };
  return { page: 'root', sub: '', name: null };
}
const hompyPath = (name, page, sub) => '@' + name + (page && page !== 'home' ? '/' + page : '') + (sub ? '/' + sub : '');
const href = path => '#/' + encodeURI(path);
const go = path => { location.hash = '#/' + path; };
const shareUrl = name => location.origin + location.pathname + href(hompyPath(name));

function onRoute() {
  const r = parseHash(); S.route = r;
  if (!authReady) return;
  if (!S.session) { renderLogin(); return; }
  if (r.page === 'root' || !r.name) { location.replace(href(hompyPath(S.session.name))); return; }
  if (ALLOWED.indexOf(r.name) < 0) { renderNotFound(r.name); return; }
  const key = nameKey(r.name);
  if (key !== S.key) { S.key = key; S.name = r.name; subscribeHompy(key); countVisit(key); }
  if (r.sub === 'edit' && !isOwner()) { location.replace(href(hompyPath(r.name, r.page))); return; }
  if (TABS.map(t => t[0]).indexOf(r.page) < 0) { location.replace(href(hompyPath(r.name))); return; }
  S.editing = (r.sub === 'edit' && (r.page === 'room' || r.page === 'profile'));
  E = null; PE = null;
  renderTop(); renderLeft(); renderTabs(); renderMain();
}

/* ===== Firestore 구독 ===== */
function onSubErr(e) { console.error(e); toast(e && e.code === 'permission-denied' ? '읽기 권한이 없어요. firestore.rules가 적용됐는지 확인해 주세요.' : '데이터 연결에 문제가 생겼어요. 새로고침해 주세요.'); }
const rows = q => q.docs.map(d => Object.assign({ id: d.id }, d.data()));
function clearSubs() { S.unsubs.forEach(u => { try { u(); } catch (e) {} }); S.unsubs = []; }
function mergeGb() { S.gb = S.gbPublic.concat(S.gbSecret).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
function subscribeHompy(key) {
  clearSubs(); S.room = null; S.visits = null; S.gbPublic = []; S.gbSecret = []; S.gb = []; S.diary = []; S.comments = []; S.likes = [];
  const me = S.session.key;
  S.unsubs.push(onSnapshot(doc(fs, 'rooms', key), snap => { S.room = snap.exists() ? snap.data() : null; refresh(['main:home', 'main:room']); }, onSubErr));
  S.unsubs.push(onSnapshot(doc(fs, 'visits', key), snap => { S.visits = snap.exists() ? snap.data() : null; refresh(['top']); }, onSubErr));
  S.unsubs.push(onSnapshot(query(collection(fs, 'guestbook', key, 'entries'), orderBy('createdAt', 'desc'), limit(300)), q => { S.gbPublic = rows(q); mergeGb(); refresh(['main:home', 'main:guestbook']); }, onSubErr));
  const secretQ = me === key ? query(collection(fs, 'guestbook', key, 'secret'), orderBy('createdAt', 'desc'), limit(300)) : query(collection(fs, 'guestbook', key, 'secret'), where('authorKey', '==', me));
  S.unsubs.push(onSnapshot(secretQ, q => { S.gbSecret = rows(q); mergeGb(); refresh(['main:home', 'main:guestbook']); }, onSubErr));
  S.unsubs.push(onSnapshot(query(collection(fs, 'diary', key, 'posts'), orderBy('createdAt', 'desc'), limit(300)), q => { S.diary = rows(q); refresh(['main:home', 'main:diary']); }, onSubErr));
  S.unsubs.push(onSnapshot(query(collection(fs, 'diary', key, 'comments'), orderBy('createdAt', 'asc'), limit(3000)), q => { S.comments = rows(q); refresh(['main:home', 'main:diary']); }, onSubErr));
  S.unsubs.push(onSnapshot(query(collection(fs, 'diary', key, 'likes'), limit(5000)), q => { S.likes = rows(q); refresh(['main:home', 'main:diary']); }, onSubErr));
}
function subscribeProfiles() {
  if (S.profUnsub) return;
  S.profUnsub = onSnapshot(collection(fs, 'profiles'), q => {
    const m = {}; q.docs.forEach(d => { m[d.id] = d.data(); }); S.profiles = m;
    refresh(['left', 'main:home', 'main:profile', 'main:guestbook', 'main:diary', 'main:friends']);
  }, onSubErr);
}
function refresh(parts) {
  if (!S.session || !S.route || !S.key) return;
  const page = S.route.page; let mainDone = false;
  parts.forEach(p => {
    if (p === 'top') renderTop();
    else if (p === 'left') renderLeft();
    else if (p.indexOf('main:') === 0 && page === p.slice(5) && !S.editing && !mainDone) { renderMain(); mainDone = true; }
  });
}
async function countVisit(key) {
  if (!S.session || S.session.key === key) return;
  const d = todayStr(), flag = 'cy_v_' + key + '_' + d;
  if (ls.get(flag)) return;
  ls.set(flag, '1');
  try {
    const ref = doc(fs, 'visits', key);
    await runTransaction(fs, async tx => {
      const snap = await tx.get(ref); const cur = snap.exists() ? snap.data() : {};
      tx.set(ref, { total: (cur.total || 0) + 1, today: cur.date === d ? (cur.today || 0) + 1 : 1, date: d });
    });
  } catch (e) { console.warn(e); }
}

/* ===== 쓰기 도우미 ===== */
function errMsg(e) {
  const c = e && e.code;
  if (c === 'permission-denied') return '권한이 없어요. 본인 홈피가 아니거나 firestore.rules가 아직 적용되지 않았어요.';
  if (c === 'unavailable' || c === 'auth/network-request-failed') return '네트워크 연결을 확인해 주세요.';
  if (c === 'resource-exhausted') return 'Firebase 사용량 한도에 걸렸어요. 잠시 후 다시 시도해 주세요.';
  return '저장에 실패했어요. 다시 시도해 주세요.';
}
async function safe(fn, btn) {
  if (btn) btn.disabled = true;
  try { await fn(); return true; }
  catch (e) { console.error(e); toast(errMsg(e)); return false; }
  finally { if (btn) btn.disabled = false; }
}
function armed(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = '정말 삭제?';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
  return false;
}

/* ===== 기본값 ===== */
function defaultProfile(name, gender, now) { return { name, gender: gender || '', status: '', bgm: '', mood: '즐거움', intro: '', photo: '', createdAt: now, updatedAt: now }; }
function defaultRoom(name, gender) {
  return {
    title: name + '의 방', wall: 'yellow', floor: 'wood', bubble: '안녕하세요!',
    items: [
      { id: uid(), type: 'window', x: 285, y: 150, flip: false },
      { id: uid(), type: 'cross', x: 115, y: 112, flip: false },
      { id: uid(), type: 'bed', x: 282, y: 240, flip: false },
      { id: uid(), type: 'plant', x: 88, y: 236, flip: false },
      { id: uid(), type: 'table', x: 190, y: 236, flip: false },
      { id: uid(), type: gender === 'M' ? 'mm_m1' : 'mm_f1', x: 205, y: 300, flip: false }
    ]
  };
}

/* ===== 미니룸 SVG ===== */
const P = (u, v) => [200 + (u - v) * 20, 130 + (u + v) * 11.25];
const pts = arr => arr.map(p => p[0] + ',' + p[1]).join(' ');
function wallPattern(id, w, skew) {
  let inner;
  if (w.kind === 'dots') inner = '<circle cx="6" cy="6" r="2" fill="' + w.deco + '"/><circle cx="16" cy="14" r="1.5" fill="' + w.deco + '"/>';
  else if (w.kind === 'stripes') inner = '<rect x="0" y="0" width="20" height="4" fill="' + w.deco + '"/>';
  else inner = '<path d="M0 10H20M10 0V20" stroke="' + w.deco + '" stroke-width="1" fill="none"/>';
  return '<pattern id="' + id + '" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="skewY(' + skew + ')">' + inner + '</pattern>';
}
function floorSvg(f) {
  let s = '';
  if (f.id === 'wood') {
    for (let v = 0; v < 8; v++) {
      s += '<polygon points="' + pts([P(0, v), P(8, v), P(8, v + 1), P(0, v + 1)]) + '" fill="' + (v % 2 ? f.b : f.a) + '" stroke="' + f.line + '" stroke-width=".6"/>';
      for (let u = (v % 2 ? 1 : 3); u < 8; u += 4) { const a = P(u, v), b = P(u, v + 1); s += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="' + f.line + '" stroke-width=".6"/>'; }
    }
  } else if (f.id === 'tile') {
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++)
      s += '<polygon points="' + pts([P(u, v), P(u + 1, v), P(u + 1, v + 1), P(u, v + 1)]) + '" fill="' + ((u + v) % 2 ? f.b : f.a) + '" stroke="' + f.line + '" stroke-width=".5"/>';
  } else if (f.id === 'grass') {
    s += '<polygon points="' + pts([P(0, 0), P(8, 0), P(8, 8), P(0, 8)]) + '" fill="' + f.a + '"/>';
    for (let i = 0; i < 40; i++) { const u = ((i * 37) % 80) / 10 + .3, v = ((i * 53) % 80) / 10 + .3; const p = P(u, v); s += '<path d="M' + (p[0] - 3) + ' ' + p[1] + 'l3 -4 l3 4" fill="none" stroke="' + f.line + '" stroke-width="1"/>'; }
  } else {
    s += '<polygon points="' + pts([P(0, 0), P(8, 0), P(8, 8), P(0, 8)]) + '" fill="' + f.a + '"/>';
    s += '<polygon points="' + pts([P(.6, .6), P(7.4, .6), P(7.4, 7.4), P(.6, 7.4)]) + '" fill="none" stroke="' + f.line + '" stroke-width="1.2" stroke-dasharray="4 3"/>';
  }
  return s;
}
function bubbleSvg(x, y, text) {
  text = String(text).slice(0, 24);
  let w = 16; for (const ch of text) w += ch.charCodeAt(0) > 255 ? 11.5 : 6.5;
  const h = 22, bx = clamp(x - w / 2, 4, 396 - w), by = Math.max(4, y - h);
  return '<g><rect x="' + bx + '" y="' + by + '" width="' + w + '" height="' + h + '" rx="6" fill="#fff" stroke="#8aa6bf"/>' +
    '<polygon points="' + (x - 5) + ',' + (by + h) + ' ' + (x + 5) + ',' + (by + h) + ' ' + x + ',' + (by + h + 6) + '" fill="#fff" stroke="#8aa6bf"/>' +
    '<rect x="' + (x - 4.5) + '" y="' + (by + h - 1) + '" width="9" height="2" fill="#fff"/>' +
    '<text x="' + (bx + w / 2) + '" y="' + (by + 15) + '" text-anchor="middle" font-size="11" font-family="Gulim,Dotum,Apple SD Gothic Neo,sans-serif" fill="#333">' + esc(text) + '</text></g>';
}
function roomSvg(room, o) {
  o = o || {}; room = room || { wall: 'yellow', floor: 'wood', items: [] };
  const wall = WALLS.find(w => w.id === room.wall) || WALLS[0];
  const floor = FLOORS.find(f => f.id === room.floor) || FLOORS[0];
  let s = '<svg viewBox="0 0 400 332" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="미니룸">';
  s += '<defs>' + wallPattern('wl', wall, -29.36) + wallPattern('wr', wall, 29.36) + '</defs>';
  s += '<rect width="400" height="332" fill="#f7fbff"/>';
  s += '<polygon points="40,220 40,110 200,20 200,130" fill="' + wall.base + '"/><polygon points="40,220 40,110 200,20 200,130" fill="url(#wl)"/>';
  s += '<polygon points="200,130 200,20 360,110 360,220" fill="' + wall.base + '"/><polygon points="200,130 200,20 360,110 360,220" fill="url(#wr)"/>';
  s += '<polygon points="200,130 200,20 360,110 360,220" fill="rgba(0,0,0,.05)"/>';
  s += '<polygon points="40,220 40,214 200,124 200,130" fill="rgba(0,0,0,.12)"/><polygon points="200,130 200,124 360,214 360,220" fill="rgba(0,0,0,.18)"/>';
  s += floorSvg(floor);
  s += '<line x1="200" y1="20" x2="200" y2="130" stroke="rgba(0,0,0,.12)"/>';
  s += '<polygon points="40,110 200,20 360,110 360,220 200,310 40,220" fill="none" stroke="#9fb4c6" stroke-width="1.5"/>';
  (room.items || []).forEach(it => {
    const d = itemDef(it.type); if (!d) return;
    const w = d.cols * PX, h = d.lines * PX;
    s += '<g data-id="' + esc(it.id) + '" transform="translate(' + it.x + ' ' + it.y + ')">' +
      (o.edit ? '<rect x="' + (-w / 2) + '" y="' + (-h) + '" width="' + w + '" height="' + h + '" fill="transparent"/>' : '') +
      '<use href="#it-' + it.type + '" x="' + (-w / 2) + '" y="' + (-h) + '" width="' + w + '" height="' + h + '"' + (it.flip ? ' transform="scale(-1 1)"' : '') + '/>' +
      (o.edit && o.sel === it.id ? '<rect x="' + (-w / 2 - 2) + '" y="' + (-h - 2) + '" width="' + (w + 4) + '" height="' + (h + 4) + '" fill="none" stroke="#f26b1d" stroke-dasharray="3 2" stroke-width="1.2"/>' : '') +
      '</g>';
  });
  const mm = (room.items || []).find(i => String(i.type).indexOf('mm_') === 0);
  if (mm && room.bubble) { const d = itemDef(mm.type); s += bubbleSvg(mm.x, mm.y - d.lines * PX - 6, room.bubble); }
  return s + '</svg>';
}
function defaultAvatar(g) { const rows = (g === 'M' ? MM_M : MM_F).slice(0, 13); return '<svg viewBox="-2 -1 16 15" shape-rendering="crispEdges" aria-hidden="true">' + pixRects(rows, null) + '</svg>'; }
const photoHtml = p => (p && p.photo) ? '<img src="' + p.photo + '" alt="프로필 사진">' : defaultAvatar(p && p.gender);
function thumb(key) { const p = S.profiles[key]; return (p && p.photo) ? '<img class="thumb" src="' + p.photo + '" alt="">' : '<span class="thumb" style="display:inline-block;overflow:hidden;background:#fdf0b4">' + defaultAvatar(p && p.gender) + '</span>'; }
const sec = (title, color, sub, ext) => '<div class="sec"><span class="t ' + color + '">' + esc(title) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + (ext ? '<span class="ext">' + ext + '</span>' : '') + '</div>';

/* ===== 껍데기 ===== */
function renderTop() {
  const el = $('#booktop');
  if (!S.session || !S.key) { el.innerHTML = '<div class="counter"></div><div class="title">' + esc(TITLE) + '</div><div class="url"></div>'; return; }
  const v = S.visits || {}; const today = (v.date === todayStr() ? v.today : 0) || 0;
  el.innerHTML = '<div class="counter"><span class="pix">TODAY</span> <b class="hit">' + today + '</b> &nbsp;|&nbsp; <span class="pix">TOTAL</span> <b>' + (v.total || 0) + '</b></div>' +
    '<div class="title">' + esc(S.name) + '님의 미니홈피</div>' +
    '<div class="url"><span title="' + esc(shareUrl(S.name)) + '">' + esc(location.host + location.pathname) + '#/@' + esc(S.name) + '</span><button type="button" class="copybtn" data-act="copyurl">주소 복사</button></div>';
}
function renderLeft() {
  const el = $('#left');
  if (!S.session || !S.key) { el.innerHTML = '<div class="photo">' + defaultAvatar('F') + '</div><p class="status">어서오세요, ' + esc(TITLE) + '예요.</p><p class="small muted">이름과 비밀번호로 들어오면 나만의 미니홈피가 열려요.</p>'; return; }
  const p = curProfile() || {}; const me = isOwner();
  const opts = ALLOWED.map(n => { const joined = !!S.profiles[nameKey(n)]; return '<option value="' + esc(n) + '"' + (n === S.name ? ' selected' : '') + '>' + esc(n) + (joined ? '' : ' (미가입)') + '</option>'; }).join('');
  el.innerHTML = '<div class="photo">' + photoHtml(p) + '</div>' +
    '<p class="status">' + esc(p.status || (S.profiles[S.key] ? '(상태메시지가 없어요)' : '아직 미니홈피를 만들지 않았어요')) + '</p>' +
    '<p class="bgm">♪ <b>BGM</b> ' + esc(p.bgm || '설정된 BGM이 없어요') + '</p>' +
    '<div class="todaybox"><span class="pix muted">TODAY IS..</span><span class="mood">' + moodIcon(p.mood) + ' ' + esc(p.mood || '즐거움') + '</span></div>' +
    '<div class="history"><span class="pix">HISTORY</span><b>' + esc(S.name) + '</b> ' + (p.gender === 'M' ? '(남)' : p.gender === 'F' ? '(여)' : '') + ' ' + (p.createdAt ? fmtDate(p.createdAt) + '+' : '') + (p.intro ? '<div style="margin-top:4px;white-space:pre-wrap;word-break:break-word">' + esc(trunc(p.intro, 90)) + '</div>' : '') + '</div>' +
    '<div class="ownertabs"><span class="on">홈주인 ' + esc(S.name) + '</span><span data-act="gome">' + (me ? '내 홈피 (지금)' : '내 홈피 가기') + '</span></div>' +
    '<div class="pado"><label class="small" for="pado">★일촌 파도타기</label><select id="pado" data-act="pado">' + opts + '</select></div>' +
    '<p class="small muted" style="margin:10px 0 0">' + esc(S.session.name) + '님 로그인 중 · <span class="lnk" data-act="logout">로그아웃</span></p>';
}
function renderTabs() {
  const el = $('#tabs');
  if (!S.session || !S.key) { el.innerHTML = ''; return; }
  el.innerHTML = TABS.map(t => '<a class="tab' + (S.route.page === t[0] ? ' on' : '') + '" href="' + href(hompyPath(S.name, t[0])) + '">' + t[1] + '</a>').join('') +
    (isOwner() ? '' : '<a class="tab me" href="' + href(hompyPath(S.session.name)) + '">내 홈</a>');
}
function preserveInputs(root, keyName, fn) {
  const same = S.lastMain === keyName; S.lastMain = keyName;
  const saved = {}; let active = null, caret = 0;
  if (same) {
    $$('[data-keep]', root).forEach(i => { saved[i.dataset.keep] = i.type === 'checkbox' ? i.checked : i.value; });
    const a = document.activeElement; if (a && a.dataset && a.dataset.keep) { active = a.dataset.keep; caret = a.selectionStart || 0; }
  }
  fn();
  if (!same) return;
  Object.keys(saved).forEach(k => { const i = root.querySelector('[data-keep="' + k + '"]'); if (!i) return; if (i.type === 'checkbox') i.checked = saved[k]; else i.value = saved[k]; });
  if (active) { const a = root.querySelector('[data-keep="' + active + '"]'); if (a) { a.focus({ preventScroll: true }); try { a.setSelectionRange(caret, caret); } catch (e) {} } }
}
function renderMain() {
  const el = $('#main'); const r = S.route; const own = isOwner();
  preserveInputs(el, S.key + '|' + r.page + '|' + r.sub, () => {
    switch (r.page) {
      case 'home': el.innerHTML = pageHome(own); break;
      case 'profile': el.innerHTML = (r.sub === 'edit' && own) ? pageProfileEdit() : pageProfile(own); break;
      case 'diary': el.innerHTML = pageDiary(own); break;
      case 'room': el.innerHTML = (r.sub === 'edit' && own) ? pageRoomEdit() : pageRoom(own); break;
      case 'guestbook': el.innerHTML = pageGuestbook(own); break;
      case 'friends': el.innerHTML = pageFriends(); break;
      default: el.innerHTML = '<p class="empty">없는 페이지예요.</p>';
    }
  });
  if (r.page === 'room' && r.sub === 'edit' && own) initRoomEditor();
  if (r.page === 'profile' && r.sub === 'edit' && own) initProfileEditor();
}
function renderNotFound(name) {
  renderTop(); renderLeft(); $('#tabs').innerHTML = '';
  $('#main').innerHTML = sec('Not found', 'orange', '') + '<p class="empty">“' + esc(name) + '”님의 미니홈피는 없어요.</p><p class="tar"><button class="btn blue" data-act="gome">내 홈피로 가기</button></p>';
}
function renderSetup(msg) {
  renderTop(); renderLeft(); $('#tabs').innerHTML = '';
  $('#main').innerHTML = sec('Setup', 'orange', 'FIREBASE') + '<div class="setup"><p class="notice err">' + esc(msg) + '</p>' +
    '<ol><li>Firebase 콘솔에서 프로젝트를 만들고 <b>Authentication → 로그인 방법</b>에서 <b>이메일/비밀번호</b>를 켜요.</li>' +
    '<li><b>Firestore Database</b>를 만들고(프로덕션 모드) 규칙 탭에 저장소의 <code>firestore.rules</code> 내용을 붙여 넣어요.</li>' +
    '<li>프로젝트 설정 → 내 앱(웹)에서 SDK 설정값을 복사해 <code>js/config.js</code>의 <code>firebase</code>에 넣어요.</li>' +
    '<li><code>allowedNames</code>에 로그인 허용 이름을 적고 GitHub에 올리면 끝!</li></ol></div>';
}

/* ===== 로그인 ===== */
function renderLogin() {
  renderTop(); renderLeft(); $('#tabs').innerHTML = '';
  $('#main').innerHTML = sec('Login', 'orange', 'WELCOME') +
    '<div class="login"><h2>' + esc(TITLE) + '에 놀러오셨군요!</h2><div class="box"><form data-form="login" autocomplete="on">' +
    '<input type="text" name="name" placeholder="이름 (실명)" autocomplete="username" required maxlength="20">' +
    '<input type="password" name="pw" placeholder="비밀번호 (6자 이상)" autocomplete="current-password" required>' +
    '<div id="firstbox" class="hide"><p class="notice">첫 방문이시네요! 비밀번호를 한 번 더 입력하고 성별을 고르면 미니홈피가 만들어져요.</p>' +
    '<input type="password" name="pw2" placeholder="비밀번호 확인" autocomplete="new-password">' +
    '<div class="radios" style="margin:2px 0 10px"><label><input type="radio" name="gender" value="F" checked> 여자</label><label><input type="radio" name="gender" value="M"> 남자</label></div></div>' +
    '<div id="loginmsg" class="notice err hide"></div>' +
    '<div id="resetbox" class="resetbox hide"><p class="small muted">비밀번호를 잊었다면 관리자에게 계정 초기화를 요청하세요. 초기화된 뒤에는 위에 새 비밀번호를 적고 아래 버튼을 누르면 기존 홈피를 그대로 이어서 써요.</p><button type="button" class="btn" data-act="recreate">새 비밀번호로 다시 만들기</button></div>' +
    '<button class="btn orange" type="submit" style="width:100%;padding:7px;margin-top:8px">로그인</button></form>' +
    '<p class="help">회원가입 없이 이름과 비밀번호만으로 들어와요. 처음 들어올 때 정한 비밀번호가 그대로 쓰이고, 등록된 이름만 로그인할 수 있어요.</p></div></div>';
  const n = $('input[name=name]'); if (n) n.focus();
}
const CRED_ERRS = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'];
function authErr(e) {
  const c = e && e.code;
  if (CRED_ERRS.indexOf(c) >= 0) return '비밀번호가 맞지 않아요.';
  if (c === 'auth/too-many-requests') return '시도가 너무 많아요. 잠시 후 다시 해주세요.';
  if (c === 'auth/weak-password') return '비밀번호는 6자 이상이어야 해요.';
  if (c === 'auth/network-request-failed') return '네트워크 연결을 확인해 주세요.';
  if (c === 'auth/operation-not-allowed') return 'Firebase 콘솔에서 이메일/비밀번호 로그인을 켜주세요.';
  if (c === 'auth/admin-restricted-operation') return '지금은 새 가입을 받지 않아요. 관리자에게 문의하세요.';
  if (c === 'auth/invalid-email') return 'config.js의 authEmailDomain 값을 확인해 주세요.';
  if (c === 'auth/email-already-in-use') return '이미 만들어진 계정이에요. 비밀번호를 다시 확인해 주세요.';
  return (e && e.code) ? '로그인에 실패했어요 (' + e.code + ')' : errMsg(e);
}
function loginForm() { return $('form[data-form=login]'); }
function showLoginMsg(m) { const el = $('#loginmsg'); if (!el) return; el.textContent = m; el.classList.toggle('hide', !m); }
async function doLogin(form) {
  const btn = form.querySelector('button[type=submit]');
  const name = normName(form.name.value), pw = form.pw.value;
  showLoginMsg(''); $('#resetbox').classList.add('hide');
  if (ALLOWED.indexOf(name) < 0) return showLoginMsg('등록된 이름이 아니에요. 홈피 관리자에게 이름 등록을 요청하세요.');
  if (!pw || pw.length < 6) return showLoginMsg('비밀번호는 6자 이상이어야 해요.');
  const key = nameKey(name), email = emailOf(key);
  btn.disabled = true;
  try {
    const acc = await getDoc(doc(fs, 'accounts', key));
    if (acc.exists()) {
      try { await signInWithEmailAndPassword(auth, email, pw); }
      catch (e) { showLoginMsg(authErr(e)); if (CRED_ERRS.indexOf(e.code) >= 0) $('#resetbox').classList.remove('hide'); }
      return;
    }
    const fb = $('#firstbox');
    if (fb.classList.contains('hide')) { fb.classList.remove('hide'); form.pw2.focus(); return; }
    if (form.pw2.value !== pw) return showLoginMsg('비밀번호 확인이 달라요.');
    const gender = form.gender.value;
    try { await createUserWithEmailAndPassword(auth, email, pw); }
    catch (e) {
      if (e.code === 'auth/email-already-in-use') { await signInWithEmailAndPassword(auth, email, pw); }
      else throw e;
    }
    await ensureDocs(name, key, gender);
    setTimeout(() => toast('미니홈피가 만들어졌어요! 환영해요 🎉'), 400);
  } catch (e) { console.error(e); showLoginMsg(e && String(e.code || '').indexOf('auth/') === 0 ? authErr(e) : errMsg(e)); }
  finally { btn.disabled = false; }
}
async function ensureDocs(name, key, gender) {
  const now = Date.now();
  const acc = await getDoc(doc(fs, 'accounts', key));
  if (!acc.exists()) await setDoc(doc(fs, 'accounts', key), { name, createdAt: now });
  const prof = await getDoc(doc(fs, 'profiles', key));
  if (!prof.exists()) await setDoc(doc(fs, 'profiles', key), defaultProfile(name, gender, now));
  const room = await getDoc(doc(fs, 'rooms', key));
  if (!room.exists()) await setDoc(doc(fs, 'rooms', key), defaultRoom(name, gender));
}
async function recreateAccount(btn) {
  const form = loginForm(); if (!form) return;
  const name = normName(form.name.value), pw = form.pw.value;
  if (ALLOWED.indexOf(name) < 0 || !pw || pw.length < 6) return showLoginMsg('이름과 새 비밀번호(6자 이상)를 먼저 적어주세요.');
  const key = nameKey(name);
  btn.disabled = true;
  try {
    await createUserWithEmailAndPassword(auth, emailOf(key), pw);
    await ensureDocs(name, key, '');
    toast('새 비밀번호로 다시 만들었어요');
  } catch (e) {
    showLoginMsg(e.code === 'auth/email-already-in-use' ? '계정이 아직 초기화되지 않았어요. 비밀번호를 다시 확인하거나 관리자에게 초기화를 요청하세요.' : authErr(e));
  } finally { btn.disabled = false; }
}
function onAuth(u) {
  const wasReady = authReady; authReady = true;
  if (u && u.email) {
    const key = u.email.split('@')[0], name = KEY2NAME[key];
    if (!name) { S.session = null; signOut(auth); toast('등록된 이름이 아니라서 로그아웃했어요.'); }
    else {
      const first = !S.session;
      S.session = { name, key, uid: u.uid }; subscribeProfiles();
      if (first && wasReady) toast(name + '님, 어서오세요!');
    }
  } else {
    S.session = null; clearSubs(); if (S.profUnsub) { try { S.profUnsub(); } catch (e) {} S.profUnsub = null; }
    S.key = null; S.name = null; S.profiles = {}; S.lastMain = '';
  }
  onRoute();
}
async function logout() { try { await signOut(auth); } catch (e) {} location.hash = '#/'; toast('로그아웃했어요'); }
async function copyUrl() {
  const u = shareUrl(S.name);
  try { await navigator.clipboard.writeText(u); toast('미니홈피 주소를 복사했어요'); }
  catch (e) { window.prompt('이 주소를 복사하세요', u); }
}

/* ===== 페이지: 홈 ===== */
function pageHome(own) {
  const p = curProfile(); const room = S.room;
  const news = [];
  S.diary.slice(0, 3).forEach(d => news.push('<li><span class="badge">다이어리</span><a href="' + href(hompyPath(S.name, 'diary')) + '">' + esc(d.title || firstLine(d.text)) + '</a> <span class="muted small">' + fmtDate(d.createdAt) + '</span></li>'));
  S.gb.slice(0, 2).forEach(g => news.push('<li><span class="badge">방명록</span><a href="' + href(hompyPath(S.name, 'guestbook')) + '">' + esc(g.author) + ': ' + esc(trunc(g.text, 30)) + '</a></li>'));
  if (!news.length) news.push('<li class="muted">아직 새 소식이 없어요.</li>');
  const joined = Object.keys(S.profiles).length;
  const say = S.gb[0];
  return (p ? '' : '<p class="notice">' + esc(S.name) + '님은 아직 미니홈피를 만들지 않았어요. 방명록은 미리 남길 수 있어요.</p>') +
    sec('Updated news', 'orange', 'TODAY STORY') +
    '<div class="news"><ul>' + news.join('') + '</ul><table class="counts"><tr><td>다이어리 <b>' + S.diary.length + '</b></td><td>방명록 <b>' + S.gb.length + '</b></td></tr><tr><td>받은 공감 <b>' + S.likes.length + '</b></td><td>일촌 <b>' + joined + '</b></td></tr></table></div>' +
    sec('Mini Room', 'blue', 'EXPRESS YOURSELF', room ? esc(room.title || '') : '') +
    '<div class="roombox">' + roomSvg(room, {}) + '</div>' +
    '<div class="room-links">' + (own ? '<span class="lnk" data-act="go" data-to="' + esc(hompyPath(S.name, 'room', 'edit')) + '">미니룸 꾸미기</span>' : '') +
    '<span class="lnk" data-act="go" data-to="' + esc(hompyPath(S.name, 'room')) + '">미니룸 크게보기</span>' +
    '<span class="lnk" data-act="go" data-to="' + esc(hompyPath(S.name, 'guestbook')) + '">방명록 남기기</span></div>' +
    sec('What friends say', 'green', '') +
    '<div class="say">' + (say ? '<span class="who">' + esc(say.author) + '</span>' + esc(trunc(say.text, 80)) : '<span class="muted">아직 방명록이 없어요. 첫 글을 남겨보세요!</span>') + '</div>';
}

/* ===== 페이지: 프로필 ===== */
function pageProfile(own) {
  const p = curProfile();
  if (!p) return sec('Profile', 'orange', 'ABOUT ME') + '<p class="empty">' + esc(S.name) + '님은 아직 미니홈피를 만들지 않았어요.</p>';
  const g = p.gender === 'M' ? '남자' : p.gender === 'F' ? '여자' : '-';
  return sec('Profile', 'orange', 'ABOUT ME', own ? '<button class="btn sm" data-act="go" data-to="' + esc(hompyPath(S.name, 'profile', 'edit')) + '">프로필 수정</button>' : '') +
    '<div class="row" style="align-items:flex-start;gap:16px"><div class="photo" style="width:120px;height:120px;margin:0;flex:none">' + photoHtml(p) + '</div>' +
    '<table class="counts" style="flex:1;min-width:200px"><tr><td style="width:86px">이름</td><td><b style="color:var(--ink)">' + esc(p.name || S.name) + '</b></td></tr>' +
    '<tr><td>성별</td><td>' + g + '</td></tr><tr><td>상태메시지</td><td style="white-space:pre-wrap">' + esc(p.status || '-') + '</td></tr>' +
    '<tr><td>BGM</td><td>♪ ' + esc(p.bgm || '-') + '</td></tr><tr><td>오늘의 기분</td><td>' + moodIcon(p.mood) + ' ' + esc(p.mood || '-') + '</td></tr>' +
    '<tr><td>소개</td><td style="white-space:pre-wrap;word-break:break-word">' + esc(p.intro || '-') + '</td></tr><tr><td>가입일</td><td>' + (fmtDate(p.createdAt) || '-') + '</td></tr></table></div>';
}
let PE = null;
function pageProfileEdit() {
  const p = curProfile() || defaultProfile(S.name, '', Date.now());
  return '<form data-form="profile" id="pform">' + sec('Profile', 'orange', 'EDIT') +
    '<div class="formgrid">' +
    '<label class="k">사진</label><div><div class="photo" id="pphoto" style="width:120px;height:120px;margin:0 0 6px">' + photoHtml(p) + '</div>' +
    '<div class="row"><label class="btn">사진 올리기<input type="file" accept="image/*" data-act="photo" class="hide"></label><button type="button" class="btn" data-act="photodel">기본 사진으로</button></div><div class="small muted">정사각형으로 잘라 작게 저장돼요.</div></div>' +
    '<label class="k" for="f-status">상태메시지</label><input id="f-status" type="text" name="status" maxlength="60" value="' + esc(p.status) + '" placeholder="지금 기분이나 한마디">' +
    '<label class="k" for="f-bgm">BGM</label><input id="f-bgm" type="text" name="bgm" maxlength="60" value="' + esc(p.bgm) + '" placeholder="곡 제목 - 가수">' +
    '<label class="k">성별</label><div class="radios" style="padding-top:5px"><label><input type="radio" name="gender" value="F"' + (p.gender === 'F' ? ' checked' : '') + '> 여자</label><label><input type="radio" name="gender" value="M"' + (p.gender === 'M' ? ' checked' : '') + '> 남자</label></div>' +
    '<label class="k" for="f-mood">오늘의 기분</label><select id="f-mood" name="mood">' + MOODS.map(m => '<option' + (m === p.mood ? ' selected' : '') + '>' + m + '</option>').join('') + '</select>' +
    '<label class="k" for="f-intro">소개</label><textarea id="f-intro" name="intro" maxlength="300" placeholder="나를 소개해 보세요">' + esc(p.intro) + '</textarea>' +
    '</div><div class="actions"><button class="btn orange" type="submit">저장</button><button class="btn" type="button" data-act="go" data-to="' + esc(hompyPath(S.name, 'profile')) + '">취소</button></div></form>';
}
function initProfileEditor() { const p = curProfile(); PE = { photo: (p && p.photo) || '' }; }
function readPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const size = 180, c = document.createElement('canvas'); c.width = size; c.height = size;
        const ctx = c.getContext('2d'); const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82));
      } catch (e) { rej(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽을 수 없어요')); };
    img.src = url;
  });
}
async function handlePhoto(input) {
  const f = input.files && input.files[0]; if (!f || !PE) return;
  try { PE.photo = await readPhoto(f); $('#pphoto').innerHTML = '<img src="' + PE.photo + '" alt="프로필 사진">'; }
  catch (e) { toast('이미지를 불러오지 못했어요.'); }
  input.value = '';
}
async function saveProfile(form, btn) {
  const base = curProfile() || defaultProfile(S.name, '', Date.now());
  const p = {
    name: S.name,
    gender: (form.querySelector('input[name=gender]:checked') || {}).value || '',
    status: form.status.value.trim().slice(0, 60), bgm: form.bgm.value.trim().slice(0, 60),
    mood: form.mood.value, intro: form.intro.value.trim().slice(0, 300),
    photo: PE ? PE.photo : (base.photo || ''),
    createdAt: base.createdAt || Date.now(), updatedAt: Date.now()
  };
  const ok = await safe(() => setDoc(doc(fs, 'profiles', S.key), p), btn);
  if (ok) { toast('프로필을 저장했어요'); go(hompyPath(S.name, 'profile')); }
}

/* ===== 페이지: 다이어리 ===== */
function pageDiary(own) {
  const me = S.session.key;
  const write = own ? '<div class="diary-write"><input type="text" data-keep="dtitle" maxlength="60" placeholder="제목">' +
    '<textarea data-keep="dtext" maxlength="3000" placeholder="오늘은 어떤 하루였나요?" style="min-height:90px"></textarea>' +
    '<div class="row" style="justify-content:space-between;margin-top:6px"><label class="small">기분 <select data-keep="dmood">' + MOODS.map(m => '<option>' + m + '</option>').join('') + '</select></label><button class="btn orange" data-act="dwrite">일기 쓰기</button></div></div>' : '';
  const list = S.diary.length ? S.diary.map(d => {
    const lk = S.likes.filter(l => l.post === d.id); const liked = lk.some(l => l.authorKey === me); const likers = lk.map(l => l.name).filter(Boolean);
    const cm = S.comments.filter(c => c.post === d.id);
    const dt = new Date(d.createdAt || 0);
    return '<article class="post"><div class="ph"><span class="date">' + fmtDate(d.createdAt) + ' (' + DOW[dt.getDay()] + ')</span><span class="mood">' + moodIcon(d.mood) + ' ' + esc(d.mood || '') + '</span>' +
      (own ? '<span class="del"><button class="btn sm" data-act="ddel" data-id="' + esc(d.id) + '">삭제</button></span>' : '') + '</div>' +
      (d.title ? '<h3>' + esc(d.title) + '</h3>' : '') + '<div class="body"' + (d.title ? '' : ' style="padding-top:10px"') + '>' + esc(d.text) + '</div>' +
      '<div class="pf"><button class="like' + (liked ? ' on' : '') + '" data-act="like" data-id="' + esc(d.id) + '">♥ 공감 ' + lk.length + '</button>' +
      (likers.length ? '<span class="likers">' + esc(likers.slice(0, 3).join(', ')) + (likers.length > 3 ? ' 외 ' + (likers.length - 3) + '명' : '') + '</span>' : '') +
      '<span style="margin-left:auto">댓글 ' + cm.length + '</span></div>' +
      '<div class="cmts">' + cm.map(c => '<div class="cmt">' + thumb(c.authorKey) + '<span class="who">' + esc(c.author) + '</span><span class="txt">' + esc(c.text) + '</span><span class="when">' + fmtDate(c.createdAt, true) + '</span>' +
        ((own || c.authorKey === me) ? '<span class="lnk del" data-act="cdel" data-cid="' + esc(c.id) + '">삭제</span>' : '') + '</div>').join('') +
      '<div class="cmt-write"><textarea data-keep="c-' + esc(d.id) + '" maxlength="300" placeholder="댓글 달기"></textarea><button class="btn" data-act="cwrite" data-id="' + esc(d.id) + '">등록</button></div></div></article>';
  }).join('') : '<p class="empty">' + (own ? '첫 일기를 써보세요!' : '아직 일기가 없어요.') + '</p>';
  return sec('Diary', 'blue', 'MY STORY', '<b>' + S.diary.length + '</b>개') + write + list;
}
async function writeDiary(btn) {
  const title = $('[data-keep="dtitle"]').value.trim(), text = $('[data-keep="dtext"]').value.trim(), mood = $('[data-keep="dmood"]').value;
  if (!text) return toast('일기 내용을 입력하세요.');
  const ok = await safe(() => addDoc(collection(fs, 'diary', S.key, 'posts'), { title: title.slice(0, 60), text: text.slice(0, 3000), mood, author: S.session.name, createdAt: Date.now() }), btn);
  if (ok) { $('[data-keep="dtitle"]').value = ''; $('[data-keep="dtext"]').value = ''; toast('일기를 남겼어요'); }
}
async function toggleLike(id, btn) {
  const me = S.session.key; const ref = doc(fs, 'diary', S.key, 'likes', id + '_' + me);
  const liked = S.likes.some(l => l.post === id && l.authorKey === me);
  await safe(() => liked ? deleteDoc(ref) : setDoc(ref, { post: id, authorKey: me, name: S.session.name, createdAt: Date.now() }), btn);
}
async function writeComment(id, btn) {
  const ta = $('[data-keep="c-' + id + '"]'); const text = ta.value.trim(); if (!text) return toast('댓글 내용을 입력하세요.');
  const ok = await safe(() => addDoc(collection(fs, 'diary', S.key, 'comments'), { post: id, author: S.session.name, authorKey: S.session.key, text: text.slice(0, 300), createdAt: Date.now() }), btn);
  if (ok) ta.value = '';
}
async function deleteComment(cid) { await safe(() => deleteDoc(doc(fs, 'diary', S.key, 'comments', cid))); }
async function deletePost(id, btn) {
  const ok = await safe(() => {
    const b = writeBatch(fs);
    b.delete(doc(fs, 'diary', S.key, 'posts', id));
    S.comments.filter(c => c.post === id).forEach(c => b.delete(doc(fs, 'diary', S.key, 'comments', c.id)));
    S.likes.filter(l => l.post === id).forEach(l => b.delete(doc(fs, 'diary', S.key, 'likes', l.id)));
    return b.commit();
  }, btn);
  if (ok) toast('일기를 지웠어요');
}

/* ===== 페이지: 방명록 ===== */
function pageGuestbook(own) {
  const me = S.session.key;
  const write = '<div class="gb-write"><textarea data-keep="gb" maxlength="500" placeholder="' + esc(S.name) + '님에게 한마디 남겨요"></textarea>' +
    '<div class="row"><label class="small"><input type="checkbox" data-keep="gbsecret"> 비밀글 (홈피 주인과 나만 봐요)</label><button class="btn orange" data-act="gbwrite">남기기</button></div></div>';
  const list = S.gb.length ? S.gb.map((g, i) => {
    const canDel = own || g.authorKey === me;
    return '<div class="ent"><div class="no">No.' + (S.gb.length - i) + '</div><div><div class="head">' + thumb(g.authorKey) + '<span class="who">' + esc(g.author) + '</span><span class="when">' + fmtDate(g.createdAt, true) + '</span>' +
      (g.secret ? '<span class="badge">비밀</span>' : '') + (canDel ? '<span class="del"><button class="btn sm" data-act="gbdel" data-id="' + esc(g.id) + '" data-secret="' + (g.secret ? '1' : '') + '">삭제</button></span>' : '') + '</div>' +
      '<div class="txt">' + esc(g.text) + '</div></div></div>';
  }).join('') : '<p class="empty">아직 방명록이 없어요. 첫 글을 남겨보세요!</p>';
  return sec('Guestbook', 'pink', 'LEAVE A MESSAGE', '<b>' + S.gb.length + '</b>개') + write + '<div class="gb">' + list + '</div>';
}
async function writeGuestbook(btn) {
  const ta = $('[data-keep="gb"]'); const text = ta.value.trim(); if (!text) return toast('내용을 입력하세요.');
  const secret = !!$('[data-keep="gbsecret"]').checked;
  const ok = await safe(() => addDoc(collection(fs, 'guestbook', S.key, secret ? 'secret' : 'entries'), { author: S.session.name, authorKey: S.session.key, text: text.slice(0, 500), secret, createdAt: Date.now() }), btn);
  if (ok) { ta.value = ''; $('[data-keep="gbsecret"]').checked = false; toast('방명록을 남겼어요'); }
}
async function deleteGuestbook(id, secret, btn) { const ok = await safe(() => deleteDoc(doc(fs, 'guestbook', S.key, secret ? 'secret' : 'entries', id)), btn); if (ok) toast('방명록 글을 지웠어요'); }

/* ===== 페이지: 일촌 ===== */
function friendCard(n) {
  const k = nameKey(n), p = S.profiles[k];
  return '<a class="fr' + (p ? '' : ' off') + '" href="' + href(hompyPath(n)) + '">' + (p && p.photo ? '<img src="' + p.photo + '" alt="">' : defaultAvatar(p && p.gender)) +
    '<div style="min-width:0"><div class="nm">' + esc(n) + (LEADERS.has(n) ? ' <span class="badge">마을장</span>' : '') + (k === S.session.key ? ' (나)' : '') + '</div><div class="st">' + esc(p ? (p.status || '상태메시지 없음') : '아직 미니홈피가 없어요') + '</div></div></a>';
}
function pageFriends() {
  let body = '';
  if (VILLAGES.length && !(C.allowedNames && C.allowedNames.length)) {
    VILLAGES.forEach(v => {
      const names = [v.leader].concat(v.members).filter(Boolean);
      body += '<h3 class="vh">' + esc(v.name) + ' <span class="muted small">' + names.filter(n => S.profiles[nameKey(n)]).length + '/' + names.length + '</span></h3><div class="friends">' + names.map(friendCard).join('') + '</div>';
    });
    if (EXTRAS.length) body += '<h3 class="vh">함께하는 분들</h3><div class="friends">' + EXTRAS.map(friendCard).join('') + '</div>';
  } else body = '<div class="friends">' + ALLOWED.map(friendCard).join('') + '</div>';
  return sec('Friends', 'pink', 'ILCHON', '<b>' + Object.keys(S.profiles).length + '</b>/' + ALLOWED.length + '명 가입') + body;
}

/* ===== 페이지: 미니룸 ===== */
function pageRoom(own) {
  const room = S.room;
  return sec('Mini Room', 'blue', 'EXPRESS YOURSELF', room ? esc(room.title || '') : '') +
    '<div class="roombox big">' + roomSvg(room, {}) + '</div>' + (room ? '' : '<p class="muted small">아직 꾸민 미니룸이 없어요.</p>') +
    '<div class="room-links">' + (own ? '<span class="lnk" data-act="go" data-to="' + esc(hompyPath(S.name, 'room', 'edit')) + '">미니룸 꾸미기</span>' : '') + '</div>';
}
let E = null;
function pageRoomEdit() {
  return sec('Mini Room', 'blue', 'DECORATE') +
    '<div class="roombox editing" id="roombox"></div><div class="edtools" id="edtools"></div>' +
    '<div class="palcats" id="palcats">' + CATS.map(c => '<button type="button" data-act="edcat" data-cat="' + c[0] + '">' + c[1] + '</button>').join('') + '</div><div class="palette" id="palette"></div>' +
    '<div class="edrow"><label>벽지</label><div class="swatches" id="swW"></div></div><div class="edrow"><label>바닥</label><div class="swatches" id="swF"></div></div>' +
    '<div class="edrow"><label for="edTitle">방 이름</label><input id="edTitle" type="text" maxlength="20"></div>' +
    '<div class="edrow"><label for="edBubble">말풍선</label><input id="edBubble" type="text" maxlength="24" placeholder="미니미가 할 말"></div>' +
    '<div class="actions"><button class="btn orange" data-act="edsave">저장</button><button class="btn" data-act="go" data-to="' + esc(hompyPath(S.name, 'room')) + '">취소</button><button class="btn danger" data-act="edclear">모두 비우기</button></div>';
}
function initRoomEditor() {
  const p = curProfile();
  const base = S.room || defaultRoom(S.name, p && p.gender);
  E = { room: JSON.parse(JSON.stringify(base)), sel: null, cat: 'basic', drag: null };
  E.room.items = Array.isArray(E.room.items) ? E.room.items : [];
  $('#edTitle').value = E.room.title || ''; $('#edBubble').value = E.room.bubble || '';
  drawEditor(); drawPalette(); drawSwatches(); bindEditor();
}
function drawRoomOnly() { const box = $('#roombox'); if (box && E) box.innerHTML = roomSvg(E.room, { edit: true, sel: E.sel }); }
function drawEditor() {
  if (!E) return; drawRoomOnly();
  const it = E.room.items.find(i => i.id === E.sel);
  $('#edtools').innerHTML = it ?
    '<span class="sel">선택: ' + esc(itemDef(it.type).name) + '</span><button class="btn sm" data-act="edflip">좌우반전</button><button class="btn sm" data-act="edfront">앞으로</button><button class="btn sm" data-act="edback">뒤로</button><button class="btn sm danger" data-act="eddel">삭제</button>' :
    '<span class="sel">아이템을 누르면 선택되고, 끌어서 옮길 수 있어요. 아래에서 새 아이템을 골라 넣으세요.</span>';
}
function drawPalette() {
  $$('#palcats button').forEach(b => b.classList.toggle('on', b.dataset.cat === E.cat));
  $('#palette').innerHTML = Object.keys(ITEMS).filter(t => ITEMS[t].cat === E.cat).map(t => {
    const d = itemDef(t);
    return '<button type="button" class="pal-item" data-act="edadd" data-type="' + t + '" title="' + esc(d.name) + '"><svg viewBox="0 0 ' + d.cols + ' ' + d.lines + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><use href="#it-' + t + '"/></svg>' + esc(d.name) + '</button>';
  }).join('');
}
function drawSwatches() {
  $('#swW').innerHTML = WALLS.map(w => '<button type="button" class="sw' + (E.room.wall === w.id ? ' on' : '') + '" data-act="edwall" data-id="' + w.id + '" title="' + esc(w.name) + '" aria-label="' + esc(w.name) + '" style="background:' + w.base + ';background-image:radial-gradient(' + w.deco + ' 2px,transparent 2.5px);background-size:8px 8px"></button>').join('');
  $('#swF').innerHTML = FLOORS.map(f => '<button type="button" class="sw' + (E.room.floor === f.id ? ' on' : '') + '" data-act="edfloor" data-id="' + f.id + '" title="' + esc(f.name) + '" aria-label="' + esc(f.name) + '" style="background:repeating-linear-gradient(90deg,' + f.a + ' 0 5px,' + f.b + ' 5px 10px);box-shadow:inset 0 0 0 1px ' + f.line + '"></button>').join('');
}
function svgPoint(svg, e) { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }; }
function bindEditor() {
  const box = $('#roombox');
  box.addEventListener('pointerdown', e => {
    if (!E) return; const svg = box.querySelector('svg'); if (!svg) return;
    const g = e.target.closest('g[data-id]');
    if (!g) { if (E.sel) { E.sel = null; drawEditor(); } return; }
    const id = g.getAttribute('data-id'); const it = E.room.items.find(i => i.id === id); if (!it) return;
    const pt = svgPoint(svg, e);
    E.drag = { id, dx: pt.x - it.x, dy: pt.y - it.y, g };
    if (E.sel !== id) { E.sel = id; drawEditor(); E.drag.g = box.querySelector('g[data-id="' + id + '"]'); }
    try { box.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!E || !E.drag) return; const svg = box.querySelector('svg'); const it = E.room.items.find(i => i.id === E.drag.id); if (!svg || !it) return;
    const pt = svgPoint(svg, e);
    it.x = Math.round(clamp(pt.x - E.drag.dx, 8, 392)); it.y = Math.round(clamp(pt.y - E.drag.dy, 12, 328));
    if (E.drag.g) E.drag.g.setAttribute('transform', 'translate(' + it.x + ' ' + it.y + ')');
  });
  const end = () => { if (E && E.drag) { E.drag = null; drawRoomOnly(); } };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}
function editorAct(act, el) {
  const items = E.room.items; const idx = items.findIndex(i => i.id === E.sel);
  switch (act) {
    case 'edcat': E.cat = el.dataset.cat; drawPalette(); return;
    case 'edadd': {
      if (items.length >= 40) return toast('아이템은 40개까지 놓을 수 있어요.');
      const it = { id: uid(), type: el.dataset.type, x: 200 + Math.round(Math.random() * 60 - 30), y: 250 + Math.round(Math.random() * 20 - 10), flip: false };
      items.push(it); E.sel = it.id; drawEditor(); return;
    }
    case 'edflip': if (idx >= 0) { items[idx].flip = !items[idx].flip; drawEditor(); } return;
    case 'edfront': if (idx >= 0) { items.push(items.splice(idx, 1)[0]); drawEditor(); } return;
    case 'edback': if (idx >= 0) { items.unshift(items.splice(idx, 1)[0]); drawEditor(); } return;
    case 'eddel': if (idx >= 0) { items.splice(idx, 1); E.sel = null; drawEditor(); } return;
    case 'edwall': E.room.wall = el.dataset.id; drawRoomOnly(); drawSwatches(); return;
    case 'edfloor': E.room.floor = el.dataset.id; drawRoomOnly(); drawSwatches(); return;
    case 'edclear': if (!armed(el)) return; E.room.items = []; E.sel = null; drawEditor(); return;
    case 'edsave': saveRoom(el); return;
  }
}
async function saveRoom(btn) {
  const room = { title: ($('#edTitle').value || '').trim().slice(0, 20) || (S.name + '의 방'), wall: E.room.wall, floor: E.room.floor, bubble: ($('#edBubble').value || '').trim().slice(0, 24), items: E.room.items.map(i => ({ id: i.id, type: i.type, x: i.x, y: i.y, flip: !!i.flip })), updatedAt: Date.now() };
  const ok = await safe(() => setDoc(doc(fs, 'rooms', S.key), room), btn);
  if (ok) { toast('미니룸을 저장했어요'); go(hompyPath(S.name, 'room')); }
}

/* ===== 이벤트 ===== */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act.indexOf('ed') === 0 && E) { editorAct(act, el); return; }
  switch (act) {
    case 'go': go(el.dataset.to); break;
    case 'gome': if (S.session) go(hompyPath(S.session.name)); break;
    case 'logout': logout(); break;
    case 'copyurl': copyUrl(); break;
    case 'recreate': recreateAccount(el); break;
    case 'gbwrite': writeGuestbook(el); break;
    case 'gbdel': if (armed(el)) deleteGuestbook(el.dataset.id, !!el.dataset.secret, el); break;
    case 'dwrite': writeDiary(el); break;
    case 'ddel': if (armed(el)) deletePost(el.dataset.id, el); break;
    case 'like': toggleLike(el.dataset.id, el); break;
    case 'cwrite': writeComment(el.dataset.id, el); break;
    case 'cdel': if (armed(el)) deleteComment(el.dataset.cid); break;
    case 'photodel': if (PE) { PE.photo = ''; const f = $('#pform'); const g = (f.querySelector('input[name=gender]:checked') || {}).value; $('#pphoto').innerHTML = defaultAvatar(g); } break;
  }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'pado' && el.value && el.value !== S.name) go(hompyPath(el.value));
  if (el.dataset.act === 'photo') handlePhoto(el);
});
document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.form === 'login') { e.preventDefault(); doLogin(f); }
  if (f.dataset.form === 'profile') { e.preventDefault(); saveProfile(f, f.querySelector('button[type=submit]')); }
});
document.addEventListener('input', e => {
  if (!E) return;
  if (e.target.id === 'edBubble') { E.room.bubble = e.target.value.slice(0, 24); drawRoomOnly(); }
  if (e.target.id === 'edTitle') { E.room.title = e.target.value.slice(0, 20); }
});
window.addEventListener('hashchange', onRoute);

/* ===== 시작 ===== */
(function init() {
  $('#symdefs').innerHTML = buildSymbols();
  document.title = TITLE;
  renderTop(); renderLeft();
  const f = C.firebase || {};
  if (!f.apiKey || /여기에|^$/.test(f.apiKey) || !f.projectId || /프로젝트ID/.test(f.projectId)) return renderSetup('js/config.js에 Firebase 설정이 아직 없어요.');
  if (!ALLOWED.length) return renderSetup('js/config.js의 allowedNames가 비어 있어요.');
  try {
    const app = initializeApp(f); auth = getAuth(app); fs = getFirestore(app);
  } catch (e) { console.error(e); return renderSetup('Firebase 초기화에 실패했어요: ' + (e.message || e)); }
  onAuthStateChanged(auth, onAuth, e => { console.error(e); renderSetup('로그인 상태를 확인할 수 없어요: ' + (e.message || e)); });
})();
