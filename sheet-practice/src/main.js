// main.js — state machine + UI wiring. Owns the transport clock; everything
// else (render, audio, midi input, sources) hangs off it.

import { GLRenderer, FINGER } from './glRender.js';
import { ProceduralSource } from './procedural.js';
import { assignFingers } from './fingering.js';
import { spell, defaultHand } from './staff.js';
import { initAudio, isReady, play, setVolume } from './playback.js';
import { MidiInput } from './midiInput.js';
import { loadMidiFile } from './loadMidi.js';
import { loadMusicXMLFile } from './loadMusicXML.js';

const $ = (id) => document.getElementById(id);

const state = {
  allNotes: [],          // everything loaded
  notes: [],             // filtered, what we render/play
  parts: [],
  selectedParts: new Set(),
  source: 'procedural',  // 'procedural' | 'file'
  proc: null,
  bpm: 82,
  now: 0,
  prevNow: 0,
  playing: false,
  tempoScale: 1,
  visualSeconds: 6,      // seconds of music visible ahead of the playhead
  playheadFrac: 0.18,
  spelling: 'sharp',
  audioOn: false,
  practice: false,       // wait-for-key
  practiceHand: 'both',
  events: [],            // onset groups of required notes
  gateIdx: 0,
  waiting: false,
  expected: new Set(),
  correct: new Set(),
  lastCount: 0,
};

let renderer, midiInput;

// ---------- note preparation ----------

function computeSpelling(n) {
  if (n.fixedSpelling) return;               // MusicXML written spelling wins
  const s = spell(n.midi, state.spelling);
  n.diatonic = s.diatonic;
  n.accidental = s.accidental;
}

function prepareWindow() {
  // diatonic/accidental for everything visible/near; fingering on a window
  const lo = state.now - 4, hi = state.now + state.visualSeconds + 4;
  for (const n of state.notes) {
    if (n.diatonic === undefined) computeSpelling(n);   // toggle handler re-spells on change
    if (n.hand == null) n.hand = defaultHand(n.midi);
  }
  const win = state.notes.filter((n) => n.start + n.dur >= lo && n.start <= hi);
  // keep file fingerings if already present from source; only solve where missing
  const needsSolve = win.some((n) => n.finger == null);
  if (needsSolve) assignFingers(win);
}

function rebuildEvents() {
  // onset groups of required notes (optionally one hand) for wait-for-key
  const req = state.notes.filter((n) =>
    state.practiceHand === 'both' || n.hand === state.practiceHand);
  req.sort((a, b) => a.start - b.start);
  const groups = [];
  const eps = 0.04;
  for (const n of req) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(n.start - g.t) < eps) { g.midis.add(n.midi); }
    else groups.push({ t: n.start, midis: new Set([n.midi]) });
  }
  state.events = groups;
  // re-anchor gate to current position
  state.gateIdx = groups.findIndex((g) => g.t >= state.now - 1e-3);
  if (state.gateIdx < 0) state.gateIdx = groups.length;
}

// ---------- sources ----------

// Tempo slider is absolute BPM. tempoScale = targetBpm / sourceBpm.
function setTempoBpm(bpm) {
  const rng = $('rng-tempo');
  const v = Math.max(+rng.min, Math.min(+rng.max, Math.round(bpm)));
  rng.value = v;
  state.tempoScale = v / state.bpm;
  $('lbl-tempo').textContent = `${v} BPM`;
}

function startProcedural() {
  state.source = 'procedural';
  state.proc = new ProceduralSource({ seed: (Math.floor(performance.now()) % 100000) + 1, bpm: 82 });
  state.bpm = 82;
  setTempoBpm(state.bpm);
  resetTransport();
  state.allNotes = [];
  state.parts = [{ id: 'R', name: 'Right hand (melody)', count: 0, default: true },
  { id: 'L', name: 'Left hand (bass)', count: 0, default: true }];
  state.selectedParts = new Set(['R', 'L']);
  renderParts();
  pumpProcedural();
  setStatus('Procedural mode — infinite practice stream.');
}

function pumpProcedural() {
  if (state.source !== 'procedural') return;
  state.proc.ensureUntil(state.now + state.visualSeconds + 6);
  // hand on proc notes is already R/L; filter by selected parts
  state.notes = state.proc.notes.filter((n) => state.selectedParts.has(n.hand));
  // Solve spelling/fingering every frame so the window tracks `now`; the proc
  // source appends notes in batches, so gating this on a count change lets
  // playback outrun the last solve and notes scroll in unfingered (yellow).
  prepareWindow();
  if (state.notes.length !== state.lastCount) {
    state.lastCount = state.notes.length;
    rebuildEvents();
  }
}

async function loadFile(file) {
  const buf = await file.arrayBuffer();
  let data;
  if (/\.(xml|musicxml|mxl)$/i.test(file.name)) data = await loadMusicXMLFile(buf, file.name);
  else data = await loadMidiFile(buf);

  state.source = 'file';
  state.proc = null;
  state.allNotes = data.notes;
  // MusicXML notes carry written spelling -> lock it
  for (const n of state.allNotes) if (n.diatonic !== undefined) n.fixedSpelling = true;
  state.parts = data.parts;
  state.bpm = data.bpm || 120;
  setTempoBpm(state.bpm);
  state.selectedParts = new Set(state.parts.filter((p) => p.default).map((p) => p.id));
  renderParts();
  applyFilter();
  // full fingering pass once on load (skip where source supplied it)
  if (state.notes.some((n) => n.finger == null)) assignFingers(state.notes);
  resetTransport();
  setStatus(`Loaded ${file.name} — ${state.allNotes.length} notes, ${state.parts.length} part(s).`);
}

function applyFilter() {
  if (state.source === 'procedural') { pumpProcedural(); return; }
  state.notes = state.allNotes.filter((n) => state.selectedParts.has(n.part));
  for (const n of state.notes) computeSpelling(n);
  state.lastCount = state.notes.length;
  prepareWindow();
  rebuildEvents();
}

// ---------- transport ----------

function resetTransport() {
  state.now = 0; state.prevNow = 0; state.gateIdx = 0;
  state.waiting = false; state.expected.clear(); state.correct.clear();
}

function tick(dt) {
  state.prevNow = state.now;

  if (state.playing) {
    if (state.practice && state.events.length) {
      const next = state.events[state.gateIdx];
      if (next && state.now + dt * state.tempoScale >= next.t && !state.waiting) {
        // reached a gate that isn't yet satisfied -> clamp & wait
        state.now = next.t;
        const exp = new Set(next.midis);
        const allDown = [...exp].every((m) => midiInput.pressed.has(m));
        if (allDown) { advanceGate(); }
        else { state.waiting = true; state.expected = exp; }
      } else if (state.waiting) {
        const allDown = [...state.expected].every((m) => midiInput.pressed.has(m));
        state.correct = new Set([...state.expected].filter((m) => midiInput.pressed.has(m)));
        if (allDown) advanceGate();
      } else {
        state.now += dt * state.tempoScale;
      }
    } else {
      state.now += dt * state.tempoScale;
    }
  }

  if (state.source === 'procedural') pumpProcedural();
  else if (state.now > state.prevNow) prepareWindow();

  triggerAudio();
  draw();
}

function advanceGate() {
  state.waiting = false;
  state.expected.clear();
  state.correct.clear();
  state.gateIdx++;
}

function isRequired(n) {
  return state.practiceHand === 'both' || n.hand === state.practiceHand;
}

function triggerAudio() {
  if (!state.audioOn || !isReady()) return;
  // play notes whose onset was crossed this frame.
  // In practice mode the player produces the required hand themselves
  // (heard via live MIDI input), so the app only sounds the accompaniment.
  for (const n of state.notes) {
    if (n.start > state.prevNow && n.start <= state.now) {
      if (state.practice && isRequired(n)) continue;
      play(n.midi, n.dur, n.vel ?? 0.8);
    }
  }
}

// ---------- render ----------

function draw() {
  renderer.resize();
  const playheadX = renderer.w * state.playheadFrac;
  const pxPerSec = (renderer.w - playheadX) / state.visualSeconds;
  renderer.render({
    notes: state.notes,
    now: state.now,
    pxPerSec,
    playheadFrac: state.playheadFrac,
    spelling: state.spelling,
    pressed: midiInput?.pressed,
    expected: state.waiting ? state.expected : null,
    correct: state.correct,
  });
  updateLegend();
}

let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  tick(dt);
  requestAnimationFrame(loop);
}

// ---------- UI ----------

function renderParts() {
  const box = $('parts');
  box.innerHTML = '';
  for (const p of state.parts) {
    const id = `part-${p.id}`;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" id="${id}" ${state.selectedParts.has(p.id) ? 'checked' : ''}>
      ${p.name}${p.count ? ` <span class="muted">(${p.count})</span>` : ''}${p.isDrum ? ' 🥁' : ''}`;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) state.selectedParts.add(p.id); else state.selectedParts.delete(p.id);
      applyFilter();
    });
    box.appendChild(label);
  }
}

function setStatus(msg) { $('status').textContent = msg; }

async function enableAudio() {
  try {
    setStatus('Loading piano samples…');
    await initAudio();
    state.audioOn = true;
    $('btn-audio').classList.add('on');
    $('btn-audio').textContent = '🔊';
    setStatus('Audio ready.');
  } catch (e) {
    setStatus('Audio failed: ' + e.message);
  }
}

async function enableMidi() {
  try {
    const inputs = await midiInput.enable();
    $('btn-midi').classList.add('on');
    $('btn-midi').textContent = inputs.length ? `🎹 ${inputs[0].name}` : '🎹 MIDI (no device)';
    setStatus(inputs.length ? `MIDI: ${inputs.map((i) => i.name).join(', ')}` : 'MIDI enabled — connect a keyboard.');
  } catch (e) {
    setStatus('MIDI error: ' + e.message);
  }
}

let fingerSwatches = [];

// Light up the legend swatch for each finger that has a note sounding right now.
function updateLegend() {
  if (!fingerSwatches.length) return;
  const on = [false, false, false, false, false];
  for (const n of state.notes) {
    if (n.start <= state.now && state.now < n.start + n.dur) {
      on[Math.max(1, Math.min(5, n.finger || 3)) - 1] = true;
    }
  }
  fingerSwatches.forEach((sw, i) => sw.classList.toggle('on', on[i]));
}

function buildLegend() {
  const el = $('legend');
  if (!el) return;
  el.innerHTML = '';

  // colour = finger (1..5), shared by both hands. Each swatch dims to 0.5 unless
  // a note for that finger is currently being played (see updateLegend()).
  const colours = document.createElement('div');
  colours.className = 'legend-row';
  fingerSwatches = FINGER.map((c, i) => {
    const sw = document.createElement('span');
    sw.className = 'legend-sw';
    sw.style.background = c;
    sw.textContent = i + 1;
    sw.title = `Finger ${i + 1}`;
    colours.appendChild(sw);
    return sw;
  });
  el.appendChild(colours);

  // shape = hand (bevelled left corner)
  const hands = document.createElement('div');
  hands.className = 'legend-row';
  for (const [name, cls] of [['Right', 'bev-tl'], ['Left', 'bev-bl']]) {
    const item = document.createElement('span');
    item.className = 'legend-hand';
    const chip = document.createElement('span');
    chip.className = 'legend-chip ' + cls;
    item.append(chip, document.createTextNode(name));
    hands.appendChild(item);
  }
  el.appendChild(hands);
}

function wireUI() {
  $('btn-proc').addEventListener('click', startProcedural);
  $('file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]).catch((err) => setStatus('Load error: ' + err.message)); });

  $('btn-play').addEventListener('click', () => {
    state.playing = !state.playing;
    $('btn-play').textContent = state.playing ? '⏸' : '▶';
    if (state.playing && state.audioOn && !isReady()) enableAudio();
  });
  $('btn-stop').addEventListener('click', () => { resetTransport(); state.playing = false; $('btn-play').textContent = '▶'; if (state.source === 'procedural') pumpProcedural(); else applyFilter(); });

  $('btn-audio').addEventListener('click', () => { if (!state.audioOn) enableAudio(); else { state.audioOn = false; $('btn-audio').classList.remove('on'); $('btn-audio').textContent = '🔇'; } });
  $('btn-midi').addEventListener('click', enableMidi);

  $('chk-practice').addEventListener('change', (e) => {
    state.practice = e.target.checked;
    rebuildEvents();
    if (!state.practice) { state.waiting = false; state.expected.clear(); }
  });
  $('sel-hand').addEventListener('change', (e) => { state.practiceHand = e.target.value; rebuildEvents(); });

  $('sel-spell').addEventListener('change', (e) => { state.spelling = e.target.value; for (const n of state.notes) computeSpelling(n); });

  $('rng-tempo').addEventListener('input', (e) => setTempoBpm(parseFloat(e.target.value)));
  $('rng-speed').addEventListener('input', (e) => { state.visualSeconds = parseFloat(e.target.value); $('lbl-speed').textContent = `${state.visualSeconds.toFixed(1)}s`; });
  $('rng-vol').addEventListener('input', (e) => {
    const el = e.target, db = parseFloat(el.value);
    setVolume(db);
    $('lbl-vol').textContent = `${Math.round((db - +el.min) / (+el.max - +el.min) * 100)}%`;
  });
}

// keep the side panel clear of the top bar even when the bar wraps to 2 rows
function syncPanelTop() {
  const set = () => $('panel').style.top = ($('bar').offsetHeight + 12) + 'px';
  set();
  new ResizeObserver(set).observe($('bar'));
}

// ---------- boot ----------

async function boot() {
  try {
    renderer = new GLRenderer($('gl'));
    await renderer.init('./bg.glsl', './shaders/fullscreen.vert', './shaders/quad.vert', './shaders/quad.frag');
  } catch (e) {
    setStatus('WebGL2 init failed: ' + e.message);
    console.error(e);
    return;
  }

  midiInput = new MidiInput();
  midiInput.onNoteOn = (m, v) => { if (state.audioOn) play(m, 0.6, v); };
  if (!midiInput.supported) $('btn-midi').disabled = true, $('btn-midi').textContent = '🎹 No Web MIDI';

  wireUI();
  syncPanelTop();
  buildLegend();
  startProcedural();
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { });
}

boot();
