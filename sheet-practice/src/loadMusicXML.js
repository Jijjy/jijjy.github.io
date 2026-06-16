// loadMusicXML.js — parse MusicXML (.xml/.musicxml or zipped .mxl) into the
// app's note model. Honours written step/octave/alter (so enharmonics display
// correctly), explicit <fingering>, per-part names, and staff -> hand mapping
// (staff 1 = right, staff 2 = left). Walks divisions + tempo to absolute seconds.

import { unzipSync, strFromU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEP_DEG = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

export async function loadMusicXMLFile(arrayBuffer, filename = '') {
  const xmlText = await extractXml(arrayBuffer, filename);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid MusicXML');
  return parseScore(doc);
}

async function extractXml(buf, filename) {
  const bytes = new Uint8Array(buf);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  if (!isZip && !/\.mxl$/i.test(filename)) return new TextDecoder().decode(bytes);

  const files = unzipSync(bytes);
  // META-INF/container.xml -> rootfile full-path
  const container = files['META-INF/container.xml'];
  let rootPath = null;
  if (container) {
    const cdoc = new DOMParser().parseFromString(strFromU8(container), 'application/xml');
    rootPath = cdoc.querySelector('rootfile')?.getAttribute('full-path');
  }
  if (rootPath && files[rootPath]) return strFromU8(files[rootPath]);
  // fallback: first non-META .xml
  const key = Object.keys(files).find((k) => /\.(xml|musicxml)$/i.test(k) && !k.startsWith('META-INF'));
  if (!key) throw new Error('No score in .mxl');
  return strFromU8(files[key]);
}

function diatonicFromStepOctave(step, octave) {
  // diatonic steps from C4
  return (octave - 4) * 7 + STEP_DEG[step];
}

function parseScore(doc) {
  const partNames = {};
  doc.querySelectorAll('part-list > score-part').forEach((sp) => {
    partNames[sp.getAttribute('id')] = sp.querySelector('part-name')?.textContent?.trim() || sp.getAttribute('id');
  });

  const notes = [];
  const parts = [];
  let firstTempo = 120;

  doc.querySelectorAll('part').forEach((part) => {
    const id = part.getAttribute('id');
    const name = partNames[id] || id;
    parts.push({ id, name, count: 0, default: true });

    let divisions = 1;
    let bpm = firstTempo;
    let secPerDiv = 60 / (bpm * divisions);
    let cursor = 0;       // absolute seconds
    let lastOnset = 0;    // for <chord/>

    const measures = part.querySelectorAll('measure');
    measures.forEach((measure) => {
      for (const el of measure.children) {
        const tag = el.tagName;
        if (tag === 'attributes') {
          const d = el.querySelector('divisions');
          if (d) { divisions = parseInt(d.textContent, 10) || divisions; secPerDiv = 60 / (bpm * divisions); }
        } else if (tag === 'direction' || tag === 'sound') {
          const sound = tag === 'sound' ? el : el.querySelector('sound');
          const tempo = sound?.getAttribute('tempo');
          if (tempo) { bpm = parseFloat(tempo); secPerDiv = 60 / (bpm * divisions); if (notes.length === 0) firstTempo = bpm; }
        } else if (tag === 'backup') {
          cursor -= (parseInt(el.querySelector('duration')?.textContent, 10) || 0) * secPerDiv;
        } else if (tag === 'forward') {
          cursor += (parseInt(el.querySelector('duration')?.textContent, 10) || 0) * secPerDiv;
        } else if (tag === 'note') {
          const durDiv = parseInt(el.querySelector('duration')?.textContent, 10) || 0;
          const durSec = durDiv * secPerDiv;
          const isChord = !!el.querySelector('chord');
          const isRest = !!el.querySelector('rest');
          const onset = isChord ? lastOnset : cursor;

          if (!isRest) {
            const pitch = el.querySelector('pitch');
            if (pitch) {
              const step = pitch.querySelector('step')?.textContent?.trim();
              const octave = parseInt(pitch.querySelector('octave')?.textContent, 10);
              const alter = parseInt(pitch.querySelector('alter')?.textContent, 10) || 0;
              const midi = (octave + 1) * 12 + STEP[step] + alter;
              const staff = parseInt(el.querySelector('staff')?.textContent, 10) || 1;
              const fingerEl = el.querySelector('notations technical fingering');
              const finger = fingerEl ? parseInt(fingerEl.textContent, 10) : undefined;
              notes.push({
                start: onset,
                dur: Math.max(0.05, durSec),
                midi,
                vel: 0.8,
                part: id,
                hand: staff >= 2 ? 'L' : 'R',
                finger: Number.isFinite(finger) ? finger : undefined,
                diatonic: diatonicFromStepOctave(step, octave),
                accidental: alter > 0 ? 'sharp' : alter < 0 ? 'flat' : null,
              });
            }
          }
          lastOnset = onset;
          if (!isChord) cursor += durSec;
        }
      }
    });
  });

  // part note counts
  for (const p of parts) p.count = notes.filter((n) => n.part === p.id).length;

  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { notes, parts, bpm: firstTempo, duration: notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0) };
}
