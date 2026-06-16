// procedural.js — indefinite practice material.
// Port of gen2.py's motif engine: interval-weighted scale walk + 2-bar rhythm
// templates + chord progression + sectional density gating. Generates blocks of
// 16 bars on demand so the stream never ends.
//
// Output notes: { start, dur, midi, hand, vel }  (times in seconds)
//   hand 'R' = lead/melody, 'L' = pad/bass.

const SCALE = [0, 2, 4, 5, 7, 9, 11];            // major-scale pattern
const KEY_ROOT = 62;                              // D4 -> D major (F#, C# accidentals)
const INTERVAL_WEIGHTS = [0.10, 0.30, 0.20, 0.15, 0.15, 0.025, 0.025, 0.05];
// chord intervals are relative to the key root, so the progression rides the key
const CHORDS = [
  [0, 4, 7, 11],   // Dmaj7
  [9, 0, 4, 7],    // Bm7
  [5, 9, 12, 16],  // Gmaj7
  [7, 11, 14, 17], // A7
];

// deterministic RNG (mulberry32) so a seed reproduces a session
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cumulative(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  return weights.map((w) => (acc += w / total));
}
const INTERVAL_CUM = cumulative(INTERVAL_WEIGHTS);

const RHYTHMS_SPACIOUS = [
  [[0, 2], [2, 2], [4, 2], [6, 2]],
  [[0, 3], [4, 2], [6, 2]],
  [[0, 2], [2, 2], [4, 4]],
  [[0, 2], [4, 1.5], [5.5, 0.5], [6, 2]],
  [[0, 1.5], [1.5, 0.5], [2, 2], [4, 2], [6, 2]],
  [[0, 2], [2, 2], [4, 2], [6, 1.5], [7.5, 0.5]],
];
const RHYTHMS_MEDIUM = [
  [[0, 1], [1, 1], [2, 2], [4, 1.5], [5.5, 0.5], [6, 2]],
  [[0, 1.5], [1.5, 0.5], [2, 2], [4, 1.5], [5.5, 0.5], [6, 2]],
  [[0, 2], [2, 1.5], [3.5, 2.5], [6, 2]],
  [[0.5, 1.5], [2, 2], [4.5, 1.5], [6, 2]],
  [[0, 2], [2, 2], [4, 1], [5, 1], [6, 2]],
  [[0, 1], [1, 1], [2, 1], [3, 1], [4, 4]],
];

export class ProceduralSource {
  constructor({ seed = 1, bpm = 82, octaveShift = 0 } = {}) {
    this.bpm = bpm;
    this.octaveShift = octaveShift;
    this.rand = rng(seed || 1);
    this.beatSec = 60 / bpm;
    this.barsPerBlock = 16;
    this.blocksGenerated = 0;
    this.notes = [];
    this._motifA = this._makeMotif();
    this._motifB = this._makeMotif();
  }

  // --- public: extend the stream so it covers up to tSec seconds ---
  ensureUntil(tSec) {
    const blockSec = this.barsPerBlock * 4 * this.beatSec;
    while (this.blocksGenerated * blockSec < tSec + blockSec) {
      this._genBlock(this.blocksGenerated);
      this.blocksGenerated++;
    }
    return this.notes;
  }

  // --- internals ---
  _r() { return this.rand(); }
  _randint(a, b) { return a + Math.floor(this._r() * (b - a + 1)); }
  _uniform(a, b) { return a + this._r() * (b - a); }
  _choice(arr) { return arr[Math.floor(this._r() * arr.length)]; }

  _pickIntervalDistance(maxDist) {
    const r = this._r();
    for (let i = 0; i < Math.min(maxDist, INTERVAL_CUM.length); i++) {
      if (r <= INTERVAL_CUM[i]) return i;
    }
    return maxDist - 1;
  }

  _scalePosToNote(scalePos, octaveShift) {
    let octaveOffset = Math.floor(scalePos / SCALE.length);
    const idx = ((scalePos % SCALE.length) + SCALE.length) % SCALE.length;
    octaveOffset = Math.max(-1, Math.min(1, octaveOffset));
    return KEY_ROOT + octaveOffset * 12 + SCALE[idx] + octaveShift;
  }

  _chordTonePositions(chordIdx) {
    const out = new Set();
    for (const interval of CHORDS[chordIdx]) {
      const pc = ((interval % 12) + 12) % 12;
      for (let i = 0; i < SCALE.length; i++) {
        if (SCALE[i] === pc) { out.add(i); break; }
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  _makeMotif(beats = 8) {
    const pool = this._r() < 0.7 ? RHYTHMS_SPACIOUS : RHYTHMS_MEDIUM;
    let template = this._choice(pool).filter(([t]) => t < beats);
    const motif = [];
    let pos = 0;
    template.forEach(([t, d], i) => {
      if (i === 0) pos = 0;
      else {
        const dist = this._pickIntervalDistance(5);
        let dir;
        if (pos >= 3) dir = -1;
        else if (pos <= -3) dir = 1;
        else dir = this._r() < 0.5 ? -1 : 1;
        pos = Math.max(-4, Math.min(4, pos + dist * dir));
      }
      motif.push([t, pos, Math.min(d, beats - t)]);
    });
    if (!motif.length) motif.push([0, 0, 2]);
    return motif;
  }

  _varyMotif(motif, kind) {
    switch (kind) {
      case 'transpose+2': return motif.map(([t, p, d]) => [t, p + 2, d]);
      case 'transpose-2': return motif.map(([t, p, d]) => [t, p - 2, d]);
      case 'invert': return motif.map(([t, p, d]) => [t, -p, d]);
      case 'tail_extend': {
        if (!motif.length) return [...motif];
        const out = motif.slice(0, -1);
        const [lt, lp, ld] = motif[motif.length - 1];
        out.push([lt, lp, ld + 0.5]);
        return out;
      }
      case 'thin': {
        const out = motif.length ? [motif[0]] : [];
        for (const ev of motif.slice(1)) if (this._r() > 0.3) out.push(ev);
        return out;
      }
      default: return [...motif];
    }
  }

  // Section plan (8 chunks of 2 bars) — identical structure to gen2.py
  static SECTION_PLAN = [
    ['a', 'same', 'normal'],
    ['a', 'transpose+2', 'normal'],
    ['b', 'same', 'rest'],
    ['a', 'tail_extend', 'peak'],
    ['a', 'same', 'sustain'],
    ['b', 'invert', 'normal'],
    ['a', 'transpose-2', 'rest'],
    ['a', 'tail_extend', 'peak'],
  ];

  _genBlock(blockIndex) {
    const blockStartSec = blockIndex * this.barsPerBlock * 4 * this.beatSec;
    this._padLayer(blockStartSec);
    this._melody(blockStartSec);
  }

  _padLayer(blockStartSec) {
    const os = this.octaveShift - 12; // bass register, LH
    for (let bar = 0; bar < this.barsPerBlock; bar++) {
      const chordIdx = Math.floor(bar / 2) % CHORDS.length;
      const root = KEY_ROOT + CHORDS[chordIdx][0] + os;
      const t = blockStartSec + bar * 4 * this.beatSec;
      this._push(t, 2.8 * this.beatSec, root, 'L', 62);
      const second = this._r() < 0.55 ? root + 7 : root + 12;
      this._push(t + 2 * this.beatSec, 2.4 * this.beatSec, second, 'L', 56);
      if (this._r() < 0.15) this._push(t + 3 * this.beatSec, 0.7 * this.beatSec, root + 12, 'L', 48);
    }
  }

  _melody(blockStartSec) {
    const vNormal = [70, 86], vPeak = [94, 110], vSustain = [58, 70];
    const chunks = this.barsPerBlock / 2;
    const planLen = ProceduralSource.SECTION_PLAN.length;
    let lastAnchor = null;
    // regenerate motifs at each block so long sessions don't loop verbatim
    if (blockStartSec > 0) { this._motifA = this._makeMotif(); this._motifB = this._makeMotif(); }

    for (let chunkIdx = 0; chunkIdx < chunks; chunkIdx++) {
      const [motifId, variation, role] = ProceduralSource.SECTION_PLAN[chunkIdx % planLen];
      const chordIdx = chunkIdx % CHORDS.length;
      const chordTones = this._chordTonePositions(chordIdx);

      const phrasePos = chunkIdx % 4;
      const mid = Math.floor(chordTones.length / 2);
      let zone;
      if (phrasePos === 0) zone = chordTones.slice(Math.max(0, mid - 1), mid + 1);
      else if (phrasePos === 1) zone = chordTones.slice(mid);
      else if (phrasePos === 2) zone = chordTones;
      else zone = chordTones.slice(0, mid + 1);
      if (!zone.length) zone = chordTones;

      let anchor;
      if (lastAnchor === null) anchor = zone[Math.floor(zone.length / 2)];
      else anchor = zone.reduce((best, c) => Math.abs(c - lastAnchor) < Math.abs(best - lastAnchor) ? c : best, zone[0]);
      lastAnchor = anchor;

      const chunkStart = blockStartSec + chunkIdx * 2 * 4 * this.beatSec;

      if (role === 'rest') continue;
      if (role === 'sustain') {
        const sustainPos = this._r() < 0.6 ? anchor : 0;
        const note = this._scalePosToNote(sustainPos, this.octaveShift);
        this._push(chunkStart + 0.05 * this.beatSec, 7.4 * this.beatSec, note, 'R', this._randint(...vSustain));
        continue;
      }

      let motif = this._varyMotif(motifId === 'a' ? this._motifA : this._motifB, variation);
      if (phrasePos === 3 && motif.length) {
        const [lt, , ld] = motif[motif.length - 1];
        motif = motif.slice(0, -1).concat([[lt, -anchor, Math.max(ld, 3)]]);
      }
      const vr = role === 'peak' ? vPeak : vNormal;
      for (const [beatOff, relPos, dur] of motif) {
        const note = this._scalePosToNote(anchor + relPos, this.octaveShift);
        const jitter = this._r() < 0.7 ? this._uniform(-0.03, 0.04) : 0;
        this._push(chunkStart + (beatOff + jitter) * this.beatSec, dur * this.beatSec, note, 'R', this._randint(...vr));
      }
    }
  }

  _push(start, dur, midi, hand, vel) {
    this.notes.push({ start, dur, midi, hand, vel });
  }
}
