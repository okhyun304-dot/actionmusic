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
fetch('data.json').then(r => r.json()).then(d => {
  DATA = d;
  d.books.forEach((b, v) => { b.v = v; b.tracks.forEach((t, k) => { t.v = v; t.k = k; }); b.chapters.forEach((c, ci) => { c.v = v; c.ci = ci; }); });
  renderLib(); route(); restoreQueue(); if (!LIST) { const t = curTrack(); LIST = t ? { type: 'album', v: t.v } : { type: 'album', v: 2 }; renderList(); }
  const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
});
window.onYouTubeIframeAPIReady = () => {
  YTP = new YT.Player('yt', { width: 120, height: 68, videoId: '', playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 0 },
    events: { onReady: () => { ytReady = true; YTP.setVolume(S.vol); if (S.muted) YTP.mute(); if (pendingPlay) { pendingPlay(); pendingPlay = null; } }, onStateChange: onState } });
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
  $('#main').scrollTop = 0; PAGE = null;
  const nav = p[0] || 'home';
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
  $('#q').value = nav === 'search' ? (p[1] || '') : $('#q').value;
  if (nav === 'b' && p[2]) { const v = +p[1] - 1, k = +p[2] - 1; if (trk(v, k)) return viewTrack(v, k); }
  if (nav === 'b') return viewBook(+p[1] - 1);
  if (nav === 'c') return viewChapter(+p[1] - 1, +p[2] - 1);
  if (nav === 'pl') return viewPlaylist(p[1]);
  if (nav === 'liked') return viewLiked();
  if (nav === 'artist') return viewArtist();
  if (nav === 'search') return viewSearch(p[1] || '', p[2] || 'all');
  if (nav === 'lib') return viewLibMobile();
  viewHome();
}
$('#back').onclick = () => history.back(); $('#fwd').onclick = () => history.forward();
let qTimer; $('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => go('#/search/' + encodeURIComponent($('#q').value.trim())), 250); });
$('#q').addEventListener('focus', () => { if (!location.hash.startsWith('#/search')) go('#/search'); });

/* ══ 왼쪽 라이브러리 ══ */
function libItems() {
  const items = [];
  items.push({ type: 'liked', name: '좋아요 표시한 꼭지', sub: `플레이리스트 · ${S.liked.length}곡`, href: '#/liked', ico: '♥', t: S.libTouched.liked || 0 });
  S.pls.forEach(p => items.push({ type: 'pl', id: p.id, name: p.name, sub: `플레이리스트 · ${p.items.length}곡`, href: '#/pl/' + p.id, ico: '♫', cls: 'pl', t: p.t || 0 }));
  DATA.books.forEach(b => items.push({ type: 'album', v: b.v, name: b.name, sub: '앨범 · 배준익', href: '#/b/' + b.vol, img: b.cover, t: S.libTouched[key(b.v, 'a')] || 0 }));
  DATA.books.forEach(b => b.chapters.forEach(c => items.push({ type: 'pl', v: b.v, ci: c.ci, name: c.title, sub: `플레이리스트 · ${b.vol}권 ${c.label}`, href: `#/c/${b.vol}/${c.ci + 1}`, img: b.tracks[c.from - 1].thumb, t: S.libTouched[key(b.v, 'c' + c.ci)] || 0 })));
  return items;
}
function renderLib() {
  const q = ($('#libq').value || '').toLowerCase();
  let items = libItems().filter(i => S.libf === 'album' ? i.type === 'album' : i.type !== 'album').filter(i => !q || i.name.toLowerCase().includes(q));
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
    <div class="feat" style="--c:${f.color}"><img class="fcv" src="${f.cover}" alt=""><div class="ftx">
      <div class="ftag">${esc(f.tag || '앨범')}</div><h1>${esc(f.name)}</h1>
      <p class="fintro">${esc(f.intro || '')}</p>
      <div class="fmeta">${f.tracks.length}곡${total ? ' · ' + fmtLong(total) : ''} · ${f.chapters.map(x => esc(x.title)).join(' · ')}</div>
      <div class="fbtns"><button class="playbig" id="fplay">${on ? '❚❚' : '▶'}</button><a class="btn ghost" href="#/b/${f.vol}">앨범 열기</a>${last ? `<a class="btn ghost" href="#/b/${book(last[0]).vol}/${pad2(last[1] + 1)}">이어 읽기 · ${pad2(last[1] + 1)} ${esc(trk(last[0], last[1]).title)}</a>` : ''}</div></div></div>
    <div class="pad"><div class="h2"><span>행동힙합 1~6권</span><small>배준익</small></div>
      <div class="albums">${DATA.books.map(b => `<div class="alb${b.v === f.v ? ' on' : ''}" data-go="#/b/${b.vol}" data-ctx="album|${b.v}"><img src="${b.cover}" alt=""><div class="at"><b>${esc(b.name)}</b><small>${esc(b.tag || '')} · ${b.tracks.length}곡</small><p>${esc(b.intro || '')}</p></div><button class="go" data-playctx="album|${b.v}">▶</button></div>`).join('')}</div>
    </div>`;
  $('#fplay').onclick = () => togglePlayCtx({ type: 'album', v: f.v });
  bindCards();
}
const cardAlbum = b => `<div class="card" data-go="#/b/${b.vol}" data-ctx="album|${b.v}"><img class="cv tall" src="${b.cover}" alt=""><div class="ct">${esc(b.name)}</div><div class="cs">${b.year} · 앨범 · ${b.tracks.length}곡</div><button class="go" data-playctx="album|${b.v}">▶</button></div>`;
const cardChapter = (b, c) => `<div class="card" data-go="#/c/${b.vol}/${c.ci + 1}" data-ctx="chapter|${b.v}|${c.ci}"><img class="cv" src="${b.tracks[c.from - 1].thumb}" alt=""><div class="ct">${esc(c.title)}</div><div class="cs">${b.vol}권 ${esc(c.label)} · ${c.n}곡</div><button class="go" data-playctx="chapter|${b.v}|${c.ci}">▶</button></div>`;
const cardTrack = t => `<div class="card" data-go="#/b/${book(t.v).vol}/${pad2(t.k + 1)}"><img class="cv" src="${t.thumb}" alt=""><div class="ct">${esc(t.title)}</div><div class="cs">${book(t.v).vol}권 ${pad2(t.k + 1)} · ${esc(t.music[0]?.title || '')}</div><button class="go" data-play="${t.v},${t.k}">▶</button></div>`;
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
      <div class="ti"><img src="${t.thumb}" alt="" loading="lazy"><span style="min-width:0"><b>${esc(t.title)}</b><small>${opts.showBook ? `<a href="#/b/${b.vol}">${esc(b.name)}</a> · ` : ''}${esc(ch.title)}</small></span></div>
      <div class="song">${m ? (t.music.length > 1 ? `<i>${t.music.length}곡 · </i>` : '') + esc(m.title) + (m.artist ? ` <i>· ${esc(m.artist)}</i>` : '') : '<i>—</i>'}</div>
      <button class="like${liked(t.v, t.k) ? ' on' : ''}" title="좋아요">${liked(t.v, t.k) ? '♥' : '♡'}</button>
      <div class="dur">${trackDur(t) ? fmt(trackDur(t)) : ''}</div>
      <button class="more" title="더보기">⋯</button></div>`;
  });
  return rows;
}
function bindRows(ctx) {
  $$('.tl').forEach(el => {
    const v = +el.dataset.v, k = +el.dataset.k;
    el.onclick = e => {
      if (e.target.closest('.like')) { toggleLike(v, k); return; }
      if (e.target.closest('.more')) { ctxMenu(e, ctxItems({ type: 'track', v, k })); return; }
      if (e.target.closest('.n')) { playTrack(v, k, ctx); return; }
      if (e.target.closest('a')) return;
      go(`#/b/${book(v).vol}/${pad2(k + 1)}`);
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
      <div class="verified"><i>✓</i>인증된 아티스트</div><h1>배준익</h1><div class="meta"><span>행동주의자 · 5개 앨범 · ${DATA.books.reduce((a, b) => a + b.tracks.length, 0)}곡</span></div></div></div>
    <div class="under" style="--c:#222">${toolsHtml(ctx)}
      <div class="h2"><span>${top.length ? '많이 들은 꼭지' : '인기 꼭지'}</span></div>
      ${trackRows(tracks, { type: 'album', v: 0 }, { numberByIndex: true, showBook: true })}
      <div class="h2"><span>디스코그래피</span></div><div class="row">${DATA.books.map(cardAlbum).join('')}</div>
      <div class="h2"><span>플레이리스트</span></div><div class="row">${DATA.books.flatMap(b => b.chapters.map(c => cardChapter(b, c))).join('')}</div>
      <div class="h2"><span>소개</span></div>
      <div class="about"><b>행동주의자 배준익</b>사업가. 새벽에 일어나 글을 쓰고, 음악을 듣고, 텔레그램에 남긴다. 「행동힙합」은 그 글과 음악을 오키가 다섯 권으로 엮은 것이다. 1권 행동힙합(2024) · 2권 힙합자본(2025) · 3권 생존 · 4권 사랑 · 5권 명반(2026).</div></div>`;
  $('#playall').onclick = () => { const q = tracks.map(t => t.music.map((m, s) => ({ v: t.v, t: t.k, s })).filter((x) => !t.music[x.s].dead)).flat(); startQueue(q, 0, { type: 'artist', name: '배준익' }); };
  bindRows({ type: 'album', v: 0 }); bindCards();
}

/* ══ 검색 ══ */
function viewSearch(q, tab) {
  const s = q.trim().toLowerCase();
  if (!s) {
    $('#view').innerHTML = `<div class="pad"><div class="h1">모두 둘러보기</div><div class="genres">
      ${DATA.books.map(b => `<div class="genre" style="--c:${b.color}" data-go="#/b/${b.vol}">${b.vol}권 ${esc(b.sub) || '행동힙합'}<small>${b.tracks.length}곡</small><img src="${b.cover}" alt=""></div>`).join('')}
      ${DATA.books.flatMap(b => b.chapters.map(c => `<div class="genre" style="--c:${shade(b.color, c.ci)}" data-go="#/c/${b.vol}/${c.ci + 1}">${esc(c.title)}<small>${b.vol}권 ${esc(c.label)} · ${c.n}곡</small><img src="${b.tracks[c.from - 1].thumb}" alt=""></div>`)).join('')}
      <div class="genre" style="--c:#4b3f8f" data-go="#/liked">좋아요<small>${S.liked.length}곡</small></div></div></div>`;
    bindCards(); return;
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
  $('#view').innerHTML = `<div class="pad">${body}</div>`; bindCards();
  $$('.hit').forEach(el => { const v = +el.dataset.v, k = +el.dataset.k; el.onclick = e => { if (e.target.closest('.go')) return; go(`#/b/${book(v).vol}/${pad2(k + 1)}`); }; el.oncontextmenu = e => { e.preventDefault(); ctxMenu(e, ctxItems({ type: 'track', v, k })); }; });
}
const hitTrack = (t, hl) => `<div class="hit" data-v="${t.v}" data-k="${t.k}"><img src="${t.thumb}" alt=""><span style="min-width:0"><b>${hl(t.title)}</b><small>꼭지 · ${book(t.v).vol}권 ${pad2(t.k + 1)}${t.music[0] ? ' · ♪ ' + hl(t.music[0].title) : ''}</small></span><button class="go tile-go" data-play="${t.v},${t.k}" style="margin-left:auto;background:none;color:#fff;font-size:16px">▶</button></div>`;
const hitSong = (t, m, hl) => `<div class="hit" data-v="${t.v}" data-k="${t.k}"><img src="https://i.ytimg.com/vi/${m.vid}/mqdefault.jpg" alt=""><span style="min-width:0"><b>${hl(m.title)}</b><small>${hl(m.artist)} · 꼭지 ${esc(t.title)}</small></span></div>`;
function shade(hex, i) { const n = parseInt(hex.slice(1), 16); const f = 0.75 + (i % 4) * 0.12; const c = x => Math.min(255, Math.round(x * f)); return `rgb(${c(n >> 16)},${c(n >> 8 & 255)},${c(n & 255)})`; }

/* ══ 폰 라이브러리 ══ */
function viewLibMobile() {
  $('#view').innerHTML = `<div class="pad"><div class="h1">내 라이브러리</div><div class="tiles">${libItems().map(i => `<div class="tile" data-go="${i.href}">${i.img ? `<img src="${i.img}" alt="">` : `<span class="ico">${i.ico}</span>`}<span>${esc(i.name)}<br><small style="color:#b3b3b3;font-weight:400">${esc(i.sub)}</small></span></div>`).join('')}</div></div>`;
  bindCards();
}

/* ══ 꼭지 페이지 (가운데 = 글) ══ */
let PAGE = null;                                                  // 지금 가운데에 열린 꼭지 {v,k}
function select(v, k) { SEL = { v, k }; S.recent = [[v, k], ...S.recent.filter(x => !(x[0] === v && x[1] === k))].slice(0, 16); save(); }
function viewTrack(v, k) {
  const b = book(v); const t = b.tracks[k]; if (!t) return viewHome();
  select(v, k); PAGE = { v, k };
  if (!LIST || !ctxTracks(LIST).tracks.some(x => x.v === v && x.k === k)) LIST = { type: 'album', v };
  renderList();
  const c = cur(); const prev = b.tracks[k - 1], next = b.tracks[k + 1];
  const ch = b.chapters.find(x => k >= x.from - 1 && k < x.from - 1 + x.n);
  $('#view').innerHTML = `<div class="tp">
    <div class="crumb"><a href="#/b/${b.vol}">${esc(b.name)}</a> · <a href="#/c/${b.vol}/${ch.ci + 1}">${esc(ch.label)} ${esc(ch.title)}</a></div>
    <h1><i>${pad2(k + 1)}</i>${esc(t.title)}</h1>
    <div class="acts"><button class="playbig" data-act="play">${c && c.v === v && c.t === k && playing() ? '❚❚' : '▶'}</button><button class="ic like${liked(v, k) ? ' on' : ''}" data-act="like">${liked(v, k) ? '♥' : '♡'}</button><button class="ic" data-act="fs" title="전체화면">⛶</button><button class="ic" data-act="more" title="더보기">⋯</button><span style="margin-left:auto;font-size:12px;color:var(--dim)">${t.date || ''}</span></div>
    ${t.thumb && !t.thumb.startsWith('http') ? `<img class="hero" src="${t.thumb}" alt="">` : ''}
    ${t.music.length ? `<div class="songs">${t.music.map((m, s) => `<div class="songrow${m.dead ? ' dead' : ''}${c && c.v === v && c.t === k && c.s === s ? ' on' : ''}" data-s="${s}"><img src="https://i.ytimg.com/vi/${m.vid}/mqdefault.jpg" alt=""><div class="st"><b>${esc(m.title || '곡')}</b><small>${m.dead ? '유튜브에서 내려간 영상 · 교체 예정' : esc(m.artist) + (m.dur ? ' · ' + fmt(m.dur) : '')}</small></div>${m.lyr ? `<button class="lyb" data-vid="${m.vid}" title="가사">가사</button>` : ''}<span class="pb">▶</span></div><div class="lyrics" id="ly-${m.vid}" hidden></div>`).join('')}</div>` : ''}
    <div class="body">${t.html}</div>
    <div class="pn">${prev ? `<a href="#/b/${b.vol}/${pad2(k)}">← ${pad2(k)} ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="#/b/${b.vol}/${pad2(k + 2)}">${pad2(k + 2)} ${esc(next.title)} →</a>` : '<span></span>'}</div>
  </div>`;
  const R = $('#view');
  R.querySelectorAll('.songrow').forEach(el => el.onclick = e => { if (e.target.closest('.lyb')) { toggleLyrics(e.target.dataset.vid); return; } playTrack(v, k, null, +el.dataset.s); });
  R.querySelector('[data-act=play]').onclick = () => { const q = cur(); if (q && q.v === v && q.t === k) togglePlay(); else playTrack(v, k); };
  R.querySelector('[data-act=like]').onclick = () => toggleLike(v, k);
  R.querySelector('[data-act=fs]').onclick = () => fullscreen(t);
  R.querySelector('[data-act=more]').onclick = e => ctxMenu(e, ctxItems({ type: 'track', v, k }));
  renderLib();
}
function renderBody() {                                            // 꼭지 페이지가 열려 있으면 재생 상태만 갱신
  if (!PAGE || !$('.tp')) return;
  const q = cur(); const p = playing(); const on = q && q.v === PAGE.v && q.t === PAGE.k;
  const pb = $('.tp [data-act=play]'); if (pb) pb.textContent = on && p ? '❚❚' : '▶';
  $$('.tp .songrow').forEach(el => el.classList.toggle('on', !!on && +el.dataset.s === q.s));
  const lk = $('.tp [data-act=like]'); if (lk) { lk.classList.toggle('on', liked(PAGE.v, PAGE.k)); lk.textContent = liked(PAGE.v, PAGE.k) ? '♥' : '♡'; }
}
function renderQueue() {}
function fullscreen(t) { $('#fs').hidden = false; $('#fs').style.setProperty('--c', book(t.v).color); $('#fs-in').innerHTML = `<div style="font-size:14px;opacity:.7;font-weight:400">${esc(book(t.v).name)} · ${esc(t.chapter)}</div><h2 style="margin:4px 0 24px">${pad2(t.k + 1)} ${esc(t.title)}</h2><div class="body">${t.html}</div>`; }
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
    cards += `<div class="gc${c && c.v === t.v && c.t === t.k ? ' on' : ''}${dead ? ' dead' : ''}" data-v="${t.v}" data-k="${t.k}"><img class="cv" src="${t.thumb}" alt="" loading="lazy"><span class="n">${L.chapters ? pad2(t.k + 1) : pad2(i + 1)}</span><div class="t">${esc(t.title)}</div><div class="s">${m ? '♪ ' + esc(m.title) : '—'}</div><button class="go">▶</button></div>`;
  });
  $('#view').innerHTML = `<div class="grid-h" style="--c:${color}">${L.img ? `<img class="${ctx.type === 'album' ? 'tall' : ''}" src="${L.img}" alt="">` : `<div class="ico ${ctx.type === 'pl' ? 'pl' : ''}">${L.ico || '♫'}</div>`}<div style="min-width:0">
      <div class="kind">${ctx.type === 'album' ? '앨범' : '플레이리스트'}</div><h1>${esc(L.name)}</h1>
      <div class="meta"><b>배준익</b> · ${L.tracks.length}곡${total ? ' · ' + fmtLong(total) : ''}${b && ctx.type === 'album' ? ' · ' + b.year : ''}</div></div></div>
    <div class="grid-b" style="--c:${color}"><div class="tools"><button class="playbig" id="playall">${on ? '❚❚' : '▶'}</button><button class="ic${S.shuffle ? ' on' : ''}" id="shufctx" title="셔플">⇄</button><button class="ic" id="morectx" title="더보기">⋯</button></div>
      <div class="gcards">${cards}</div>${L.tracks.length ? '' : '<div class="empty">비어 있습니다. 꼭지의 ⋯ 메뉴에서 "플레이리스트에 추가"를 누르세요.</div>'}</div>`;
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
      <img src="${t.thumb}" alt="" loading="lazy"><div class="t"><b>${esc(t.title)}</b><small>${m ? esc(m.title) : '—'}</small></div><div class="d">${trackDur(t) ? fmt(trackDur(t)) : ''}</div></div>`;
  });
  $('#rlist').innerHTML = rows;
  $$('#rlist .rl').forEach(el => {
    const v = +el.dataset.v, k = +el.dataset.k;
    el.onclick = () => { playTrack(v, k, LIST); go(`#/b/${book(v).vol}/${pad2(k + 1)}`); };      // 줄 어디를 눌러도 재생 + 글 열기
    el.oncontextmenu = e => { e.preventDefault(); ctxMenu(e, ctxItems({ type: 'track', v, k })); };
  });
  const sel = $('#rlist .rl.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}

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
  const q = cur(); if (!q || !ytReady || !YTP.getCurrentTime) return;
  const m = trk(q.v, q.t).music[q.s]; const box = $(`#ly-${m.vid}`); if (!box || box.hidden) return;
  const t = YTP.getCurrentTime(); let cur_ = null;
  box.querySelectorAll('p[data-t]').forEach(p => { if (+p.dataset.t <= t + 0.3) cur_ = p; p.classList.remove('now'); });
  if (cur_) { cur_.classList.add('now'); if (!box.dataset.hold) box.scrollTo({ top: cur_.offsetTop - box.clientHeight / 2 + cur_.offsetHeight / 2, behavior: 'smooth' }); }   // 가사 상자 안에서만 움직인다 — 읽던 글은 그대로
}
setInterval(syncLyrics, 500);
document.addEventListener('mousedown', e => { const b = e.target.closest('.lyrics'); if (b) { b.dataset.hold = '1'; clearTimeout(b._h); b._h = setTimeout(() => delete b.dataset.hold, 4000); } });

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
  $('#now-song').textContent = m.title || '곡'; $('#now-sub').textContent = `${pad2(q.t + 1)} ${t.title} · ${b.vol}권`;
  const run = () => { seek ? YTP.loadVideoById({ videoId: m.vid, startSeconds: seek }) : YTP.loadVideoById(m.vid); };
  if (ytReady) run(); else pendingPlay = run;
  S.plays[key(q.v, q.t)] = (S.plays[key(q.v, q.t)] || 0) + 1;
  renderBody();
  syncBar(); markRows(); renderLib(); persistQueue();
  if (PAGE && (PAGE.v !== q.v || PAGE.k !== q.t)) go(`#/b/${b.vol}/${pad2(q.t + 1)}`);     // 글을 보고 있으면 곡 따라 글도 넘어간다
}
function playing() { return ytReady && YTP.getPlayerState && YTP.getPlayerState() === 1; }
function togglePlay() { if (!ytReady || Q.i < 0) return; playing() ? YTP.pauseVideo() : YTP.playVideo(); }
function step(d) {
  if (!Q.list.length) return;
  let i = Q.i + d;
  if (i >= Q.list.length) { if (S.repeat === 1 || d === -1) i = 0; else { i = 0; if (d === 1 && S.repeat === 0) { YTP.pauseVideo(); Q.i = 0; playCur(); YTP.pauseVideo(); return; } } }
  if (i < 0) i = Q.list.length - 1;
  Q.i = i; playCur();
}
function onState(e) {
  const q = cur(); if (!q) return;
  const st = e.data;
  if (st === YT.PlayerState.PLAYING) { const m = trk(q.v, q.t).music[q.s]; if (!m.dur) m.dur = Math.round(YTP.getDuration()); }
  if (st === YT.PlayerState.ENDED) { if (S.repeat === 2) { YTP.seekTo(0); YTP.playVideo(); } else step(1); }
  syncBar(); markRows(); renderBody();
}
function syncBar() {
  const p = playing(); $('#play').textContent = p ? '❚❚' : '▶';
  for (const id of ['#shuf']) $(id).classList.toggle('on', S.shuffle);
  for (const id of ['#rep']) { $(id).classList.toggle('on', S.repeat > 0); $(id).classList.toggle('one', S.repeat === 2); }
  const t = curTrack(); $('#now-like').textContent = t && liked(t.v, t.k) ? '♥' : '♡'; $('#now-like').classList.toggle('on', !!(t && liked(t.v, t.k)));
  $('#mute').textContent = S.muted || S.vol === 0 ? '🔇' : S.vol < 40 ? '🔉' : '🔊'; $('#vol').value = S.muted ? 0 : S.vol;
  const pb = $('#playall'); if (pb) pb.textContent = Q.ctx && LIST && sameCtx(LIST) && p ? '❚❚' : '▶';
  const sb = $('.sticky .playbig'); if (sb) sb.textContent = pb ? pb.textContent : '▶';
}
function currentCtxOfPage() { const p = location.hash.replace(/^#\/?/, '').split('/'); if (p[0] === 'b') return { type: 'album', v: +p[1] - 1 }; if (p[0] === 'c') return { type: 'chapter', v: +p[1] - 1, c: +p[2] - 1 }; if (p[0] === 'pl') return { type: 'pl', id: p[1] }; if (p[0] === 'liked') return { type: 'liked' }; return {}; }
function markRows() { const q = cur(); const p = playing(); const rp = $('#rplay'); if (rp) rp.textContent = LIST && sameCtx(LIST) && p ? '❚❚' : '▶'; $$('.tl, .rl, .gc').forEach(el => { const on = !!q && +el.dataset.v === q.v && +el.dataset.k === q.t; el.classList.toggle('on', on); el.classList.toggle('paused', on && !p); }); }
function persistQueue() { store('q', { list: Q.list, i: Q.i, ctx: Q.ctx, orig: Q.orig, pos: ytReady && YTP.getCurrentTime ? YTP.getCurrentTime() : 0 }); }
function restoreQueue() {
  const q = load('q', null); if (!q || !q.list?.length) return;
  Q.list = q.list; Q.i = q.i; Q.ctx = q.ctx; Q.orig = q.orig || q.list.slice();
  const t = curTrack(), m = t && t.music[Q.list[Q.i].s]; if (!m) return;
  $('#bar').classList.remove('idle'); $('#now-img').src = `https://i.ytimg.com/vi/${m.vid}/mqdefault.jpg`; $('#now-song').textContent = m.title; $('#now-sub').textContent = `${pad2(Q.i >= 0 ? Q.list[Q.i].t + 1 : 0)} ${t.title} · ${book(t.v).vol}권`;
  pendingPlay = () => { YTP.cueVideoById({ videoId: m.vid, startSeconds: q.pos || 0 }); };
  syncBar();
}
setInterval(() => {
  if (!ytReady || Q.i < 0 || !YTP.getDuration) return;
  const d = YTP.getDuration() || 0, c = YTP.getCurrentTime() || 0; const w = d ? (c / d * 100) + '%' : '0';
  $('#fill').style.width = w; $('#t0').textContent = fmt(c); $('#t1').textContent = fmt(d);
}, 500);
setInterval(persistQueue, 5000);

/* 버튼 */
$('#play').onclick = togglePlay;
for (const id of ['#prev']) $(id).onclick = () => { if (ytReady && YTP.getCurrentTime() > 4) YTP.seekTo(0); else step(-1); };
for (const id of ['#next']) $(id).onclick = () => step(1);
for (const id of ['#shuf']) $(id).onclick = () => { S.shuffle = !S.shuffle; save(); if (Q.list.length) { S.shuffle ? doShuffle() : unShuffle(); renderQueue(); persistQueue(); } syncBar(); const rs = $('#rshuf'); if (rs) rs.classList.toggle('on', S.shuffle); toast(S.shuffle ? '셔플 켜짐' : '셔플 꺼짐'); };
for (const id of ['#rep']) $(id).onclick = () => { S.repeat = (S.repeat + 1) % 3; save(); syncBar(); toast(['반복 꺼짐', '전체 반복', '한 곡 반복'][S.repeat]); };
for (const id of ['#track']) $(id).onclick = e => { if (!ytReady || Q.i < 0) return; const r = e.currentTarget.getBoundingClientRect(); YTP.seekTo(YTP.getDuration() * (e.clientX - r.left) / r.width, true); };
$('#vol').oninput = () => { S.vol = +$('#vol').value; S.muted = false; if (ytReady) { YTP.unMute(); YTP.setVolume(S.vol); } save(); syncBar(); };
$('#mute').onclick = () => { S.muted = !S.muted; if (ytReady) S.muted ? YTP.mute() : YTP.unMute(); save(); syncBar(); };
$('#now-like').onclick = () => { const t = curTrack(); if (t) toggleLike(t.v, t.k); };
$('#now').onclick = e => { if (e.target.closest('.like')) return; const t = curTrack(); if (t) go(`#/b/${book(t.v).vol}/${pad2(t.k + 1)}`); };
$('#full').onclick = () => { const t = SEL ? trk(SEL.v, SEL.k) : curTrack(); if (t) fullscreen(t); };
document.addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight' && ytReady) YTP.seekTo(YTP.getCurrentTime() + 5, true);
  else if (e.key === 'ArrowLeft' && ytReady) YTP.seekTo(Math.max(0, YTP.getCurrentTime() - 5), true);
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
