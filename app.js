/* 행동힙합 — 스포티파이 구조.
   왼쪽 라이브러리 / 가운데 목록 / 오른쪽 '지금 재생'(본문·대기열) / 아래 재생 바.
   권 = 앨범, 장 = 플레이리스트, 꼭지 = 트랙, 본문 = 가사 화면. */
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const fmt = t => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + pad2(t % 60); };
const fmtLong = t => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60); return h ? `${h}시간 ${m}분` : `${m}분`; };
const store = (k, v) => { try { localStorage.setItem('hh.' + k, JSON.stringify(v)); } catch (e) {} };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem('hh.' + k)); return v == null ? d : v; } catch (e) { return d; } };
const key = (v, k) => v + '-' + k;
const isMobile = () => matchMedia('(max-width:900px)').matches;

let DATA = null, YTP = null, ytReady = false, pendingPlay = null;
const Q = { list: [], i: -1, ctx: null, orig: null };            // 대기열: [{v,k,s}], ctx = {type, v, c, id, name}
let SEL = null;                                                   // 오른쪽 패널에 보이는 꼭지 {v,k}
const S = {                                                       // 저장되는 설정
  vol: load('vol', 80), muted: load('muted', false), shuffle: load('shuffle', false), repeat: load('repeat', 0),
  liked: load('liked', []), pls: load('pls', []), recent: load('recent', []), plays: load('plays', {}),
  libf: 'album', libTouched: load('libTouched', {}),
};
const save = () => { for (const k of ['vol', 'muted', 'shuffle', 'repeat', 'liked', 'pls', 'recent', 'plays', 'libTouched']) store(k, S[k]); };

/* ══ 데이터 ══ */
const _m = location.search.match(/albums=(\w+)/); if (_m) document.body.dataset.albums = _m[1];
window.APPV = '1790841450';                                        // 이 코드의 판 번호 (앱생성.py 가 넣는다)
/* 폰이 옛 코드를 붙들고 있으면 음악이 끊기는 등 엉뚱한 증상이 난다. 새 판이 올라와 있으면 한 번 새로 받는다. */
fetch('ver.txt', { cache: 'no-store' }).then(r => r.text()).then(v => {
  v = (v || '').trim();
  if (v && v !== window.APPV && !location.search.includes('v=' + v)) location.replace(location.pathname + '?v=' + v + location.hash);
}).catch(() => {});
const _p = location.search.match(/[?&]p=([^&]+)/); if (_p) history.replaceState(null, '', location.pathname + '#/' + decodeURIComponent(_p[1]).replace(/^\/+/, ''));   // 책의 링크·QR (?p=b/권/꼭지/곡) → 해시 경로
const V = (document.querySelector('script[src*="app.js"]')?.src.match(/v=(\d+)/) || [])[1] || Date.now();   // index.html 이 app.js 에 붙인 판 번호 → 데이터도 같은 번호로 (GitHub Pages 10분 캐시 회피)
fetch('data.json?v=' + V).then(r => r.json()).then(d => {
  DATA = d;
  d.books.forEach((b, v) => { b.v = v; b.tracks.forEach((t, k) => { t.v = v; t.k = k; }); b.chapters.forEach((c, ci) => { c.v = v; c.ci = ci; }); });
  renderLib(); route(); restoreQueue(); if (!LIST) { const t = curTrack(); LIST = t ? { type: 'album', v: t.v } : { type: 'album', v: 2 }; renderList(); }
  const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
});
window.onYouTubeIframeAPIReady = () => {
  YTP = new YT.Player('yt', { width: 120, height: 68, videoId: '', playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 0 },
    events: { onReady: () => { ytReady = true; P.setVolume(S.vol); if (S.muted) P.mute(); if (pendingPlay) { pendingPlay(); pendingPlay = null; } }, onStateChange: onState } });
};
const book = v => DATA.books[v], trk = (v, k) => DATA.books[v].tracks[k];
const cur = () => Q.i >= 0 ? Q.list[Q.i] : null;
const curTrack = () => { const q = cur(); return q ? trk(q.v, q.t) : null; };
const liked = (v, k) => S.liked.some(x => x[0] === v && x[1] === k);
const trackDur = t => t.music.reduce((a, m) => a + (m.dur || 0), 0);
const pl = id => S.pls.find(p => p.id === id);

/* ══ 라우팅 ══ */
window.addEventListener('hashchange', route);
const go = h => { location.hash = h; };
function route() {
  if (!DATA) return;
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  { const M = $('#main');                                         // 보던 자리를 기억했다가 되돌아오면 그 자리로 (맨 위로 튕기지 않게)
    if (PREV_HASH !== null) SCROLLPOS[PREV_HASH] = M.scrollTop;
    M.scrollTop = 0;
    const want = SCROLLPOS[location.hash] || 0;
    if (want) requestAnimationFrame(() => { M.scrollTop = want; });
    PREV_HASH = location.hash; }
  PAGE = null;
  { const b = $('#mback'); const h = location.hash || '#/';
    b && (b.hidden = ['#', '#/', '#/search', '#/lib'].includes(h)); }   // 아래 탭으로 갈 수 있는 화면에선 뒤로가 필요 없다
  setTimeout(mtop, 0);                                            // 상단 고정 줄 (화면 그린 뒤)
  const nav = p[0] || 'home';
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
  $('#q').value = nav === 'search' ? (p[1] || '') : $('#q').value;
  if (nav === 'b' && p[2]) { const v = +p[1] - 1, k = +p[2] - 1; if (trk(v, k)) { viewTrack(v, k); if (p[3]) autoPlay(v, k, +p[3] - 1); return; } }
  if (nav === 'b') return viewBook(+p[1] - 1);
  if (nav === 'c') return viewChapter(+p[1] - 1, +p[2] - 1);
  if (nav === 'pl') return viewPlaylist(p[1]);
  if (nav === 'liked') return viewLiked();
  if (nav === 'artist') return viewArtist();
  if (nav === 'search') return viewSearch(p[1] || '', p[2] || 'all');
  if (nav === 'log') return viewLog();
  if (nav === 'v') return p[1] ? viewVideo(p[1]) : viewVideos();
  if (nav === 'lib') return viewLibMobile();
  viewHome();
}
$('#back').onclick = () => history.back(); $('#fwd').onclick = () => history.forward();
let qTimer; $('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => go('#/search/' + encodeURIComponent($('#q').value.trim())), 250); });
$('#mback').onclick = () => history.back();
$('#q').addEventListener('focus', () => { if (!location.hash.startsWith('#/search')) go('#/search'); });

/* ══ 왼쪽 라이브러리 ══ */
function libItems() {
  const items = [];
  items.push({ type: 'liked', name: '좋아요 표시한 꼭지', sub: `플레이리스트 · ${S.liked.length}곡`, href: '#/liked', ico: '♥', t: S.libTouched.liked || 0 });
  const nv = Object.keys((DATA && DATA.vid) || {}).length;
  if (nv) items.push({ type: 'video', name: '행동영상', sub: `영상 · ${nv}편`, href: '#/v', img: 'cover-video.jpg', t: S.libTouched.video || 0 });
  S.pls.forEach(p => items.push({ type: 'pl', id: p.id, name: p.name, sub: `플레이리스트 · ${p.items.length}곡`, href: '#/pl/' + p.id, ico: '♫', cls: 'pl', t: p.t || 0 }));
  DATA.books.forEach(b => items.push({ type: 'album', v: b.v, name: b.name, sub: '앨범 · 배준익', href: '#/b/' + b.vol, img: b.cover, t: S.libTouched[key(b.v, 'a')] || 0 }));
  DATA.books.forEach(b => b.chapters.forEach(c => items.push({ type: 'pl', v: b.v, ci: c.ci, name: c.title, sub: `플레이리스트 · ${b.vol}권 ${c.label}`, href: `#/c/${b.vol}/${c.ci + 1}`, img: b.tracks[c.from - 1].thumb, t: S.libTouched[key(b.v, 'c' + c.ci)] || 0 })));
  return items;
}
function renderLib() {
  const q = ($('#libq').value || '').toLowerCase();
  let items = libItems().filter(i => S.libf === 'album' ? (i.type === 'album' || i.type === 'video') : i.type !== 'album').filter(i => !q || i.name.toLowerCase().includes(q));
  items = [...items.filter(i => i.type !== 'video'), ...items.filter(i => i.type === 'video')];   // 행동영상은 늘 맨 아래
  const c = cur(); const h = location.hash.split('/').slice(0, 3).join('/');
  let html = '', lastV = null;
  for (const i of items) {
    if (S.libf !== 'album' && i.ci != null && i.v !== lastV) { html += `<div class="lib-sec">${esc(book(i.v).name)}</div>`; lastV = i.v; }
    const playing = c && Q.ctx && ((i.type === 'album' && Q.ctx.type === 'album' && Q.ctx.v === i.v) || (i.type === 'pl' && i.ci != null && Q.ctx.type === 'chapter' && Q.ctx.v === i.v && Q.ctx.c === i.ci) || (i.type === 'pl' && i.id && Q.ctx.type === 'pl' && Q.ctx.id === i.id) || (i.type === 'liked' && Q.ctx.type === 'liked'));
    const on = LIST && ((i.type === 'album' && LIST.type === 'album' && LIST.v === i.v) || (i.ci != null && LIST.type === 'chapter' && LIST.v === i.v && LIST.c === i.ci) || (i.id && LIST.type === 'pl' && LIST.id === i.id) || (i.type === 'liked' && LIST.type === 'liked'));
    html += `<a href="${i.href}" class="${on ? 'on' : ''} ${playing ? 'playing' : ''}" data-ctx="${i.type}|${i.v ?? ''}|${i.ci ?? ''}|${i.id ?? ''}">${i.img ? `<img src="${i.img}" alt="">` : `<span class="ico ${i.cls || ''}">${i.ico}</span>`}<span style="min-width:0"><b>${esc(i.name)}</b><small>${esc(i.sub)}</small></span></a>`;
  }
  $('#lib').innerHTML = '<div class="lib">' + html + '</div>';
  $$('#lib a').forEach(a => a.oncontextmenu = e => { e.preventDefault(); const [type, v, ci, id] = a.dataset.ctx.split('|'); ctxMenu(e, ctxItems({ type: type === 'pl' && ci !== '' ? 'chapter' : type, v: +v, c: +ci, id })); });
}
$$('#chips button').forEach(b => b.onclick = () => { $$('#chips button').forEach(x => x.classList.remove('on')); b.classList.add('on'); S.libf = b.dataset.f; renderLib(); });
$('#libq').oninput = renderLib;
$('#newpl').onclick = () => newPlaylist();
function touch(k) { S.libTouched[k] = Date.now(); save(); }

/* ══ 홈 ══ */
function viewHome() {
  const c = cur(); const last = S.recent[0];
  const f = c ? book(c.v) : last ? book(last[0]) : book(2);                     // 크게 보여줄 앨범: 듣는 중 > 마지막 읽던 > 3권
  const total = f.tracks.reduce((a, t) => a + trackDur(t), 0);
  const on = Q.ctx && Q.ctx.type === 'album' && Q.ctx.v === f.v && playing();
  $('#view').innerHTML = `
    ${introHtml()}
    <div class="pad" style="padding-bottom:0"><div class="h2"><span>${c ? '듣는 중' : last ? '이어서' : '먼저 읽어보기'}</span></div></div>
    <div class="feat" style="--c:${f.color}"><img class="fcv" src="${f.cover}" alt=""><div class="ftx">
      <div class="ftag">${esc(f.tag || '앨범')}</div><h1>${esc(f.name)}</h1>
      <p class="fintro">${esc(f.intro || '')}</p>
      <div class="fmeta">${f.tracks.length}곡${total ? ' · ' + fmtLong(total) : ''} · ${f.chapters.map(x => esc(x.title)).join(' · ')}</div>
      <div class="fbtns"><button class="playbig" id="fplay">${on ? '❚❚' : '▶'}</button><a class="btn ghost" href="#/b/${f.vol}">앨범 열기</a>${last ? `<a class="btn ghost" href="#/b/${book(last[0]).vol}/${pad2(last[1] + 1)}">이어 읽기 · ${pad2(last[1] + 1)} ${esc(trk(last[0], last[1]).title)}</a>` : ''}</div></div></div>
    <div class="pad">${todayHtml()}
      <div class="h2"><span>행동힙합 1~6권</span><small>배준익</small></div>
      <div class="albums">${DATA.books.map(b => `<div class="alb${b.v === f.v ? ' on' : ''}" data-go="#/b/${b.vol}" data-ctx="album|${b.v}"><img src="${b.cover}" alt=""><div class="at"><b>${esc(b.name)}</b><small>${esc(b.tag || '')} · ${b.tracks.length}곡</small><p>${esc(b.intro || '')}</p></div><button class="go" data-playctx="album|${b.v}">▶</button></div>`).join('')}</div>
    </div>`;
  $('#fplay').onclick = () => togglePlayCtx({ type: 'album', v: f.v });
  bindCards();
}
/* ══ 홈 맨 위 소개 ══ 늘 같은 자리에 같은 것이 뜬다. 아래 앨범 칸은 듣던·읽던 권에 따라 바뀐다. */
function introHtml() {
  const nt = DATA.books.reduce((a, b) => a + b.tracks.length, 0);
  const ns = DATA.books.reduce((a, b) => a + b.tracks.reduce((x, t) => x + t.music.length, 0), 0);
  const dur = DATA.books.reduce((a, b) => a + b.tracks.reduce((x, t) => x + trackDur(t), 0), 0);
  return `<div class="ihero">
    <div class="itx">
      <div class="ftag">행동주의자 배준익님의 글과 음악</div>
      <h1>행동힙합</h1>
      <p class="ilead">한 사람이 살아남아온 시간에는<br>그 시간을 함께한 음악이 있다.</p>
      <p>행동주의자 배준익님이 20대부터 지금까지<br>사업하고, 사랑하고, 잃고, 견디고, 다시 일어서며 들어온 음악들.</p>
      <p>가족과 사랑, 이별과 그리움,<br>사업과 실패, 고통과 생존.<br>그때 들었던 음악과 그 안에 남은 생각과 감정을 글로 기록했다.</p>
      <p>『행동힙합』은 그 글과 음악을 여섯 권으로 엮은 기록이다.<br>음악을 들으며 한 사람이 지나온 시간을 함께 읽을 수 있다.</p>
      <div class="imeta">${DATA.books.length}권 · ${nt}편 · ${ns}곡${dur ? ' · ' + fmtLong(dur) : ''}</div>
      <div class="fbtns"><a class="btn" href="#/artist">행동주의자</a><a class="btn ghost" href="#/search">여섯 권 둘러보기</a></div>
    </div></div>`;
}

/* 곡 한 줄은 어디서나 같은 꼴로: 곡명 - 가수 (대장님이 글 제목에 쓰시는 순서) */
const songTxt = m => !m ? '' : (m.title || '곡') + (m.artist ? ' - ' + m.artist : '');
const songHtml = m => !m ? '<i>—</i>' : esc(m.title || '곡') + (m.artist ? ` <i>- ${esc(m.artist)}</i>` : '');

/* ══ 폰 상단 고정 줄 ══ 글 화면엔 그 글의 crumb 이 이미 있으니 그대로 두고,
   홈·검색·라이브러리·앨범처럼 crumb 이 없는 화면에서는 이 줄이 대신 자리를 지킨다. */
function mtop() {
  const el = $('#mtop'); if (!el) return;
  if ($('.tp .crumb')) { el.hidden = true; return; }               // 글·영상 화면은 자체 줄이 있다
  const h = location.hash || '#/';
  const name = h.startsWith('#/search') ? '검색' : h.startsWith('#/lib') ? '내 라이브러리' : h === '#/' || h === '#' ? '행동힙합' : '';
  const t = LASTREAD && trk(LASTREAD.v, LASTREAD.k);
  const back = t ? `<a href="#/b/${book(t.v).vol}/${pad2(t.k + 1)}">읽던 글 · ${pad2(t.k + 1)} ${esc(t.title)} ›</a>` : '';
  if (!name && !back) { el.hidden = true; return; }
  $('#mtop-t').innerHTML = name ? `<b>${esc(name)}</b>${back ? `<span class="sep"></span>${back}` : ''}` : back;
  $('#mtop-list').hidden = true;
  el.hidden = false;
}
let LASTREAD = load('lastread', null);                             // 마지막으로 연 글 — 다른 화면에 갔다가 돌아오게

/* ══ 끊김 기록 ══ 무엇이 왜 끊겼는지 폰에서 바로 볼 수 있게 남긴다 (#/log) */
const LOG = load('log', []);
function logit(what, extra) {
  LOG.push({ t: new Date().toTimeString().slice(0, 8), what, ...extra });
  while (LOG.length > 60) LOG.shift();
  try { store('log', LOG); } catch (e) {}
}
function viewLog() {
  const rows = LOG.slice().reverse().map(x => `<div class="lgrow"><b>${x.t}</b> ${esc(x.what)}${x.vid ? ' · ' + x.vid : ''}${x.code != null ? ' · 오류 ' + x.code : ''}${x.net != null ? ' · net ' + x.net : ''}${x.at != null ? ' · ' + Math.round(x.at) + '초' : ''}${x.try ? ' · ' + x.try + '번째' : ''}</div>`).join('');
  $('#view').innerHTML = `<div class="pad"><div class="h1">끊김 기록</div>
    <p class="vintro">판 ${window.APPV} · 재생기 ${USE} · 기록 ${LOG.length}개. 위가 최근입니다.</p>
    <div class="fbtns"><button class="btn" id="lgclr">기록 지우기</button></div>
    <div class="lgbox">${rows || '<div class="empty">아직 기록이 없습니다.</div>'}</div></div>`;
  $('#lgclr').onclick = () => { LOG.length = 0; store('log', LOG); viewLog(); };
}

/* ══ 행동영상 ══ 대장님 글로 만든 낭독 영상. 글과는 따로 두고, 글에서는 한 줄 링크로만 넘어간다. */
function vidList() {
  const out = [];
  for (const key of Object.keys((DATA && DATA.vid) || {})) {
    const [vol, no] = key.split('-'); const b = DATA.books.find(x => x.vol === vol); if (!b) continue;
    const t = b.tracks[+no - 1]; if (!t) continue;
    out.push({ key, vol, no, b, t });
  }
  return out.sort((a, b_) => a.vol.localeCompare(b_.vol) || +a.no - +b_.no);
}
function bookVideosHtml(vol) {                                    // 앨범 맨 아래에 붙이는 그 권의 낭독 영상 (책 표지 카드와 다른 가로형)
  const L = vidList().filter(x => x.vol === vol); if (!L.length) return '';
  return `<div class="vsec"><div class="h2"><span>이 권의 낭독 영상</span><small><a href="#/v">전체 보기 ›</a></small></div>
    <div class="vcards">${L.map(x => `<a class="vcard" href="#/v/${x.key}">
      <span class="vth">${x.t.thumb ? `<img src="${x.t.thumb}" alt="" loading="lazy">` : ''}<i>▷</i></span>
      <b>${esc(x.t.title)}</b><small>${x.no}</small></a>`).join('')}</div></div>`;
}

function viewVideos() {
  const L = vidList();
  $('#view').innerHTML = `<div class="pad">
    <div class="vhead"><img src="cover-video.jpg" alt=""><div><div class="kind">영상</div><div class="h1" style="margin:4px 0 8px">행동영상</div>
      <p class="vintro">대장님 글을 낭독으로 옮긴 영상 ${L.length}편.</p></div></div>
    <div class="vcards">${L.map(x => `<a class="vcard" href="#/v/${x.key}">
      <span class="vth">${x.t.thumb ? `<img src="${x.t.thumb}" alt="" loading="lazy">` : ''}<i>▷</i></span>
      <b>${esc(x.t.title)}</b><small>${esc(x.b.name)} · ${x.no}</small></a>`).join('')}</div></div>`;
}
function viewVideo(key) {
  const x = vidList().find(y => y.key === key); if (!x) return viewVideos();
  const v = x.b.v, k = +x.no - 1, t = x.t, u = vidUrl(x.vol, k);
  const c = cur(); const ch = x.b.chapters.find(y => k >= y.from - 1 && k < y.from - 1 + y.n);
  PAGE = { v, k }; select(v, k);                                  // 글 화면과 같은 취급 — 곡을 틀면 여기서 상태가 갱신된다
  $('#view').innerHTML = `<div class="tp vpage">
    <div class="crumb"><span class="ctx"><a href="#/v">행동영상</a> · <a href="#/b/${x.vol}">${esc(x.b.name)}</a>${ch ? ` · <a href="#/c/${x.vol}/${ch.ci + 1}">${esc(ch.label)} ${esc(ch.title)}</a>` : ''}</span></div>
    <h1><i>${x.no}</i>${esc(t.title)}</h1>
    <div class="vidbox"><video id="tv" controls playsinline preload="metadata" poster="${t.thumb && !t.thumb.startsWith('http') ? t.thumb : ''}" src="${u}"></video></div>
    <div class="vacts"><span class="vdate">${t.date || ''}</span><a class="vmore" href="#/b/${x.vol}/${x.no}">글만 따로 보기 ›</a></div>
    ${t.music.length ? `<div class="songs">${t.music.map((m, si) => `<div class="songrow${m.dead ? ' dead' : ''}${c && c.v === v && c.t === k && c.s === si ? ' on' : ''}" data-s="${si}"><img src="https://i.ytimg.com/vi/${m.vid}/mqdefault.jpg" alt=""><div class="st"><b>${songHtml(m)}</b><small>${m.dead ? '유튜브에서 내려간 영상 · 교체 예정' : (m.dur ? fmt(m.dur) : '')}</small></div>${m.lyr ? `<button class="lyb" data-vid="${m.vid}" title="가사">가사</button>` : ''}<span class="pb">▶</span></div><div class="lyrics" id="ly-${m.vid}" hidden></div>`).join('')}</div>` : ''}
    <div class="vbodyh">이 영상의 글</div>
    <div class="body">${t.html}</div>
  </div>`;
  const R = $('#view');
  const tv = $('#tv'); if (tv) tv.onplay = () => { if (playing()) togglePlay(); };   // 영상 틀면 음악은 멈춤
  R.querySelectorAll('.songrow').forEach(el => el.onclick = e => {
    if (e.target.closest('.lyb')) { toggleLyrics(e.target.dataset.vid); return; }
    const q = cur(); const si = +el.dataset.s;
    if (q && q.v === v && q.t === k && q.s === si) togglePlay(); else playTrack(v, k, null, si);
  });
  renderLib();
}

/* ══ 오늘의 글 ══ */
function todayTrack() {
  const all = DATA.books.flatMap(b => b.tracks);
  const d = new Date(); const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = key; h = (h ^ 0x5f3a) * 2654435761 % 2147483647;        // 날짜 → 고정된 번호 (같은 날엔 같은 글)
  return all[Math.abs(h) % all.length];
}
function todayHtml() {
  const t = todayTrack(); if (!t) return '';
  const b = book(t.v); const m = t.music[0];
  const d = new Date(); const day = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  const txt = (t.plain || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  return `<div class="h2"><span>오늘의 글</span><small>${day}</small></div>
    <div class="today" data-go="#/b/${b.vol}/${pad2(t.k + 1)}">
      <img src="${t.thumb}" alt="">
      <div class="tdx"><b>${esc(t.title)}</b><p>${esc(txt)}…</p>
        <small>${esc(b.name)} · ${pad2(t.k + 1)}${m ? ' · ♪ ' + songTxt(m) : ''}</small></div>
      <button class="go" data-play="${t.v},${t.k}">▶</button></div>`;
}

const cardAlbum = b => `<div class="card" data-go="#/b/${b.vol}" data-ctx="album|${b.v}"><img class="cv tall" src="${b.cover}" alt=""><div class="ct">${esc(b.name)}</div><div class="cs">${b.year} · 앨범 · ${b.tracks.length}곡</div><button class="go" data-playctx="album|${b.v}">▶</button></div>`;
const cardChapter = (b, c) => `<div class="card" data-go="#/c/${b.vol}/${c.ci + 1}" data-ctx="chapter|${b.v}|${c.ci}"><img class="cv" src="${b.tracks[c.from - 1].thumb}" alt=""><div class="ct">${esc(c.title)}</div><div class="cs">${b.vol}권 ${esc(c.label)} · ${c.n}곡</div><button class="go" data-playctx="chapter|${b.v}|${c.ci}">▶</button></div>`;
const cardTrack = t => `<div class="card" data-go="#/b/${book(t.v).vol}/${pad2(t.k + 1)}"><img class="cv" src="${t.thumb}" alt=""><div class="ct">${esc(t.title)}</div><div class="cs">${book(t.v).vol}권 ${pad2(t.k + 1)} · ${esc(songTxt(t.music[0]))}</div><button class="go" data-play="${t.v},${t.k}">▶</button></div>`;
function bindCards() {
  $$('[data-go]').forEach(el => el.onclick = e => { if (e.target.closest('.go')) return; go(el.dataset.go); });
  $$('[data-play]').forEach(el => el.onclick = e => { e.stopPropagation(); const [v, k] = el.dataset.play.split(',').map(Number); playTrack(v, k); });
  $$('[data-playctx]').forEach(el => el.onclick = e => { e.stopPropagation(); const [type, v, c] = el.dataset.playctx.split('|'); playCtx({ type, v: +v, c: c === undefined ? undefined : +c }); });
  $$('[data-ctx]').forEach(el => el.oncontextmenu = e => { e.preventDefault(); const [type, v, c] = el.dataset.ctx.split('|'); ctxMenu(e, ctxItems({ type, v: +v, c: c === undefined ? undefined : +c })); });
}
function topTracks(n) {
  return Object.entries(S.plays).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => { const [v, t] = k.split('-').map(Number); return trk(v, t); }).filter(Boolean);
}

/* ══ 목록 페이지 공통 ══ */
function trackRows(tracks, ctx, opts = {}) {
  const c = cur(); let rows = '';
  const chapterOf = t => book(t.v).chapters.find(ch => t.k >= ch.from - 1 && t.k < ch.from - 1 + ch.n);
  tracks.forEach((t, i) => {
    const m = t.music[0]; const on = c && c.v === t.v && c.t === t.k; const dead = t.music.length && t.music.every(x => x.dead);
    const b = book(t.v); const ch = chapterOf(t);
    if (opts.chapters && (i === 0 || chapterOf(tracks[i - 1]) !== ch)) rows += `<div class="chap">${esc(ch.label)}<b>${esc(ch.title)}</b><a href="#/c/${b.vol}/${ch.ci + 1}">플레이리스트로 보기 ›</a></div>`;
    rows += `<div class="tl${on ? ' on' : ''}${SEL && SEL.v === t.v && SEL.k === t.k ? ' sel' : ''}${dead ? ' dead' : ''}${on && !playing() ? ' paused' : ''}" data-v="${t.v}" data-k="${t.k}">
      <div class="n"><span>${opts.numberByIndex ? i + 1 : t.k + 1}</span><i>▶</i><span class="eq"><b></b><b></b><b></b></span></div>
      <div class="ti"><img src="${t.thumb}" alt="" loading="lazy"><span style="min-width:0"><b>${esc(t.title)}</b><small>${opts.showBook ? `<a href="#/b/${b.vol}">${esc(b.name)}</a> · ` : ''}<span class="ch">${esc(ch.title)}</span><span class="sg">${songHtml(m)}</span></small>${vidUrl(b.vol, t.k) ? '<span class="vflag" title="낭독 영상">▷</span>' : ''}</span></div>
      <div class="song">${(t.music.length > 1 ? `<i>${t.music.length}곡 · </i>` : '') + songHtml(m)}</div>
      <button class="like${liked(t.v, t.k) ? ' on' : ''}" title="좋아요">${liked(t.v, t.k) ? '♥' : '♡'}</button>
      <div class="dur">${trackDur(t) ? fmt(trackDur(t)) : ''}</div>
      <button class="more" title="더보기">⋯</button></div>`;
  });
  return rows;
}
function scrollToCur() {
  if (!SCROLL_CUR) return; SCROLL_CUR = false;
  requestAnimationFrame(() => { const el = $('#main .tl.sel, #main .tl.on, #main .gc.on'); if (el) el.scrollIntoView({ block: 'center' }); });
}
function bindRows(ctx) {
  scrollToCur();
  $$('.tl').forEach(el => {
    const v = +el.dataset.v, k = +el.dataset.k;
    el.onclick = e => {
      if (e.target.closest('.like')) { toggleLike(v, k); return; }
      if (e.target.closest('.more')) { ctxMenu(e, ctxItems({ type: 'track', v, k })); return; }
      if (e.target.closest('.n')) { playTrack(v, k, ctx); return; }
      if (e.target.closest('a')) return;
      playTrack(v, k, ctx); go(`#/b/${book(v).vol}/${pad2(k + 1)}`);   // 누르면 바로 재생되고 글도 열린다
    };
    el.ondblclick = e => { if (!e.target.closest('.like,.more,a')) playTrack(v, k, ctx); };
    el.oncontextmenu = e => { e.preventDefault(); ctxMenu(e, ctxItems({ type: 'track', v, k })); };
  });
}
function stickyOn(title, ctx) {
  const st = $('.sticky'); if (!st) return;
  st.querySelector('.playbig').onclick = () => togglePlayCtx(ctx);
  $('#main').onscroll = () => st.classList.toggle('show', $('#main').scrollTop > 300);
}
function toolsHtml(ctx, extra = '') {
  const on = sameCtx(ctx) && playing();
  return `<div class="tools"><button class="playbig" id="playall">${on ? '❚❚' : '▶'}</button>${extra}<span class="desc"></span></div>`;
}
const sameCtx = ctx => Q.ctx && Q.ctx.type === ctx.type && Q.ctx.v === ctx.v && Q.ctx.c === ctx.c && Q.ctx.id === ctx.id;

/* ══ 앨범(권) ══ */
function viewBook(v, k) {
  const b = book(v); if (!b) return viewHome();
  if (!isMobile()) return openList({ type: 'album', v });
  const ctx = { type: 'album', v };
  const nsong = b.tracks.reduce((a, t) => a + t.music.length, 0), total = b.tracks.reduce((a, t) => a + trackDur(t), 0);
  $('#view').innerHTML = `<div class="sticky" style="--c:${b.color}"><button class="playbig">▶</button><b>${esc(b.name)}</b></div>
    <div class="hero" style="--c:${b.color}"><img class="tall" src="${b.cover}" alt=""><div style="min-width:0">
      <div class="kind">앨범</div><h1>${esc(b.name)}</h1>
      <div class="meta"><a href="#/artist"><img src="${DATA.books[0].cover}" alt=""><b>배준익</b></a> <span>· ${b.year} · ${b.tracks.length}곡, ${nsong}개 음원${total ? ' · 약 ' + fmtLong(total) : ''}</span></div></div></div>
    <div class="under" style="--c:${b.color}">${toolsHtml(ctx, `<button class="ic" id="shufctx" title="셔플 재생">⇄</button><button class="ic" id="morectx" title="더보기">⋯</button>`)}
      <div class="tl-h"><div style="text-align:right">#</div><div>제목</div><div>곡</div><div></div><div style="text-align:right">⏱</div><div></div></div>
      ${trackRows(b.tracks, ctx, { chapters: true })}
      <div class="foot-info">${b.year} · 행동힙합 ${b.vol}권${b.sub ? ' ' + esc(b.sub) : ''} · 글 배준익 · 엮음 오키<br>ⓒ 배준익. 곡은 유튜브에서 재생됩니다.</div>
      ${bookVideosHtml(b.vol)}
      <div class="h2"><span>배준익의 다른 앨범</span></div><div class="row">${DATA.books.filter(x => x.v !== v).map(cardAlbum).join('')}</div></div>`;
  $('#playall').onclick = () => togglePlayCtx(ctx);
  $('#shufctx').onclick = () => { S.shuffle = true; save(); syncBar(); playCtx(ctx); };
  $('#morectx').onclick = e => ctxMenu(e, ctxItems(ctx));
  bindRows(ctx); bindCards(); stickyOn(b.name, ctx); touch(key(v, 'a')); renderLib();
  if (k != null) { const el = $(`.tl[data-v="${v}"][data-k="${k}"]`); if (el) setTimeout(() => el.scrollIntoView({ block: 'center' }), 50); }
}

/* ══ 장 = 플레이리스트 ══ */
function viewChapter(v, ci) {
  const b = book(v); const c = b && b.chapters[ci]; if (!c) return viewHome();
  if (!isMobile()) return openList({ type: 'chapter', v, c: ci });
  const ctx = { type: 'chapter', v, c: ci }; const tracks = b.tracks.slice(c.from - 1, c.from - 1 + c.n);
  const total = tracks.reduce((a, t) => a + trackDur(t), 0);
  $('#view').innerHTML = `<div class="sticky" style="--c:${b.color}"><button class="playbig">▶</button><b>${esc(c.title)}</b></div>
    <div class="hero" style="--c:${b.color}"><img src="${tracks[0].thumb}" alt=""><div style="min-width:0">
      <div class="kind">플레이리스트</div><h1>${esc(c.title)}</h1>
      <div class="meta"><b>${esc(b.name)}</b> <span>· ${esc(c.label)} · ${tracks.length}곡${total ? ' · ' + fmtLong(total) : ''}</span></div></div></div>
    <div class="under" style="--c:${b.color}">${toolsHtml(ctx, `<button class="ic" id="morectx">⋯</button>`)}
      <div class="tl-h"><div style="text-align:right">#</div><div>제목</div><div>곡</div><div></div><div style="text-align:right">⏱</div><div></div></div>
      ${trackRows(tracks, ctx, { numberByIndex: true })}</div>`;
  $('#playall').onclick = () => togglePlayCtx(ctx); $('#morectx').onclick = e => ctxMenu(e, ctxItems(ctx));
  bindRows(ctx); stickyOn(c.title, ctx); touch(key(v, 'c' + ci)); renderLib();
}

/* ══ 내 플레이리스트 · 좋아요 ══ */
function viewPlaylist(id) {
  const p = pl(id); if (!p) return viewHome();
  if (!isMobile()) return openList({ type: 'pl', id });
  const ctx = { type: 'pl', id }; const tracks = p.items.map(([v, k]) => trk(v, k)).filter(Boolean);
  $('#view').innerHTML = `<div class="sticky" style="--c:#333"><button class="playbig">▶</button><b>${esc(p.name)}</b></div>
    <div class="hero" style="--c:#3a3a3a">${tracks[0] ? `<img src="${tracks[0].thumb}" alt="">` : '<div class="ico pl">♫</div>'}<div style="min-width:0">
      <div class="kind">플레이리스트</div><h1 id="plname" title="이름 바꾸려면 클릭">${esc(p.name)}</h1>
      <div class="meta"><b>오키</b> <span>· ${tracks.length}곡</span></div></div></div>
    <div class="under" style="--c:#3a3a3a">${toolsHtml(ctx, `<button class="ic" id="morectx">⋯</button>`)}
      ${tracks.length ? `<div class="tl-h"><div style="text-align:right">#</div><div>제목</div><div>곡</div><div></div><div style="text-align:right">⏱</div><div></div></div>${trackRows(tracks, ctx, { numberByIndex: true, showBook: true })}` : '<div class="empty">비어 있습니다. 꼭지의 ⋯ 메뉴에서 "플레이리스트에 추가"를 누르세요.</div>'}</div>`;
  $('#playall').onclick = () => togglePlayCtx(ctx); $('#morectx').onclick = e => ctxMenu(e, ctxItems(ctx));
  $('#plname').onclick = () => { const n = prompt('플레이리스트 이름', p.name); if (n) { p.name = n.trim(); save(); renderLib(); route(); } };
  bindRows(ctx); stickyOn(p.name, ctx); p.t = Date.now(); save(); renderLib();
}
function viewLiked() {
  const ctx = { type: 'liked' };
  if (!isMobile()) return openList(ctx); const tracks = S.liked.map(([v, k]) => trk(v, k)).filter(Boolean);
  $('#view').innerHTML = `<div class="sticky" style="--c:#4b3f8f"><button class="playbig">▶</button><b>좋아요 표시한 꼭지</b></div>
    <div class="hero" style="--c:#4b3f8f"><div class="ico">♥</div><div style="min-width:0"><div class="kind">플레이리스트</div><h1>좋아요 표시한 꼭지</h1><div class="meta"><b>오키</b> <span>· ${tracks.length}곡</span></div></div></div>
    <div class="under" style="--c:#4b3f8f">${toolsHtml(ctx)}${tracks.length ? `<div class="tl-h"><div style="text-align:right">#</div><div>제목</div><div>곡</div><div></div><div style="text-align:right">⏱</div><div></div></div>${trackRows(tracks, ctx, { numberByIndex: true, showBook: true })}` : '<div class="empty">아직 없습니다. 꼭지 옆 ♡를 누르면 여기 모입니다.</div>'}</div>`;
  $('#playall').onclick = () => togglePlayCtx(ctx); bindRows(ctx); stickyOn('좋아요', ctx); touch('liked'); renderLib();
}

/* ══ 아티스트 ══ */
function viewArtist() {
  const top = topTracks(5); const tracks = top.length ? top : DATA.books.flatMap(b => b.tracks.slice(0, 1));
  const ctx = { type: 'album', v: 0 };
  $('#view').innerHTML = `<div class="hero artist" style="--img:url(${DATA.books[0].cover});--c:#222"><div>
      <div class="kind">아티스트</div><h1>배준익</h1><div class="meta"><span>행동주의자 · ${DATA.books.length}개 앨범 · ${DATA.books.reduce((a, b) => a + b.tracks.length, 0)}곡</span></div></div></div>
    <div class="under" style="--c:#222">${toolsHtml(ctx)}
      <div class="h2"><span>많이 들은 곡</span></div>
      ${trackRows(tracks, { type: 'album', v: 0 }, { numberByIndex: true, showBook: true })}
      <div class="h2"><span>디스코그래피</span></div><div class="row">${DATA.books.map(cardAlbum).join('')}</div>
      <div class="h2"><span>플레이리스트</span></div><div class="row">${DATA.books.flatMap(b => b.chapters.map(c => cardChapter(b, c))).join('')}</div>
      <div class="h2"><span>소개</span></div>
      <div class="about"><b>행동주의자 배준익 님</b>
        <p>오랜 시간 사업을 하고, 가족을 이루고, 사람을 만나고 헤어지며 살아오셨다. 그 과정에서 겪은 사랑과 이별, 실패와 생존, 고통과 외로움, 다시 일어서야 했던 순간들을 글로 남겨오셨다.</p>
        <p>그리고 그 삶의 곁에는 늘 음악이 있었다.</p>
        <p>어떤 음악은 힘든 시절을 버티게 했고, 어떤 음악은 지나간 사람을 떠올리게 했으며, 어떤 음악은 사랑과 가족, 사업과 삶을 다시 생각하게 했다.</p>
        <p>그래서 행동주의자님의 글에서 음악은 단순한 추천곡이나 배경음악이 아니다. 한 사람이 살아온 시간과 감정, 생각과 철학이 함께 남아 있는 기록에 가깝다.</p>
        <p>「행동힙합」은 그렇게 오랜 시간 쌓여온 글과 음악을 오키가 모아 여섯 권으로 엮은 것이다.</p>
        <p class="vols">1권 태도 · 2권 기억 · 3권 생존 · 4권 사랑 · 5권 힙합 · 6권 명반</p>
        <p>한 사람이 무엇을 사랑했고, 무엇을 견뎠으며, 어떤 생각으로 살아왔는지.<br>그 흔적을 글로 읽고, 음악으로 들을 수 있다.</p>
      </div></div>`;
  $('#playall').onclick = () => { const q = tracks.map(t => t.music.map((m, s) => ({ v: t.v, t: t.k, s })).filter((x) => !t.music[x.s].dead)).flat(); startQueue(q, 0, { type: 'artist', name: '배준익' }); };
  bindRows({ type: 'album', v: 0 }); bindCards();
}

/* ══ 검색 ══ */
function viewSearch(q, tab) {
  const s = q.trim().toLowerCase();
  const mbox = `<div class="msbox"><span>⌕</span><input id="mq" value="${esc(q)}" placeholder="글·곡·가수 찾기" autocomplete="off" enterkeyhint="search">${q ? '<button id="mqx" title="지우기">✕</button>' : ''}</div>`;
  if (!s) {
    $('#view').innerHTML = `<div class="pad">${mbox}<div class="h1">모두 둘러보기</div><div class="genres">
      ${DATA.books.map(b => `<div class="genre" style="--c:${b.color}" data-go="#/b/${b.vol}">${b.vol}권 ${esc(b.sub) || '행동힙합'}<small>${b.tracks.length}곡</small><img src="${b.cover}" alt=""></div>`).join('')}
      ${DATA.books.flatMap(b => b.chapters.map(c => `<div class="genre" style="--c:${shade(b.color, c.ci)}" data-go="#/c/${b.vol}/${c.ci + 1}">${esc(c.title)}<small>${b.vol}권 ${esc(c.label)} · ${c.n}곡</small><img src="${b.tracks[c.from - 1].thumb}" alt=""></div>`)).join('')}
      <div class="genre" style="--c:#4b3f8f" data-go="#/liked">좋아요<small>${S.liked.length}곡</small></div></div></div>`;
    bindSearchBox(q); bindCards(); return;
  }
  const hl = t => esc(t).replace(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), m => `<mark>${m}</mark>`);
  const tracks = [], songs = [];
  DATA.books.forEach(b => b.tracks.forEach(t => {
    const sm = t.music.filter(m => (m.title + ' ' + m.artist).toLowerCase().includes(s)); sm.forEach(m => songs.push({ t, m }));
    if (t.title.toLowerCase().includes(s)) tracks.push({ t, w: 0 }); else if (sm.length) tracks.push({ t, w: 1 }); else if (t.plain.toLowerCase().includes(s)) tracks.push({ t, w: 2 });
  }));
  tracks.sort((a, b) => a.w - b.w);
  const albums = DATA.books.filter(b => b.name.toLowerCase().includes(s));
  const chs = DATA.books.flatMap(b => b.chapters.filter(c => c.title.toLowerCase().includes(s)).map(c => ({ b, c })));
  const tabs = [['all', '전체'], ['tracks', `꼭지 ${tracks.length}`], ['songs', `곡 ${songs.length}`], ['albums', `앨범·플레이리스트 ${albums.length + chs.length}`]];
  const top = tracks[0];
  let body = `<div class="stabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-go="#/search/${encodeURIComponent(q)}/${k}">${l}</button>`).join('')}</div>`;
  if (tab === 'all') {
    if (top) body += `<div class="h2"><span>상위 결과</span></div><div class="tiles" style="grid-template-columns:minmax(0,420px)"><div class="tile" style="height:90px" data-go="#/b/${book(top.t.v).vol}/${pad2(top.t.k + 1)}"><img style="width:90px;height:90px" src="${top.t.thumb}" alt=""><span><b style="font-size:17px">${hl(top.t.title)}</b><br><small style="color:#b3b3b3">꼭지 · ${book(top.t.v).vol}권</small></span><button class="go" data-play="${top.t.v},${top.t.k}">▶</button></div></div>`;
    if (tracks.length) body += `<div class="h2"><span>꼭지</span></div>${tracks.slice(0, 6).map(({ t }) => hitTrack(t, hl)).join('')}`;
    if (songs.length) body += `<div class="h2"><span>곡</span></div>${songs.slice(0, 6).map(({ t, m }) => hitSong(t, m, hl)).join('')}`;
    if (albums.length || chs.length) body += `<div class="h2"><span>앨범 · 플레이리스트</span></div><div class="row">${albums.map(cardAlbum).join('')}${chs.map(({ b, c }) => cardChapter(b, c)).join('')}</div>`;
    if (!tracks.length && !songs.length && !albums.length && !chs.length) body += `<div class="empty">"${esc(q)}" 에 맞는 것이 없습니다</div>`;
  } else if (tab === 'tracks') body += tracks.map(({ t }) => hitTrack(t, hl)).join('') || '<div class="empty">없음</div>';
  else if (tab === 'songs') body += songs.map(({ t, m }) => hitSong(t, m, hl)).join('') || '<div class="empty">없음</div>';
  else body += `<div class="row">${albums.map(cardAlbum).join('')}${chs.map(({ b, c }) => cardChapter(b, c)).join('')}</div>` || '<div class="empty">없음</div>';
  $('#view').innerHTML = `<div class="pad">${mbox}${body}</div>`; bindSearchBox(q); bindCards();
  $$('.hit').forEach(el => { const v = +el.dataset.v, k = +el.dataset.k; el.onclick = e => { if (e.target.closest('.go')) return; go(`#/b/${book(v).vol}/${pad2(k + 1)}`); }; el.oncontextmenu = e => { e.preventDefault(); ctxMenu(e, ctxItems({ type: 'track', v, k })); }; });
}
let PREV_HASH = null, SCROLLPOS = {};
let SCROLL_CUR = false;                                           // 목록을 열 때 듣던 곡 자리로 내려준다
let MQ_FOCUS = false;                                             // 글자를 칠 때마다 화면을 다시 그리므로 커서를 되돌려 준다
function bindSearchBox(q) {
  const el = $('#mq'); if (!el) return;
  el.oninput = () => { MQ_FOCUS = true; clearTimeout(el._t); el._t = setTimeout(() => go('#/search/' + encodeURIComponent(el.value)), 280); };
  el.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(el._t); MQ_FOCUS = true; go('#/search/' + encodeURIComponent(el.value)); el.blur(); } };
  const x = $('#mqx'); if (x) x.onclick = () => { MQ_FOCUS = true; go('#/search'); };
  if (MQ_FOCUS) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

const hitTrack = (t, hl) => `<div class="hit" data-v="${t.v}" data-k="${t.k}"><img src="${t.thumb}" alt=""><span style="min-width:0"><b>${hl(t.title)}</b><small>꼭지 · ${book(t.v).vol}권 ${pad2(t.k + 1)}${t.music[0] ? ' · ♪ ' + hl(songTxt(t.music[0])) : ''}</small></span><button class="go tile-go" data-play="${t.v},${t.k}" style="margin-left:auto;background:none;color:#fff;font-size:16px">▶</button></div>`;
const hitSong = (t, m, hl) => `<div class="hit" data-v="${t.v}" data-k="${t.k}"><img src="https://i.ytimg.com/vi/${m.vid}/mqdefault.jpg" alt=""><span style="min-width:0"><b>${hl(songTxt(m))}</b><small>꼭지 · ${esc(t.title)}</small></span></div>`;
function shade(hex, i) { const n = parseInt(hex.slice(1), 16); const f = 0.75 + (i % 4) * 0.12; const c = x => Math.min(255, Math.round(x * f)); return `rgb(${c(n >> 16)},${c(n >> 8 & 255)},${c(n & 255)})`; }

/* ══ 폰 라이브러리 ══ */
function viewLibMobile() {
  const all = libItems();
  const albums = all.filter(i => i.type === 'album');
  const mine = all.filter(i => i.type === 'liked' || (i.type === 'pl' && i.id));
  const vids = all.filter(i => i.type === 'video');
  const chaps = all.filter(i => i.type === 'pl' && i.ci != null);
  const tile = i => `<div class="tile" data-go="${i.href}">${i.img ? `<img src="${i.img}" alt="">` : `<span class="ico">${i.ico}</span>`}<span>${esc(i.name)}<br><small style="color:#b3b3b3;font-weight:400">${esc(i.sub)}</small></span></div>`;
  const sec = (t, list, sub) => !list.length ? '' : `<div class="h2"><span>${esc(t)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div><div class="tiles">${list.map(tile).join('')}</div>`;
  let html = `<div class="h1">내 라이브러리</div>`;
  html += sec('앨범', albums, `${albums.length}권`);
  html += sec('내가 담은 것', mine);
  for (const b of DATA.books) {                                   // 장은 권별로 묶는다 — 한 줄로 쭉 늘어놓으면 구분이 안 된다
    const g = chaps.filter(i => i.v === b.v);
    html += sec(esc(b.name), g, `장 ${g.length}개`);
  }
  html += sec('행동영상', vids);
  html += `<div class="libfoot">판 ${window.APPV} · 재생기 ${USE}
    <a href="#/log">끊김 기록</a><button id="libup">새로 받기</button></div>`;
  $('#view').innerHTML = `<div class="pad">${html}</div>`;
  $('#libup').onclick = () => { try { localStorage.removeItem('q'); } catch (e) {} location.replace(location.pathname + '?v=' + Date.now() + '#/'); };
  bindCards();
}

/* ══ 꼭지 페이지 (가운데 = 글) ══ */
let PAGE = null;                                                  // 지금 가운데에 열린 꼭지 {v,k}
function select(v, k) { SEL = { v, k }; S.recent = [[v, k], ...S.recent.filter(x => !(x[0] === v && x[1] === k))].slice(0, 16); save(); }
function viewTrack(v, k) {
  const b = book(v); const t = b.tracks[k]; if (!t) return viewHome();
  select(v, k); PAGE = { v, k }; LASTREAD = { v, k }; store('lastread', LASTREAD);
  if (!LIST || !ctxTracks(LIST).tracks.some(x => x.v === v && x.k === k)) LIST = { type: 'album', v };
  renderList();
  const c = cur(); const prev = b.tracks[k - 1], next = b.tracks[k + 1];
  const ch = b.chapters.find(x => k >= x.from - 1 && k < x.from - 1 + x.n);
  $('#view').innerHTML = `<div class="tp">
    <div class="crumb"><span class="ctx"><a href="#/b/${b.vol}">${esc(b.name)}</a> · <a href="#/c/${b.vol}/${ch.ci + 1}">${esc(ch.label)} ${esc(ch.title)}</a></span><button class="clist" title="목록">≡</button></div>
    <h1><i>${pad2(k + 1)}</i>${esc(t.title)}</h1>
    <div class="acts"><button class="playbig" data-act="play">${c && c.v === v && c.t === k && playing() ? '❚❚' : '▶'}</button><button class="ic${S.shuffle ? ' on' : ''}" data-act="shuffle" title="섞어 듣기">⇄</button><button class="ic like${liked(v, k) ? ' on' : ''}" data-act="like">${liked(v, k) ? '♥' : '♡'}</button><button class="ic" data-act="fs" title="전체화면">⛶</button><button class="ic" data-act="more" title="더보기">⋯</button><span style="margin-left:auto;font-size:12px;color:var(--dim)">${t.date || ''}</span></div>
    ${vidUrl(b.vol, k) ? `<a class="vlink" href="#/v/${b.vol}-${pad2(k + 1)}">▷ 이 글의 낭독 영상 보기</a>` : ''}
    ${t.thumb && !t.thumb.startsWith('http') ? `<img class="hero" src="${t.thumb}" alt="">` : ''}
    ${t.music.length ? `<div class="songs">${t.music.map((m, s) => `<div class="songrow${m.dead ? ' dead' : ''}${c && c.v === v && c.t === k && c.s === s ? ' on' : ''}" data-s="${s}"><img src="https://i.ytimg.com/vi/${m.vid}/mqdefault.jpg" alt=""><div class="st"><b>${songHtml(m)}</b><small>${m.dead ? '유튜브에서 내려간 영상 · 교체 예정' : (m.dur ? fmt(m.dur) : '')}</small></div>${m.lyr ? `<button class="lyb" data-vid="${m.vid}" title="가사">가사</button>` : ''}<span class="pb">${c && c.v === v && c.t === k && c.s === s && playing() ? '❚❚' : '▶'}</span></div><div class="lyrics" id="ly-${m.vid}" hidden></div>`).join('')}</div>` : ''}
    <div class="body">${t.html}</div>
    <div class="pn">${prev ? `<a href="#/b/${b.vol}/${pad2(k)}">← ${pad2(k)} ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="#/b/${b.vol}/${pad2(k + 2)}">${pad2(k + 2)} ${esc(next.title)} →</a>` : '<span></span>'}</div>
  </div>`;
  const R = $('#view');
  R.querySelectorAll('.songrow').forEach(el => el.onclick = e => {
    if (e.target.closest('.lyb')) { toggleLyrics(e.target.dataset.vid); return; }
    const q = cur(); const s_ = +el.dataset.s;
    if (q && q.v === v && q.t === k && q.s === s_) togglePlay(); else playTrack(v, k, null, s_);   // 듣던 곡을 다시 누르면 멈춤
  });
  R.querySelectorAll('.crumb a').forEach(a => a.onclick = () => { SCROLL_CUR = true; });   // 목록으로 갈 땐 이 글 자리로
  R.querySelector('.crumb .clist').onclick = () => { SCROLL_CUR = true; go(`#/b/${b.vol}`); };
  R.querySelector('[data-act=play]').onclick = () => { const q = cur(); if (q && q.v === v && q.t === k) togglePlay(); else playTrack(v, k); };
  R.querySelector('[data-act=shuffle]').onclick = e => { $('#shuf').click(); e.currentTarget.classList.toggle('on', S.shuffle); toast(S.shuffle ? '섞어 듣기' : '순서대로 듣기'); };
  R.querySelector('[data-act=like]').onclick = () => toggleLike(v, k);
  R.querySelector('[data-act=fs]').onclick = () => fullscreen(t);
  R.querySelector('[data-act=more]').onclick = e => ctxMenu(e, ctxItems({ type: 'track', v, k }));
  renderLib();
}
function renderBody() {                                            // 꼭지 페이지가 열려 있으면 재생 상태만 갱신
  if (!PAGE || !$('.tp')) return;
  const q = cur(); const p = playing(); const on = q && q.v === PAGE.v && q.t === PAGE.k;
  const pb = $('.tp [data-act=play]'); if (pb) pb.textContent = on && p ? '❚❚' : '▶';
  $$('.tp .songrow').forEach(el => {
    const cur_ = !!on && +el.dataset.s === q.s; el.classList.toggle('on', cur_);
    const pb2 = el.querySelector('.pb'); if (pb2) pb2.textContent = cur_ && p ? '❚❚' : '▶';       // 띠 안의 버튼도 같이 바뀐다
  });
  const sh = $('.tp [data-act=shuffle]'); if (sh) sh.classList.toggle('on', S.shuffle);
  const lk = $('.tp [data-act=like]'); if (lk) { lk.classList.toggle('on', liked(PAGE.v, PAGE.k)); lk.textContent = liked(PAGE.v, PAGE.k) ? '♥' : '♡'; }
}
function renderQueue() {}
function fullscreen(t) {                                           // 전체화면으로 읽기: 그 꼭지 사진을 어둡게 깔고 흰 글씨
  const b = book(t.v); const bg = t.thumb || b.cover;
  const fs = $('#fs'); fs.hidden = false;
  fs.style.setProperty('--c', b.color);
  $('#fs-bg').style.backgroundImage = bg ? `url("${bg}")` : 'none';
  $('#fs-crumb').textContent = `${b.name} · ${t.chapter}`;         // 위에 늘 붙어 있는 줄
  $('#fs-head').innerHTML = `<h2>${pad2(t.k + 1)} ${esc(t.title)}</h2>`;
  $('#fs-in').innerHTML = `<div class="body">${t.html}</div>`;
  fs.scrollTop = 0;
}
$('#fs-close').onclick = () => { $('#fs').hidden = true; };

/* ══ 오른쪽: 꼭지 목록 ══ */
let LIST = null;                                                  // 오른쪽에 펼친 목록의 맥락 {type, v, c, id}
function ctxTracks(ctx) {
  if (ctx.type === 'album') { const b = book(ctx.v); return { tracks: b.tracks, name: b.name, sub: `앨범 · ${b.year}`, img: b.cover, href: `#/b/${b.vol}`, chapters: b.chapters }; }
  if (ctx.type === 'chapter') { const b = book(ctx.v), c = b.chapters[ctx.c]; return { tracks: b.tracks.slice(c.from - 1, c.from - 1 + c.n), name: c.title, sub: `플레이리스트 · ${b.vol}권 ${c.label}`, img: b.tracks[c.from - 1].thumb, href: `#/c/${b.vol}/${c.ci + 1}` }; }
  if (ctx.type === 'pl') { const p = pl(ctx.id); if (!p) return { tracks: [], name: '' }; return { tracks: p.items.map(([v, k]) => trk(v, k)).filter(Boolean), name: p.name, sub: '플레이리스트', ico: '♫', href: '#/pl/' + p.id }; }
  if (ctx.type === 'liked') return { tracks: S.liked.map(([v, k]) => trk(v, k)).filter(Boolean), name: '좋아요 표시한 꼭지', sub: '플레이리스트', ico: '♥', href: '#/liked' };
  return { tracks: [], name: '' };
}
function openList(ctx) {
  LIST = ctx; const L = ctxTracks(ctx);
  if (ctx.type === 'album') touch(key(ctx.v, 'a')); else if (ctx.type === 'chapter') touch(key(ctx.v, 'c' + ctx.c)); else if (ctx.type === 'liked') touch('liked'); else if (ctx.type === 'pl') { const p = pl(ctx.id); if (p) { p.t = Date.now(); save(); } }
  renderList(); PAGE = null;
  const b = ctx.v != null ? book(ctx.v) : null; const color = b ? b.color : (ctx.type === 'liked' ? '#4b3f8f' : '#3a3a3a');
  const total = L.tracks.reduce((a, t) => a + trackDur(t), 0); const c = cur(); const on = sameCtx(ctx) && playing();
  let cards = '';
  L.tracks.forEach((t, i) => {
    if (L.chapters) { const ch = L.chapters.find(x => t.k === x.from - 1); if (ch) cards += `</div><div class="gchap">${esc(ch.label)}<b>${esc(ch.title)}</b></div><div class="gcards">`; }
    const m = t.music[0]; const dead = t.music.length && t.music.every(x => x.dead);
    cards += `<div class="gc${c && c.v === t.v && c.t === t.k ? ' on' : ''}${dead ? ' dead' : ''}" data-v="${t.v}" data-k="${t.k}"><img class="cv" src="${t.thumb}" alt="" loading="lazy"><span class="n">${L.chapters ? pad2(t.k + 1) : pad2(i + 1)}</span><div class="t">${vidUrl(book(t.v).vol, t.k) ? '<i class="vflag">▷</i> ' : ''}${esc(t.title)}</div><div class="s">${m ? '♪ ' + songHtml(m) : '—'}</div><button class="go">▶</button></div>`;
  });
  $('#view').innerHTML = `<div class="grid-h" style="--c:${color}">${L.img ? `<img class="${ctx.type === 'album' ? 'tall' : ''}" src="${L.img}" alt="">` : `<div class="ico ${ctx.type === 'pl' ? 'pl' : ''}">${L.ico || '♫'}</div>`}<div style="min-width:0">
      <div class="kind">${ctx.type === 'album' ? '앨범' : '플레이리스트'}</div><h1>${esc(L.name)}</h1>
      <div class="meta"><b>배준익</b> · ${L.tracks.length}곡${total ? ' · ' + fmtLong(total) : ''}${b && ctx.type === 'album' ? ' · ' + b.year : ''}</div></div></div>
    <div class="grid-b" style="--c:${color}"><div class="tools"><button class="playbig" id="playall">${on ? '❚❚' : '▶'}</button><button class="ic${S.shuffle ? ' on' : ''}" id="shufctx" title="셔플">⇄</button><button class="ic" id="morectx" title="더보기">⋯</button></div>
      <div class="gcards">${cards}</div>${L.tracks.length ? '' : '<div class="empty">비어 있습니다. 꼭지의 ⋯ 메뉴에서 "플레이리스트에 추가"를 누르세요.</div>'}
      ${ctx.type === 'album' && b ? bookVideosHtml(b.vol) : ''}</div>`;
  $('#playall').onclick = () => togglePlayCtx(ctx);
  $('#shufctx').onclick = () => $('#shuf').click();
  $('#morectx').onclick = e => ctxMenu(e, ctxItems(ctx));
  $$('.gc').forEach(el => {
    const v = +el.dataset.v, k = +el.dataset.k;
    el.onclick = () => { playTrack(v, k, ctx); go(`#/b/${book(v).vol}/${pad2(k + 1)}`); };       // 카드 누르면 재생 + 글 열기
    el.oncontextmenu = e => { e.preventDefault(); ctxMenu(e, ctxItems({ type: 'track', v, k })); };
  });
  renderLib();
}
function renderList() {
  if (!LIST) { $('#rhead').innerHTML = ''; $('#rlist').innerHTML = '<div class="empty" style="padding:24px 16px">앨범을 고르면 꼭지 목록이 여기 뜹니다.</div>'; return; }
  const L = ctxTracks(LIST); const c = cur(); const total = L.tracks.reduce((a, t) => a + trackDur(t), 0);
  const on = sameCtx(LIST) && playing();
  $('#rhead').innerHTML = `<div class="rh">${L.img ? `<img src="${L.img}" alt="">` : `<div class="ico">${L.ico || '♫'}</div>`}<div class="rt"><small>${esc(L.sub || '')}</small><b><a href="${L.href}">${esc(L.name)}</a></b></div></div>
    <div class="rbtns"><button class="playbig" id="rplay">${on ? '❚❚' : '▶'}</button><button class="ic${S.shuffle ? ' on' : ''}" id="rshuf" title="셔플">⇄</button><button class="ic" id="rmore" title="더보기">⋯</button><span>${L.tracks.length}곡${total ? ' · ' + fmtLong(total) : ''}</span></div>`;
  $('#rplay').onclick = () => togglePlayCtx(LIST);
  $('#rshuf').onclick = () => $('#shuf').click();
  $('#rmore').onclick = e => ctxMenu(e, ctxItems(LIST));
  let rows = '';
  L.tracks.forEach((t, i) => {
    const m = t.music[0]; const dead = t.music.length && t.music.every(x => x.dead);
    if (L.chapters) { const ch = L.chapters.find(x => t.k === x.from - 1); if (ch) rows += `<div class="rch">${esc(ch.label)}<b>${esc(ch.title)}</b></div>`; }
    rows += `<div class="rl${c && c.v === t.v && c.t === t.k ? ' on' : ''}${PAGE && PAGE.v === t.v && PAGE.k === t.k ? ' sel' : ''}${dead ? ' dead' : ''}${c && c.v === t.v && c.t === t.k && !playing() ? ' paused' : ''}" data-v="${t.v}" data-k="${t.k}" title="${esc(t.title)}">
      <div class="n"><span>${L.chapters ? t.k + 1 : i + 1}</span><i>▶</i><span class="eq"><b></b><b></b><b></b></span></div>
      <img src="${t.thumb}" alt="" loading="lazy"><div class="t"><b>${vidUrl(book(t.v).vol, t.k) ? '<i class="vflag">▷</i> ' : ''}${esc(t.title)}</b><small>${songHtml(m)}</small></div><div class="d">${trackDur(t) ? fmt(trackDur(t)) : ''}</div></div>`;
  });
  $('#rlist').innerHTML = rows;
  $$('#rlist .rl').forEach(el => {
    const v = +el.dataset.v, k = +el.dataset.k;
    el.onclick = () => { playTrack(v, k, LIST); go(`#/b/${book(v).vol}/${pad2(k + 1)}`); };      // 줄 어디를 눌러도 재생 + 글 열기
    el.oncontextmenu = e => { e.preventDefault(); ctxMenu(e, ctxItems({ type: 'track', v, k })); };
  });
  const sel = $('#rlist .rl.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}

/* ══ 재생기 ══ 드롭박스에 MP3 가 있으면 그걸로 (광고 없음·영상이 내려가도 재생됨), 없으면 유튜브.
   재생기를 둘 두고 다음 곡을 미리 받아둔다 — 드롭박스는 주소를 두 번 넘겨줘서, 그때 가서 받으면 곡 사이가 끊긴다. */
let USE = 'yt';                                                   // 지금 곡을 무엇으로 트는가
let AUD_RETRY = 0;
function mkAudio() {
  const a = new Audio(); a.preload = 'none'; a.crossOrigin = null;
  a.addEventListener('loadedmetadata', () => { if (a !== AUD || USE !== 'mp3') return; const q = cur(); if (!q) return; const m = trk(q.v, q.t).music[q.s]; if (m && !m.dur) m.dur = Math.round(a.duration); });
  a.addEventListener('ended', () => { if (a !== AUD || USE !== 'mp3') return; if (S.repeat === 2) { a.currentTime = 0; a.play().catch(() => {}); } else step(1); });
  for (const ev of ['play', 'pause']) a.addEventListener(ev, () => { if (a === AUD && USE === 'mp3') { syncBar(); markRows(); renderBody(); } });
  a.addEventListener('playing', () => { if (a === AUD) AUD_RETRY = 0; });
  a.addEventListener('error', () => {
    if (a !== AUD || USE !== 'mp3') return;
    const q = cur(); if (!q) return;
    const m = trk(q.v, q.t).music[q.s];
    logit('MP3 끊김', { vid: m.vid, code: a.error && a.error.code, net: a.networkState, at: a.currentTime, try: AUD_RETRY + 1 });
    if (hasMp3(m.vid)) {                                          // MP3 가 있는 곡은 유튜브로 넘기지 않는다 (유튜브가 더 잘 끊긴다)
      AUD_RETRY++; const at = a.currentTime || 0;
      if (AUD_RETRY === 3) toast('연결이 불안정합니다. 다시 잇는 중…');
      setTimeout(() => { a.src = mp3Url(m.vid) + '&r=' + AUD_RETRY; if (at) { a.addEventListener('loadedmetadata', () => { try { a.currentTime = at; } catch (e) {} }, { once: true }); } a.play().catch(() => {}); }, Math.min(400 * AUD_RETRY, 4000));
      return;
    }
    logit('유튜브로 넘어감 (MP3 없음)', { vid: m.vid });
    USE = 'yt'; const vb = document.querySelector('.video'); if (vb) vb.style.display = '';
    if (ytReady) YTP.loadVideoById(m.vid);                        // 그래도 안 되면 유튜브로
  });
  return a;
}
let AUD = mkAudio(), NXT = mkAudio();                             // AUD = 지금 나오는 것, NXT = 다음 곡 미리 받는 것
document.addEventListener('DOMContentLoaded', () => { const vb = document.querySelector('.video'); if (vb) vb.style.display = 'none'; });
const mp3Url = vid => (DATA && DATA.mp3base) ? DATA.mp3base + '&preview=' + vid + '.mp3&dl=1' : null;
const hasMp3 = vid => !!(DATA && DATA.mp3base && DATA.mp3 && DATA.mp3[vid]);
const vidUrl = (vol, k) => { const n = `${vol}-${pad2(k + 1)}`;
  return (DATA && DATA.vidbase && DATA.vid && DATA.vid[n]) ? DATA.vidbase + '&preview=' + n + '.mp4&dl=1' : null; };   // 낭독 영상 (드롭박스 앱_영상)
const pReady = () => USE === 'mp3' ? true : ytReady;
const P = {
  getCurrentTime: () => USE === 'mp3' ? (AUD.currentTime || 0) : (ytReady && YTP.getCurrentTime ? YTP.getCurrentTime() : 0),
  getDuration:    () => USE === 'mp3' ? (isFinite(AUD.duration) ? AUD.duration : 0) : (ytReady && YTP.getDuration ? YTP.getDuration() : 0),
  getPlayerState: () => USE === 'mp3' ? (AUD.paused ? 2 : 1) : (ytReady && YTP.getPlayerState ? YTP.getPlayerState() : -1),
  playVideo:  () => USE === 'mp3' ? AUD.play().catch(() => {}) : YTP.playVideo(),
  pauseVideo: () => USE === 'mp3' ? AUD.pause() : YTP.pauseVideo(),
  seekTo: (t) => { if (USE === 'mp3') AUD.currentTime = t; else YTP.seekTo(t, true); },
  setVolume: (v) => { AUD.volume = v / 100; NXT.volume = v / 100; if (ytReady) YTP.setVolume(v); },
  mute:   () => { AUD.muted = true;  if (ytReady) YTP.mute(); },
  unMute: () => { AUD.muted = false; if (ytReady) YTP.unMute(); },
  loadVideoById: (a) => load_(a, true),
  cueVideoById:  (a) => load_(a, false),
};
function load_(a, go) {
  const vid = typeof a === 'string' ? a : a.videoId, at = (typeof a === 'object' && a.startSeconds) || 0;
  const vb = document.querySelector('.video');
  if (hasMp3(vid)) {
    USE = 'mp3'; AUD_RETRY = 0;
    if (ytReady) YTP.stopVideo();
    if (NXT.dataset.vid === vid && NXT.readyState >= 2) {          // 미리 받아둔 게 있으면 그걸로 바꿔 끼운다 (끊김 없음)
      const old = AUD; old.pause(); old.removeAttribute('src'); old.preload = 'none'; old.load(); delete old.dataset.vid;
      AUD = NXT; NXT = old;
    } else if (AUD.dataset.vid !== vid) {
      AUD.src = mp3Url(vid); AUD.dataset.vid = vid;
    }
    AUD.preload = 'auto';                                          // 지금 트는 쪽은 앞서서 넉넉히 받아둔다
    AUD.volume = S.vol / 100; AUD.muted = !!S.muted;
    if (at) { try { AUD.currentTime = at; } catch (e) {} }
    if (vb) vb.style.display = 'none';                             // MP3 로 트는 동안엔 유튜브 창이 필요 없다
    if (go) AUD.play().catch(() => syncBar());
    if (NXT.dataset.vid && NXT.dataset.vid !== vid) dropNext();     // 엉뚱한 곡을 미리 받고 있었으면 버린다
  } else {
    USE = 'yt'; AUD.pause(); AUD.removeAttribute('src'); delete AUD.dataset.vid;
    if (vb) vb.style.display = '';
    if (!ytReady) return;
    go ? (at ? YTP.loadVideoById({ videoId: vid, startSeconds: at }) : YTP.loadVideoById(vid))
       : YTP.cueVideoById({ videoId: vid, startSeconds: at });
  }
}
function buffered(a) { try { return a.buffered.length ? a.buffered.end(a.buffered.length - 1) - a.currentTime : 0; } catch (e) { return 0; } }
function prepNext() {
  /* 다음 곡 미리 받기. 곡 전체를 미리 받으면 지금 듣는 곡의 회선을 뺏겨 오히려 끊긴다
     (43분짜리 교향곡이 다음일 때 특히). 그래서 끝나기 20초 전부터, 지금 곡이 넉넉히 받아졌을 때만 시작한다. */
  if (USE !== 'mp3' || !Q.list.length || AUD.paused) return;
  const d = P.getDuration(), c = P.getCurrentTime();
  const left = d > 0 ? d - c : 1e9;
  if (left > 20) return;                                          // 끝나기 20초 전부터
  if (buffered(AUD) + 3 < left) return;                           // 지금 곡의 남은 부분이 아직 안 받아졌으면 회선을 나눠 쓰지 않는다
  const nx = Q.list[(Q.i + 1) % Q.list.length]; if (!nx) return;
  const t = trk(nx.v, nx.t); const m = t && t.music[nx.s];
  if (!m || !hasMp3(m.vid) || NXT.dataset.vid === m.vid) return;
  NXT.pause(); NXT.preload = 'auto'; NXT.src = mp3Url(m.vid); NXT.dataset.vid = m.vid; NXT.volume = S.vol / 100; NXT.load();
}
function dropNext() { if (NXT.dataset.vid) { NXT.pause(); NXT.removeAttribute('src'); NXT.preload = 'none'; NXT.load(); delete NXT.dataset.vid; } }
setInterval(prepNext, 2000);

/* 재생이 멎으면(회선이 흔들리면) 같은 자리에서 다시 붙여 본다 */
let STALL = 0;
setInterval(() => {
  if (USE !== 'mp3' || AUD.paused) { STALL = 0; return; }
  if (AUD.readyState >= 3) { STALL = 0; return; }
  if (++STALL >= 6) {                                              // 12초 동안 못 나오면
    STALL = 0; const at = AUD.currentTime || 0; const vid = AUD.dataset.vid; if (!vid) return;
    logit('12초 멎음 → 다시 연결', { vid, at, net: AUD.networkState });
    dropNext();                                                    // 미리 받던 것부터 멈춰 회선을 비운다
    AUD.src = mp3Url(vid) + '&s=' + Date.now();
    AUD.addEventListener('loadedmetadata', () => { try { AUD.currentTime = at; } catch (e) {} }, { once: true });
    AUD.play().catch(() => {});
  }
}, 2000);

/* ══ 잠금화면·알림창 조작 ══ 폰 잠금화면에 앨범 사진·곡명과 이전/재생/다음 버튼을 띄운다 (이어폰 버튼도 여기로 들어온다) */
function mediaSession(t, m, b) {
  if (!('mediaSession' in navigator)) return;
  const img = n => `https://i.ytimg.com/vi/${m.vid}/${n}`;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: m.title || '곡',
    artist: m.artist || `${pad2(t.k + 1)} ${t.title}`,
    album: `${b.name} · ${pad2(t.k + 1)} ${t.title}`,
    artwork: [
      { src: img('mqdefault.jpg'), sizes: '320x180', type: 'image/jpeg' },
      { src: img('hqdefault.jpg'), sizes: '480x360', type: 'image/jpeg' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
  for (const [k, f] of [['play', () => P.playVideo()], ['pause', () => P.pauseVideo()],
                        ['previoustrack', () => { P.getCurrentTime() > 4 ? P.seekTo(0) : step(-1); }],
                        ['nexttrack', () => step(1)],
                        ['seekbackward', () => P.seekTo(Math.max(0, P.getCurrentTime() - 10))],
                        ['seekforward', () => P.seekTo(P.getCurrentTime() + 10)],
                        ['seekto', (d) => { if (d.seekTime != null) P.seekTo(d.seekTime); }],
                        ['stop', () => P.pauseVideo()]]) {
    try { navigator.mediaSession.setActionHandler(k, f); } catch (e) {}
  }
}
function mediaState() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = playing() ? 'playing' : (Q.i >= 0 ? 'paused' : 'none');
  const d = P.getDuration(), c = P.getCurrentTime();                     // 잠금화면 진행바
  if (d > 0 && isFinite(d) && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: 1 }); } catch (e) {}
  }
}
setInterval(mediaState, 1000);

/* ══ 가사 ══ */
const LYR = {};                                                   // vid → {synced, plain, src}
async function loadLyrics(vid) { if (LYR[vid]) return LYR[vid]; try { LYR[vid] = await (await fetch(`lyrics/${vid}.json`)).json(); } catch (e) { LYR[vid] = null; } return LYR[vid]; }
async function toggleLyrics(vid) {
  const box = $(`#ly-${vid}`); if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  const L = await loadLyrics(vid); if (!L || !(L.plain || L.synced)) { box.innerHTML = '<div class="lyno">가사가 없습니다</div>'; box.hidden = false; return; }
  const src = { lrclib: '가사 · LRCLIB', ytsub: '가사 · 유튜브 자막', 'ytsub-auto': '유튜브 자동 자막 · 정확하지 않을 수 있음', manual: '가사' }[L.src] || '가사';
  box.innerHTML = `<div class="lysrc">${src}${L.synced ? ' · 재생하면 따라갑니다' : ''}</div>` + (L.synced ? L.synced.map((x, i) => `<p data-t="${x[0]}">${esc(x[1]) || '&nbsp;'}</p>`).join('') : L.plain.split('\n').map(l => `<p>${esc(l) || '&nbsp;'}</p>`).join(''));
  box.hidden = false;
}
function syncLyrics() {
  const q = cur(); if (!q || !pReady() || !P.getCurrentTime) return;
  const m = trk(q.v, q.t).music[q.s]; const box = $(`#ly-${m.vid}`); if (!box || box.hidden) return;
  const t = P.getCurrentTime(); let cur_ = null;
  box.querySelectorAll('p[data-t]').forEach(p => { if (+p.dataset.t <= t + 0.3) cur_ = p; p.classList.remove('now'); });
  if (cur_) { cur_.classList.add('now'); if (!box.dataset.hold) box.scrollTo({ top: cur_.offsetTop - box.clientHeight / 2 + cur_.offsetHeight / 2, behavior: 'smooth' }); }   // 가사 상자 안에서만 움직인다 — 읽던 글은 그대로
}
setInterval(syncLyrics, 500);
document.addEventListener('mousedown', e => { const b = e.target.closest('.lyrics'); if (b) { b.dataset.hold = '1'; clearTimeout(b._h); b._h = setTimeout(() => delete b.dataset.hold, 4000); } });

/* ══ QR 로 들어왔을 때: 그 곡 바로 재생 (브라우저가 막으면 ▶ 안내) ══ */
function autoPlay(v, k, si) {
  const t = trk(v, k); if (!t.music[si] || t.music[si].dead) return;
  history.replaceState(null, '', `#/b/${book(v).vol}/${pad2(k + 1)}`);
  const tryPlay = () => { playTrack(v, k, null, si); setTimeout(() => { if (!playing()) toast('▶ 를 누르면 곡이 나옵니다'); }, 2500); };
  if (pReady()) tryPlay(); else pendingPlay = tryPlay;
}

/* ══ 재생 ══ */
function ctxQueue(ctx) {
  let tracks, name;
  if (ctx.type === 'album') { tracks = book(ctx.v).tracks; name = book(ctx.v).name; }
  else if (ctx.type === 'chapter') { const c = book(ctx.v).chapters[ctx.c]; tracks = book(ctx.v).tracks.slice(c.from - 1, c.from - 1 + c.n); name = c.title; }
  else if (ctx.type === 'pl') { tracks = pl(ctx.id).items.map(([v, k]) => trk(v, k)); name = pl(ctx.id).name; }
  else if (ctx.type === 'liked') { tracks = S.liked.map(([v, k]) => trk(v, k)); name = '좋아요 표시한 꼭지'; }
  else { tracks = book(ctx.v).tracks; name = book(ctx.v).name; }
  return { list: tracks.flatMap(t => t.music.map((m, s) => ({ v: t.v, t: t.k, s })).filter(x => !t.music[x.s].dead)), name };
}
function startQueue(list, i, ctx) {
  Q.list = list; Q.orig = list.slice(); Q.i = i; Q.ctx = ctx;
  if (S.shuffle) doShuffle();
  playCur();
}
function playCtx(ctx) { const { list, name } = ctxQueue(ctx); if (!list.length) return toast('재생할 곡이 없습니다'); startQueue(list, 0, { ...ctx, name }); }
function togglePlayCtx(ctx) { if (sameCtx(ctx)) togglePlay(); else playCtx(ctx); }
function playTrack(v, k, ctx, s = 0) {
  const t = trk(v, k); const m = t.music[s]; if (!m) return toast('이 꼭지에는 곡이 없습니다'); if (m.dead) return toast('유튜브에서 내려간 영상입니다');
  const c = ctx || Q.ctx && ctxContains(Q.ctx, v, k) && Q.ctx || { type: 'album', v };
  const { list, name } = ctxQueue(c); let i = list.findIndex(x => x.v === v && x.t === k && x.s === s); if (i < 0) i = 0;
  Q.list = list; Q.orig = list.slice(); Q.i = i; Q.ctx = { ...c, name };
  if (S.shuffle) doShuffle();
  playCur();
}
function ctxContains(ctx, v, k) { return ctxQueue(ctx).list.some(x => x.v === v && x.t === k); }
function doShuffle() { const c = Q.list[Q.i]; const rest = Q.list.filter((_, i) => i !== Q.i); for (let i = rest.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [rest[i], rest[j]] = [rest[j], rest[i]]; } Q.list = [c, ...rest]; Q.i = 0; }
function unShuffle() { const c = Q.list[Q.i]; Q.list = Q.orig.slice(); Q.i = Math.max(0, Q.list.findIndex(x => x.v === c.v && x.t === c.t && x.s === c.s)); }
function playCur(seek) {
  const q = cur(); if (!q) return;
  const t = trk(q.v, q.t), m = t.music[q.s], b = book(q.v);
  if (Q.ctx && (!LIST || !sameCtx(LIST)) && Q.ctx.type !== 'artist') { LIST = { type: Q.ctx.type, v: Q.ctx.v, c: Q.ctx.c, id: Q.ctx.id }; renderList(); }
  $('#bar').classList.remove('idle');
  $('#now-img').src = `https://i.ytimg.com/vi/${m.vid}/mqdefault.jpg`;
  { const el = $('#now-song'); el.dataset.base = songTxt(m) || '곡'; el.textContent = el.dataset.base; } $('#now-sub').textContent = `${pad2(q.t + 1)} ${t.title} · ${b.vol}권`;
  const run = () => { seek ? P.loadVideoById({ videoId: m.vid, startSeconds: seek }) : P.loadVideoById(m.vid); };
  if (pReady()) run(); else pendingPlay = run;
  S.plays[key(q.v, q.t)] = (S.plays[key(q.v, q.t)] || 0) + 1;
  renderBody();
  syncBar(); markRows(); renderLib(); persistQueue();
  if (PAGE && (PAGE.v !== q.v || PAGE.k !== q.t)) go(`#/b/${b.vol}/${pad2(q.t + 1)}`);     // 글을 보고 있으면 곡 따라 글도 넘어간다
  mediaSession(t, m, b);
}
function playing() { return pReady() && P.getPlayerState && P.getPlayerState() === 1; }
function togglePlay() { if (!pReady() || Q.i < 0) return; playing() ? P.pauseVideo() : P.playVideo(); }
function step(d) {
  if (!Q.list.length) return;
  let i = Q.i + d;
  if (i >= Q.list.length) { if (S.repeat === 1 || d === -1) i = 0; else { i = 0; if (d === 1 && S.repeat === 0) { P.pauseVideo(); Q.i = 0; playCur(); P.pauseVideo(); return; } } }
  if (i < 0) i = Q.list.length - 1;
  Q.i = i; playCur();
}
function onState(e) {
  const q = cur(); if (!q) return;
  const st = e.data;
  if (st === YT.PlayerState.PLAYING) { const m = trk(q.v, q.t).music[q.s]; if (!m.dur) m.dur = Math.round(P.getDuration()); }
  if (st === YT.PlayerState.ENDED) { if (S.repeat === 2) { P.seekTo(0); P.playVideo(); } else step(1); }
  syncBar(); markRows(); renderBody();
}
function syncBar() {
  const p = playing(); $('#play').textContent = p ? '❚❚' : '▶';
  { const el = $('#now-song'); if (el && el.dataset.base) el.textContent = el.dataset.base + (USE === 'yt' && Q.i >= 0 ? '  ·  유튜브' : ''); }   // 무엇으로 트는지 보이게
  mediaState();
  const vb = document.querySelector('.video'); if (vb) vb.style.display = USE === 'mp3' ? 'none' : '';   // MP3 로 틀 땐 유튜브 창을 숨긴다
  for (const id of ['#shuf']) $(id).classList.toggle('on', S.shuffle);
  for (const id of ['#rep']) { $(id).classList.toggle('on', S.repeat > 0); $(id).classList.toggle('one', S.repeat === 2); }
  const t = curTrack(); $('#now-like').textContent = t && liked(t.v, t.k) ? '♥' : '♡'; $('#now-like').classList.toggle('on', !!(t && liked(t.v, t.k)));
  $('#mute').textContent = S.muted || S.vol === 0 ? '🔇' : S.vol < 40 ? '🔉' : '🔊'; $('#vol').value = S.muted ? 0 : S.vol;
  const pb = $('#playall'); if (pb) pb.textContent = Q.ctx && LIST && sameCtx(LIST) && p ? '❚❚' : '▶';
  const sb = $('.sticky .playbig'); if (sb) sb.textContent = pb ? pb.textContent : '▶';
}
function currentCtxOfPage() { const p = location.hash.replace(/^#\/?/, '').split('/'); if (p[0] === 'b') return { type: 'album', v: +p[1] - 1 }; if (p[0] === 'c') return { type: 'chapter', v: +p[1] - 1, c: +p[2] - 1 }; if (p[0] === 'pl') return { type: 'pl', id: p[1] }; if (p[0] === 'liked') return { type: 'liked' }; return {}; }
function markRows() { const q = cur(); const p = playing(); const rp = $('#rplay'); if (rp) rp.textContent = LIST && sameCtx(LIST) && p ? '❚❚' : '▶'; $$('.tl, .rl, .gc').forEach(el => { const on = !!q && +el.dataset.v === q.v && +el.dataset.k === q.t; el.classList.toggle('on', on); el.classList.toggle('paused', on && !p); }); }
function persistQueue() { store('q', { list: Q.list, i: Q.i, ctx: Q.ctx, orig: Q.orig, pos: pReady() && P.getCurrentTime ? P.getCurrentTime() : 0 }); }
function restoreQueue() {
  const q = load('q', null); if (!q || !q.list?.length) return;
  Q.list = q.list; Q.i = q.i; Q.ctx = q.ctx; Q.orig = q.orig || q.list.slice();
  const t = curTrack(), m = t && t.music[Q.list[Q.i].s]; if (!m) return;
  $('#bar').classList.remove('idle'); $('#now-img').src = `https://i.ytimg.com/vi/${m.vid}/mqdefault.jpg`; $('#now-song').textContent = songTxt(m); $('#now-sub').textContent = `${pad2(Q.i >= 0 ? Q.list[Q.i].t + 1 : 0)} ${t.title} · ${book(t.v).vol}권`;
  if (!pendingPlay) pendingPlay = () => { P.cueVideoById({ videoId: m.vid, startSeconds: q.pos || 0 }); };   // QR 자동재생이 먼저면 그걸 우선
  mediaSession(t, m, book(t.v));                                    // 앱을 다시 열었을 때도 잠금화면에 곡이 뜨게
  syncBar();
}
setInterval(() => {
  if (!pReady() || Q.i < 0 || !P.getDuration) return;
  const d = P.getDuration() || 0, c = P.getCurrentTime() || 0; const w = d ? (c / d * 100) + '%' : '0';
  $('#fill').style.width = w; $('#t0').textContent = fmt(c); $('#t1').textContent = fmt(d);
}, 500);
setInterval(persistQueue, 5000);

/* 버튼 */
$('#play').onclick = togglePlay;
for (const id of ['#prev']) $(id).onclick = () => { if (pReady() && P.getCurrentTime() > 4) P.seekTo(0); else step(-1); };
for (const id of ['#next']) $(id).onclick = () => step(1);
for (const id of ['#shuf']) $(id).onclick = () => { S.shuffle = !S.shuffle; save(); if (Q.list.length) { S.shuffle ? doShuffle() : unShuffle(); renderQueue(); persistQueue(); } syncBar(); const rs = $('#rshuf'); if (rs) rs.classList.toggle('on', S.shuffle); toast(S.shuffle ? '셔플 켜짐' : '셔플 꺼짐'); };
for (const id of ['#rep']) $(id).onclick = () => { S.repeat = (S.repeat + 1) % 3; save(); syncBar(); toast(['반복 꺼짐', '전체 반복', '한 곡 반복'][S.repeat]); };
for (const id of ['#track']) $(id).onclick = e => { if (!pReady() || Q.i < 0) return; const r = e.currentTarget.getBoundingClientRect(); P.seekTo(P.getDuration() * (e.clientX - r.left) / r.width, true); };
$('#vol').oninput = () => { S.vol = +$('#vol').value; S.muted = false; if (pReady()) { P.unMute(); P.setVolume(S.vol); } save(); syncBar(); };
$('#mute').onclick = () => { S.muted = !S.muted; if (pReady()) S.muted ? P.mute() : P.unMute(); save(); syncBar(); };
$('#now-like').onclick = () => { const t = curTrack(); if (t) toggleLike(t.v, t.k); };
$('#now').onclick = e => { if (e.target.closest('.like')) return; const t = curTrack(); if (t) go(`#/b/${book(t.v).vol}/${pad2(t.k + 1)}`); };
$('#full').onclick = () => { const t = SEL ? trk(SEL.v, SEL.k) : curTrack(); if (t) fullscreen(t); };
document.addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight' && pReady()) P.seekTo(P.getCurrentTime() + 5, true);
  else if (e.key === 'ArrowLeft' && pReady()) P.seekTo(Math.max(0, P.getCurrentTime() - 5), true);
  else if (e.key === 'n') step(1); else if (e.key === 'p') step(-1); else if (e.key === 'm') $('#mute').click();
  else if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (e.key === 'Escape') { $('#fs').hidden = true; closeMenu(); }
});

/* ══ 좋아요 · 플레이리스트 ══ */
function toggleLike(v, k) {
  const i = S.liked.findIndex(x => x[0] === v && x[1] === k);
  if (i >= 0) { S.liked.splice(i, 1); toast('좋아요에서 뺐습니다'); } else { S.liked.unshift([v, k]); toast('좋아요 표시한 꼭지에 추가했습니다'); }
  save(); syncBar(); renderBody(); renderLib();
  $$(`.tl[data-v="${v}"][data-k="${k}"] .like`).forEach(b => { b.classList.toggle('on', i < 0); b.textContent = i < 0 ? '♥' : '♡'; });
  if (location.hash === '#/liked') viewLiked();
}
function newPlaylist(add) {
  const name = prompt('플레이리스트 이름', `내 플레이리스트 #${S.pls.length + 1}`); if (!name) return;
  const p = { id: Date.now().toString(36), name: name.trim(), items: add ? [add] : [], t: Date.now() }; S.pls.unshift(p); save(); renderLib(); toast(`"${p.name}" 만들었습니다`); if (!add) go('#/pl/' + p.id);
}
function addToPl(id, v, k) { const p = pl(id); if (!p) return; if (p.items.some(x => x[0] === v && x[1] === k)) return toast('이미 있습니다'); p.items.push([v, k]); p.t = Date.now(); save(); renderLib(); toast(`"${p.name}" 에 추가했습니다`); }

/* ══ 메뉴 ══ */
function ctxItems(o) {
  const items = [];
  if (o.type === 'track') {
    const t = trk(o.v, o.k); const m = t.music.filter(x => !x.dead);
    items.push({ l: liked(o.v, o.k) ? '좋아요 취소' : '좋아요', f: () => toggleLike(o.v, o.k) });
    items.push({ sub: '플레이리스트에 추가' }); S.pls.forEach(p => items.push({ l: '　' + p.name, f: () => addToPl(p.id, o.v, o.k) })); items.push({ l: '　＋ 새 플레이리스트', f: () => newPlaylist([o.v, o.k]) });
    items.push('hr');
    items.push({ l: '꼭지 열기', f: () => go(`#/b/${book(o.v).vol}/${pad2(o.k + 1)}`) });
    items.push({ l: '앨범으로 이동', f: () => go(`#/b/${book(o.v).vol}/${pad2(o.k + 1)}`) });
    items.push({ l: '링크 복사', f: () => copyLink(`${location.origin}${location.pathname}#/b/${book(o.v).vol}/${pad2(o.k + 1)}`) });
    m.forEach(x => items.push({ l: `유튜브에서 열기 · ${x.title.slice(0, 18)}`, f: () => window.open('https://youtu.be/' + x.vid, '_blank') }));
    const ctxPl = currentCtxOfPage(); if (ctxPl.type === 'pl') items.push('hr', { l: '이 플레이리스트에서 빼기', f: () => { const p = pl(ctxPl.id); p.items = p.items.filter(x => !(x[0] === o.v && x[1] === o.k)); save(); route(); } });
  } else {
    items.push({ l: '재생', f: () => playCtx(o) });
    if (o.type === 'album') items.push('hr', { l: '링크 복사', f: () => copyLink(`${location.origin}${location.pathname}#/b/${book(o.v).vol}`) });
    if (o.type === 'chapter') items.push('hr', { l: '링크 복사', f: () => copyLink(`${location.origin}${location.pathname}#/c/${book(o.v).vol}/${o.c + 1}`) });
    if (o.type === 'pl') items.push('hr', { l: '이름 바꾸기', f: () => { const p = pl(o.id); const n = prompt('이름', p.name); if (n) { p.name = n.trim(); save(); renderLib(); route(); } } }, { l: '삭제', f: () => { if (confirm('이 플레이리스트를 지울까요?')) { S.pls = S.pls.filter(p => p.id !== o.id); save(); renderLib(); go('#/'); } } });
  }
  return items;
}
function ctxMenu(e, items) {
  const M = $('#menu'); M.innerHTML = items.map(i => i === 'hr' ? '<hr>' : i.sub ? `<div class="sub">${esc(i.sub)}</div>` : `<button>${esc(i.l)}</button>`).join('');
  const btns = [...M.querySelectorAll('button')]; items.filter(i => i !== 'hr' && !i.sub).forEach((i, n) => btns[n].onclick = () => { closeMenu(); i.f(); });
  M.hidden = false; const x = Math.min(e.clientX, innerWidth - M.offsetWidth - 8), y = Math.min(e.clientY, innerHeight - M.offsetHeight - 8); M.style.left = x + 'px'; M.style.top = y + 'px';
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}
function closeMenu() { $('#menu').hidden = true; }
function copyLink(u) { navigator.clipboard?.writeText(u).then(() => toast('링크를 복사했습니다'), () => prompt('링크', u)); }
let toastT; function toast(m) { const T = $('#toast'); T.textContent = m; T.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { T.hidden = true; }, 1800); }
