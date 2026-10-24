(async () => {
  const $ = id => document.getElementById(id);
  const slides = await (await fetch('slides.json', {cache: 'no-cache'})).json();
  let after = false, shown = -1, unlocked = false;
  // Endless shuffle: slides.json is newest first; weight decays with age, floor keeps old ones in rotation.
  const N = slides.length, w = slides.map((_, r) => Math.max(Math.pow(0.8, r), 0.08));
  function pick(recent) {
    const avoid = new Set(recent.slice(-Math.min(3, N - 1)));
    let tot = 0; const ok = w.map((x, k) => avoid.has(k) ? 0 : x); ok.forEach(x => tot += x);
    let r = Math.random() * tot; for (let k = 0; k < N; k++) { r -= ok[k]; if (r <= 0 && ok[k]) return k; }
    return 0;
  }
  const hist = [0]; let pos = 0, i = 0;
  const au = new Audio(); au.preload = 'auto';
  function speak() {
    const s = slides[i]; if (!s.audio) return;
    if (!au.src.endsWith(s.audio)) au.src = s.audio;
    au.currentTime = 0; au.play().then(() => { unlocked = true; }).catch(() => {});
  }
  const pre = src => { const im = new Image(); im.src = src; };
  function show() {
    const s = slides[i];
    $('pic').src = after ? s.after : s.before;
    $('pic').alt = s.ja;
    $('ja').textContent = s.ja;
    $('en').textContent = s.en || '';
    $('speak').hidden = !s.audio;
    if (shown !== pos && unlocked) { shown = pos; speak(); }
    $('count').textContent = (pos + 1);
    pre(s.after);
    if (pos === hist.length - 1) hist.push(pick(hist)); pre(slides[hist[pos + 1]].before);
  }
  let timer = null;
  const clear = () => { clearTimeout(timer); timer = null; };
  function advance() { clear(); pos++; i = hist[pos]; after = false; show(); }
  function next() {
    if (!after) { after = true; show(); clear(); timer = setTimeout(advance, 1000); }
    else advance();
  }
  function prev() { clear(); if (after) after = false; else if (pos > 0) { pos--; i = hist[pos]; after = true; } show(); }
  $('frame').addEventListener('click', next);
  $('next').addEventListener('click', next);
  $('prev').addEventListener('click', prev);
  $('speak').addEventListener('click', e => { e.stopPropagation(); unlocked = true; speak(); });
  $('toggle').addEventListener('click', () => { $('en').hidden = !$('en').hidden; });
  addEventListener('keydown', e => {
    if (['ArrowRight', ' ', 'Enter'].includes(e.key)) { if ($('splash')) { $('splash').click(); e.preventDefault(); return; } e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft') prev();
  });
  let x0 = null;
  $('frame').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, {passive: true});
  $('frame').addEventListener('touchend', e => {
    if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); dx < 0 ? next() : prev(); }
  });
  show();
  $('splash').addEventListener('click', e => {
    e.stopPropagation(); unlocked = true; $('splash').remove(); shown = -1; show();
  });
})();
