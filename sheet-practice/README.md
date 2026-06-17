# Sheet Practice

A single-page PWA for practising piano. Notes scroll horizontally across a
grand staff (piano-roll-on-staff): X = time, Y = pitch on/between the lines.
Notes are coloured by suggested finger. Play and hear them, or play along on a
MIDI keyboard with a wait-for-key mode.

Static — no build step. The app is served over HTTP from `sheet-practice/`
(relative to the repo root, so `../libs/not3.min.js` resolves).

A web server is required — ES modules and the service worker won't load from
`file://`. Audio and Web MIDI also require a user gesture / HTTPS (`localhost`
counts).

## Sources

- **🎲 Procedural** — infinite generated material from a motif engine:
  interval-weighted scale walk + 2-bar rhythm templates + chord progression +
  sectional density. Right hand = melody, left hand = bass.
- **📂 Open** — load `.mid`, `.xml`/`.musicxml`, or `.mxl`. Each track/part is
  selectable in the Parts panel, so you can show only (say) the piano and hide
  harp/drums. MusicXML honours written enharmonic spelling and any embedded
  fingerings.

## Controls

- **Play / Stop**, **Tempo** (0.25–1.5×), **Window** (seconds of music visible).
- **🔊 Audio** — Tone.js (Salamander piano sampler, synth fallback offline).
- **🎹 MIDI** — enable a Web MIDI keyboard. Pressed keys highlight at the left edge.
- **Wait-for-key** — playback pauses at each note and resumes only when the
  correct key(s) are held. Choose Both / Right / Left; the non-practised hand
  keeps playing as accompaniment.
- **Spelling** — ♯ or ♭ for generated/MIDI notes (MusicXML keeps its own).

## How notes are drawn

- Geometry is locked to `bg.glsl`: lines at `y = k·(H/30)`, treble `k=15..19`,
  middle C `k=14` (the dim line), bass `k=9..13`. One staff line = 2 diatonic
  steps, so `k = 14 + diatonicFromC4/2`. `src/staff.js` is the single source.
- A natural note fills its space (full-height quad). A **sharp** is the top half
  of that slot, a **flat** the bottom half (half-height), per the brief.
- Out-of-staff notes get ledger stubs; the shader's faint dashed lines mark
  ledger positions above/below.

## Architecture (`src/`)

| file | role |
|------|------|
| `main.js` | state machine, transport clock, UI wiring |
| `staff.js` | pitch → staff geometry, enharmonic spelling, hand split |
| `render.js` | Canvas2D overlay: note quads, playhead, feedback (lines = shader) |
| `procedural.js` | indefinite RH-melody + LH-bass generator |
| `loadMidi.js` / `loadMusicXML.js` | file → note model + part list |
| `fingering.js` | Viterbi DP fingering solver (Parncutt-style comfort cost) |
| `playback.js` | Tone.js audio out |
| `midiInput.js` | Web MIDI keyboard input |

The app owns a single `now` clock and triggers sound as notes cross the
playhead, so wait-for-key is simply "stop advancing the clock."

> **Note:** the staff *lines* are rendered by `bg.glsl` via `libs/not3.min.js`
> (WebGL2). If the shader fails to start, you'll see notes with no lines — check
> the console. Everything else (notes, audio, MIDI) is independent.
