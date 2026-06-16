// loadMidi.js — parse a .mid file into the app's note model + a track list.
// Uses @tonejs/midi from CDN. Each track becomes a selectable "part".

import { Midi } from 'https://cdn.jsdelivr.net/npm/@tonejs/midi@2.0.28/+esm';

const LEFT_HINT = /(left|bass|l\.h\.?|lh)\b/i;
const RIGHT_HINT = /(right|treble|r\.h\.?|rh|melody|lead)\b/i;

export async function loadMidiFile(arrayBuffer) {
  const midi = new Midi(arrayBuffer);
  const parts = [];
  const notes = [];

  midi.tracks.forEach((track, i) => {
    if (!track.notes.length) return;
    const name = track.name || track.instrument?.name || `Track ${i + 1}`;
    const isDrum = track.instrument?.percussion || track.channel === 9;
    let hand = null;
    if (LEFT_HINT.test(name)) hand = 'L';
    else if (RIGHT_HINT.test(name)) hand = 'R';

    parts.push({ id: `t${i}`, name, count: track.notes.length, isDrum, default: !isDrum });

    for (const n of track.notes) {
      notes.push({
        start: n.time,
        dur: n.duration,
        midi: n.midi,
        vel: n.velocity,
        part: `t${i}`,
        hand, // may be null -> fingering will split by pitch
      });
    }
  });

  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const bpm = midi.header.tempos[0]?.bpm || 120;
  return { notes, parts, bpm, duration: midi.duration };
}
