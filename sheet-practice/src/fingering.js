// fingering.js — piano fingering solver.
// Per hand, an optimal finger assignment over the note sequence is found by
// Viterbi DP minimising a Parncutt-style comfort cost: stretch vs. the
// comfortable span of each finger pair, crossing penalties (cheap through the
// thumb, expensive otherwise), thumb-on-black penalties, and same-finger
// shifts. Chords (same onset) force distinct fingers ordered by pitch.
//
// Public: assignFingers(notes, { split }) -> mutates note.finger (1..5) & note.hand.
// Cost is O(n·25); cheap to re-run on a window for the procedural stream.

import { defaultHand } from './staff.js';

const INF = 1e9;
const FINGERS = [1, 2, 3, 4, 5];
const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (p) => BLACK.has(((p % 12) + 12) % 12);

// Comfortable semitone distance between ADJACENT fingers (relaxed/min/max).
const ADJ = {
  '1-2': { min: 1, comf: 5, max: 10 },
  '2-3': { min: 1, comf: 4, max: 6 },
  '3-4': { min: 1, comf: 3, max: 5 },
  '4-5': { min: 1, comf: 4, max: 6 },
};

function pairSpan(a, b) {
  // a<b: sum across adjacent gaps
  let min = 0, comf = 0, max = 0;
  for (let f = a; f < b; f++) {
    const g = ADJ[`${f}-${f + 1}`];
    min += g.min; comf += g.comf; max += g.max;
  }
  return { min, comf, max };
}

function stretchCost(f1, f2, absIv, simul) {
  if (f1 === f2) return 0;
  const { min, comf, max } = pairSpan(Math.min(f1, f2), Math.max(f1, f2));
  if (absIv < min) return (simul ? 3 : 1.0) * (min - absIv);
  if (absIv > max) return (simul ? 3.5 : 1.4) * (absIv - max);
  return 0.1 * Math.abs(absIv - comf);
}

function unaryCost(pitch, f) {
  let c = 0;
  if (isBlack(pitch)) {
    if (f === 1) c += 2.5;        // thumb on black key: avoid
    else if (f === 5) c += 1.2;   // pinky on black: mild
  }
  return c;
}

// transition cost from (p1,f1) to (p2,f2). sameOnset => chord member.
function transCost(p1, f1, p2, f2, hand, sameOnset) {
  if (sameOnset) {
    if (f1 === f2) return INF;
    const wantHigherFinger = hand === 'R' ? p2 > p1 : p2 < p1;
    let c = (wantHigherFinger === f2 > f1) ? 0 : 8;
    c += stretchCost(f1, f2, Math.abs(p2 - p1), true);
    return c;
  }
  if (p2 === p1) return f1 === f2 ? 0 : 1.5;

  const iv = hand === 'R' ? p2 - p1 : p1 - p2; // mirror LH so logic is "ascending=positive"
  const df = f2 - f1;
  let c = 0;
  const sIv = Math.sign(iv), sDf = Math.sign(df);
  if (sDf !== 0 && sIv !== 0 && sDf !== sIv) {
    c += (f1 === 1 || f2 === 1) ? 1.5 : 7; // thumb pass cheap, other crossings awkward
  }
  if (sDf === 0) c += 2 + 0.4 * Math.abs(iv); // same finger, different pitch = shift
  c += stretchCost(f1, f2, Math.abs(iv), false);
  c += 0.05 * Math.abs(iv);                   // keep the hand compact
  return c;
}

function solveHand(seq, hand) {
  // seq: notes sorted by (start, pitch). Mutates .finger.
  const n = seq.length;
  if (!n) return;
  const eps = 0.02;
  const sameOnset = (i) => i > 0 && Math.abs(seq[i].start - seq[i - 1].start) < eps;

  // DP tables
  const cost = Array.from({ length: n }, () => new Array(6).fill(INF));
  const back = Array.from({ length: n }, () => new Array(6).fill(0));

  for (const f of FINGERS) cost[0][f] = unaryCost(seq[0].midi, f);

  for (let i = 1; i < n; i++) {
    const so = sameOnset(i);
    for (const f of FINGERS) {
      const u = unaryCost(seq[i].midi, f);
      let best = INF, bf = 1;
      for (const pf of FINGERS) {
        if (cost[i - 1][pf] >= INF) continue;
        const t = transCost(seq[i - 1].midi, pf, seq[i].midi, f, hand, so);
        if (t >= INF) continue;
        const c = cost[i - 1][pf] + t + u;
        if (c < best) { best = c; bf = pf; }
      }
      cost[i][f] = best;
      back[i][f] = bf;
    }
  }

  // backtrack from cheapest final finger
  let f = 1, best = INF;
  for (const ff of FINGERS) if (cost[n - 1][ff] < best) { best = cost[n - 1][ff]; f = ff; }
  for (let i = n - 1; i >= 0; i--) {
    seq[i].finger = f;
    f = back[i][f];
  }

  // repair: distinct fingers inside each onset group (3+ note chords)
  let g0 = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || Math.abs(seq[i].start - seq[g0].start) >= eps) {
      repairChord(seq.slice(g0, i), hand);
      g0 = i;
    }
  }
}

function repairChord(group, hand) {
  if (group.length < 2) return;
  const order = group.map((_, i) => i).sort((a, b) =>
    hand === 'R' ? group[a].midi - group[b].midi : group[b].midi - group[a].midi);
  const used = new Set();
  let next = 1;
  for (const idx of order) {
    let f = group[idx].finger;
    if (used.has(f)) {
      while (next <= 5 && used.has(next)) next++;
      f = Math.min(5, next);
    }
    used.add(f);
    group[idx].finger = f;
    next = Math.max(next, f + 1);
  }
}

/**
 * Assign fingers to every note. Honours note.hand if present; otherwise splits
 * by pitch around `split` (default middle C). Notes are mutated in place.
 */
export function assignFingers(notes, { split = 60 } = {}) {
  for (const n of notes) if (!n.hand) n.hand = defaultHand(n.midi, split);
  for (const hand of ['R', 'L']) {
    const seq = notes.filter((n) => n.hand === hand)
      .sort((a, b) => a.start - b.start || a.midi - b.midi);
    solveHand(seq, hand);
  }
  return notes;
}
