// playback.js — audio out via Tone.js (loaded from CDN as an ES module).
// The app owns the transport clock; this module just makes sound when asked.
// A Salamander piano Sampler is used if it loads, else a PolySynth fallback so
// the app still works offline / on flaky networks.

let Tone = null;
let instrument = null;
let ready = false;

const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/';

export async function initAudio() {
  if (ready) return;
  Tone = await import('https://cdn.jsdelivr.net/npm/tone@15/+esm');
  // unlock audio context (must be called from a user gesture upstream)
  await Tone.start();

  try {
    instrument = await loadSampler();
  } catch {
    instrument = new Tone.PolySynth(Tone.Synth).toDestination();
    instrument.set({ envelope: { attack: 0.005, release: 0.8 }, oscillator: { type: 'triangle' } });
  }
  ready = true;
}

function loadSampler() {
  return new Promise((resolve, reject) => {
    const s = new Tone.Sampler({
      urls: {
        A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
        A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
        A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
        A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
        A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
        A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
        A6: 'A6.mp3', C7: 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
        A7: 'A7.mp3', C8: 'C8.mp3',
      },
      release: 1,
      baseUrl: SAMPLE_BASE,
      onload: () => resolve(s),
      onerror: reject,
    }).toDestination();
    // safety timeout -> fallback
    setTimeout(() => { if (!s.loaded) reject(new Error('sampler timeout')); }, 8000);
  });
}

const midiToNote = (m) => {
  const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return N[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};

export function isReady() { return ready; }

// Fire a note now (used when a note crosses the playhead, and for live MIDI input).
export function play(midi, durSec = 0.4, vel = 0.8) {
  if (!ready || !instrument) return;
  try {
    instrument.triggerAttackRelease(midiToNote(midi), Math.max(0.05, durSec), undefined, Math.max(0.1, Math.min(1, vel)));
  } catch { /* voice steal / not loaded yet */ }
}

export function setVolume(db) {
  if (Tone) Tone.getDestination().volume.value = db;
}
