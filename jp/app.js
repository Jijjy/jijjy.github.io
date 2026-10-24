(async () => {
  const $ = id => document.getElementById(id);
  const slides = await (await fetch('slides.json', {cache: 'no-cache'})).json();
  let i = 0, after = false, shown = -1, unlocked = false;
  const au = new Audio(); au.preload = 'auto';
  function speak() {
    const s = slides[i]; if (!s.audio) return;
    if (!au.src.endsWith(s.audio)) au.src = s.audio;
    au.currentTime = 0; au.play().then(() => { unlocked = true; }).catch(() => {});
  }
  addEventListener('pointerdown', e => { if (!unlocked) { unlocked = true; if (!$('speak').contains(e.target)) speak(); } }, {once: true, capture: true});
  const pre = src => { const im = new Image(); im.src = src; };
  function show() {
    const s = slides[i];
    $('pic').src = after ? s.after : s.before;
    $('pic').alt = s.ja;
    $('ja').textContent = s.ja;
    $('en').textContent = s.en || '';
    $('speak').hidden = !s.audio;
    if (shown !== i) { shown = i; speak(); }
    $('count').textContent = (i + 1) + ' / ' + slides.length;
    pre(s.after);
    if (slides[i + 1]) pre(slides[i + 1].before);
  }
  function next() { if (!after) after = true; else if (i < slides.length - 1) { i++; after = false; } show(); }
  function prev() { if (after) after = false; else if (i > 0) { i--; after = true; } show(); }
  $('frame').addEventListener('click', next);
  $('next').addEventListener('click', next);
  $('prev').addEventListener('click', prev);
  $('speak').addEventListener('click', e => { e.stopPropagation(); unlocked = true; speak(); });
  $('toggle').addEventListener('click', () => { $('en').hidden = !$('en').hidden; });
  addEventListener('keydown', e => {
    if (['ArrowRight', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft') prev();
  });
  let x0 = null;
  $('frame').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, {passive: true});
  $('frame').addEventListener('touchend', e => {
    if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); dx < 0 ? next() : prev(); }
  });
  show();
})();
