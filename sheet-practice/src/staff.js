// staff.js — grand-staff geometry, locked to bg.glsl's line layout.
//
// bg.glsl draws horizontal lines at gl_FragCoord.y = k * spacing, spacing = H/30.
// Solid staff lines: treble k=15..19, bass k=9..13, with the dim line k=14 = middle C (C4).
// Higher pitch = larger gl-y = smaller canvas-y (top-left origin).
//
//   one staff line spans 2 diatonic steps  ->  k = 14 + diatonicFromC4 / 2
//   canvas y = H - k * (H/30)
//
// Everything that places a note vertically goes through pitchToY() so it stays
// pixel-aligned with the shader.

export const MIDDLE_C = 60; // C4

// diatonic degree (0=C .. 6=B) and whether the pitch class is "black" (altered)
const PC_DEGREE = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const SHARP_BASE = { 1: 0, 3: 2, 6: 5, 8: 7, 10: 9 };  // C#->C, D#->D, F#->F, G#->G, A#->A
const FLAT_BASE  = { 1: 2, 3: 4, 6: 7, 8: 9, 10: 11 }; // Db->D, Eb->E, Gb->G, Ab->A, Bb->B

// Number of diatonic steps from C4 for a *natural* pitch class at a given octave.
function diatonicFromC4Natural(pc, octaveNum) {
  return (octaveNum - 4) * 7 + PC_DEGREE[pc];
}

/**
 * Resolve a MIDI pitch to staff placement.
 * @param {number} midi
 * @param {('sharp'|'flat')} spelling - how to spell black keys (key-signature driven)
 * @returns {{ diatonic:number, accidental:(null|'sharp'|'flat'), pc:number, octave:number }}
 */
export function spell(midi, spelling = 'sharp') {
  const pc = ((midi % 12) + 12) % 12;
  const octaveNum = Math.floor(midi / 12) - 1;
  if (pc in PC_DEGREE) {
    return { diatonic: diatonicFromC4Natural(pc, octaveNum), accidental: null, pc, octave: octaveNum };
  }
  // altered pitch: spell relative to a natural base
  if (spelling === 'flat') {
    const base = FLAT_BASE[pc];
    // flat base may belong to the next octave up (e.g. B in some spellings) — handle via real octave of base note
    const baseMidi = midi + 1;
    const bOct = Math.floor(baseMidi / 12) - 1;
    return { diatonic: diatonicFromC4Natural(base, bOct), accidental: 'flat', pc, octave: octaveNum };
  } else {
    const base = SHARP_BASE[pc];
    const baseMidi = midi - 1;
    const bOct = Math.floor(baseMidi / 12) - 1;
    return { diatonic: diatonicFromC4Natural(base, bOct), accidental: 'sharp', pc, octave: octaveNum };
  }
}

// --- geometry ---------------------------------------------------------------

export function spacing(height) { return height / 30; }

// line index k for a diatonic offset from C4
export function diatonicToK(diatonic) { return 14 + diatonic / 2; }

// canvas-y (top-left) of a diatonic offset from C4
export function diatonicToY(diatonic, height) {
  return height - diatonicToK(diatonic) * spacing(height);
}

// canvas-y center of a MIDI note's head
export function pitchToY(midi, height, spelling = 'sharp') {
  return diatonicToY(spell(midi, spelling).diatonic, height);
}

// One diatonic step = spacing/2 (a staff line spans 2 diatonic steps). A note
// must be at most that tall or stepwise pitches overlap vertically. Use a hair
// under so even adjacent steps keep a gap. Accidentals are half this tall and
// centred a half-step (sp/4) off the natural — sharp above, flat below.
export function noteHeight(height) { return spacing(height) * 0.46; }

// Hand split for fallback colouring / fingering when source has no part info.
// C4 and above -> right hand, below -> left hand (overridable per-part).
export function defaultHand(midi) { return midi >= MIDDLE_C ? 'R' : 'L'; }

// Vertical y-range that the on-screen staff+ledger area occupies, for culling.
export function staffBounds(height) {
  return { top: 0, bottom: height };
}
