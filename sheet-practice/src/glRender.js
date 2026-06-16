// glRender.js — single WebGL2 renderer for the whole scene.
//   Pass 1: bg.glsl fullscreen (grand-staff lines + ledger ambiance).
//   Pass 2: instanced quads — note bodies, ledger lines, playhead, MIDI feedback.
// Geometry comes from staff.js so quads land on the shader's lines. All GLSL
// lives in .glsl/.vert/.frag files; this module only loads + drives them.

import { diatonicToY, diatonicToK, noteHeight, spacing, spell } from './staff.js';

// finger -> rgb; index 1..5. Same colour for both hands — hand is shown by the
// slope of the right edge (RH = top corner pulled left, LH = bottom), not colour.
export const FINGER = ['#ff5252', '#ff9800', '#ffd600', '#69f0ae', '#40c4ff'];
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const FINGER_RGB = FINGER.map(hex);
const fingerRGB = (f) => FINGER_RGB[Math.max(1, Math.min(5, f || 3)) - 1];

const FLOATS_PER_INSTANCE = 10;  // rect(4) + color(4) + slope(2: top-right, bottom-right x-pull px)
const MAX_INSTANCES = 8192;

export class GLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: false });
    if (!this.gl) throw new Error('WebGL2 not available');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.w = canvas.clientWidth;
    this.h = canvas.clientHeight;
  }

  async init(bgFragUrl, fsVertUrl, quadVertUrl, quadFragUrl) {
    const gl = this.gl;
    const [bgFrag, fsVert, quadVert, quadFrag] = await Promise.all(
      [bgFragUrl, fsVertUrl, quadVertUrl, quadFragUrl].map((u) => fetch(u).then((r) => r.text())));

    this.bgProg = this._program(fsVert, bgFrag);
    this.quadProg = this._program(quadVert, quadFrag);
    this.uBgTime = gl.getUniformLocation(this.bgProg, 'time');
    this.uBgRes = gl.getUniformLocation(this.bgProg, 'resolution');
    this.uQuadRes = gl.getUniformLocation(this.quadProg, 'resolution');

    // unit quad (triangle strip). A per-instance slope pulls the right corners
    // left in the shader (top corner for RH, bottom for LH) so the right edge
    // becomes a diagonal; slope=0 leaves a plain rectangle.
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instBuf = gl.createBuffer();
    this.instData = new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instData.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);   // rect
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);  // color
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 32);  // slope
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    this.t0 = performance.now();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize() {
    const c = this.canvas;
    this.w = c.clientWidth; this.h = c.clientHeight;
    const dw = Math.round(this.w * this.dpr), dh = Math.round(this.h * this.dpr);
    if (c.width !== dw || c.height !== dh) { c.width = dw; c.height = dh; }
  }

  // --- instance assembly helpers (CSS-pixel space) ---
  _rect(arr, i, x, y, w, h, rgb, a, slopeTop = 0, slopeBot = 0) {
    const o = i * FLOATS_PER_INSTANCE;
    arr[o] = x; arr[o + 1] = y; arr[o + 2] = w; arr[o + 3] = h;
    arr[o + 4] = rgb[0]; arr[o + 5] = rgb[1]; arr[o + 6] = rgb[2]; arr[o + 7] = a;
    arr[o + 8] = slopeTop; arr[o + 9] = slopeBot;
    return i + 1;
  }

  render(s) {
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // pass 1: background shader (uses device-pixel resolution to match gl_FragCoord)
    gl.useProgram(this.bgProg);
    gl.uniform1f(this.uBgTime, (performance.now() - this.t0) / 1000);
    gl.uniform2f(this.uBgRes, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: quads (CSS-pixel space; normalized identically so it aligns with bg)
    const data = this.instData;
    const n = this._buildInstances(s, data);
    if (n > 0) {
      gl.useProgram(this.quadProg);
      gl.uniform2f(this.uQuadRes, this.w, this.h);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * FLOATS_PER_INSTANCE));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.bindVertexArray(null);
    }
  }

  _buildInstances(s, data) {
    const h = this.h, w = this.w;
    const sp = spacing(h);
    const nh = noteHeight(h);
    const sk = s.spelling || 'sharp';
    const playheadX = w * (s.playheadFrac ?? 0.18);
    const tMin = s.now - playheadX / s.pxPerSec;
    const tMax = s.now + (w - playheadX) / s.pxPerSec;
    const LEDGER = [0.78, 0.82, 0.86];
    let i = 0;

    for (const note of s.notes) {
      if (i >= MAX_INSTANCES - 8) break;
      if (note.start + note.dur < tMin || note.start > tMax) continue;
      const x = playheadX + (note.start - s.now) * s.pxPerSec;
      const wpx = Math.max(5, note.dur * s.pxPerSec - 2);
      const dia = note.diatonic ?? spell(note.midi, sk).diatonic;
      const yc = diatonicToY(dia, h);
      const past = note.start + note.dur < s.now;
      const a = past ? 0.4 : 1;

      // ledger lines through on/above/below-staff notes (drawn first, under the quad)
      const k = diatonicToK(dia);
      const drawLedger = (kk) => { i = this._rect(data, i, x - sp * 0.4, h - kk * sp - 1, wpx + sp * 0.8, 2, LEDGER, 0.85); };
      if (k > 19) for (let kk = 20; kk <= Math.floor(k); kk++) drawLedger(kk);
      else if (k < 9) for (let kk = 8; kk >= Math.ceil(k); kk--) drawLedger(kk);
      if (Math.round(k) === 14) drawLedger(14);

      let top, height;
      if (note.accidental === 'sharp') { top = yc - nh / 2; height = nh / 2; }
      else if (note.accidental === 'flat') { top = yc; height = nh / 2; }
      else { top = yc - nh / 2; height = nh; }
      // slope the right edge to mark the hand: RH pulls the top corner left,
      // LH the bottom corner — a full diagonal either way.
      const slope = Math.min(wpx * 0.6, height);
      const isR = note.hand !== 'L';
      i = this._rect(data, i, x, top, wpx, height, fingerRGB(note.finger), a, isR ? slope : 0, isR ? 0 : slope);
    }

    // playhead
    i = this._rect(data, i, playheadX - 1, 0, 2, h, [1, 1, 1], 0.7);

    // wait-for-key markers on the playhead
    if (s.expected && s.expected.size) {
      for (const m of s.expected) {
        if (i >= MAX_INSTANCES) break;
        const yc = diatonicToY(spell(m, sk).diatonic, h);
        const hit = s.correct && s.correct.has(m);
        i = this._rect(data, i, playheadX - 4, yc - nh / 2, 8, nh, hit ? [0.41, 0.94, 0.68] : [1, 0.32, 0.32], 0.9);
      }
    }

    // left-edge pressed-key feedback
    if (s.pressed && s.pressed.size) {
      const edge = playheadX * 0.55;
      for (const m of s.pressed) {
        if (i >= MAX_INSTANCES) break;
        const sp2 = spell(m, sk);
        const yc = diatonicToY(sp2.diatonic, h);
        i = this._rect(data, i, 2, yc - nh / 2, edge, nh, sp2.accidental ? [1, 0.67, 0.25] : [0.5, 0.85, 1], 0.9);
      }
    }

    return i;
  }

  _program(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = this._shader(gl.VERTEX_SHADER, vsSrc);
    const fs = this._shader(gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link failed: ' + gl.getProgramInfoLog(p));
    return p;
  }

  _shader(type, src) {
    const gl = this.gl;
    // GLSL ES 3.00 fragment shaders need an explicit default float precision.
    // Inject one (after #version) if the source omits it — leaves files untouched.
    if (type === gl.FRAGMENT_SHADER && !/precision\s+(low|medium|high)p\s+float/.test(src)) {
      const m = src.match(/^\s*#version[^\n]*\n/);
      src = m ? src.slice(0, m[0].length) + 'precision highp float;\n' + src.slice(m[0].length)
              : 'precision highp float;\n' + src;
    }
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  }
}
