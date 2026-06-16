// midiInput.js — Web MIDI keyboard input. Tracks currently-held notes and
// emits note on/off so main.js can drive wait-for-key, audio, and left-edge
// visual feedback. Matching logic lives in main; this is just transport.

export class MidiInput {
  constructor() {
    this.pressed = new Set();        // midi numbers currently down
    this.access = null;
    this.onNoteOn = null;            // (midi, velocity)
    this.onNoteOff = null;          // (midi)
    this.onStateChange = null;       // (inputsArray)
    this.supported = !!navigator.requestMIDIAccess;
  }

  async enable() {
    if (!this.supported) throw new Error('Web MIDI not supported in this browser');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this._bindInputs();
    this._bindInputs();
    return this.inputs();
  }

  inputs() {
    return this.access ? [...this.access.inputs.values()] : [];
  }

  _bindInputs() {
    for (const input of this.inputs()) input.onmidimessage = (e) => this._onMessage(e);
    this.onStateChange?.(this.inputs());
  }

  _onMessage(e) {
    const [status, data1, data2] = e.data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && data2 > 0) {
      this.pressed.add(data1);
      this.onNoteOn?.(data1, data2 / 127);
    } else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
      this.pressed.delete(data1);
      this.onNoteOff?.(data1);
    }
  }
}
