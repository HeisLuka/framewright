#!/usr/bin/env node
// Procedural soundtrack template. Everything is synthesized in place: no samples, no libraries.
//   node audio.mjs track.wav
// How to use:
//   1. Run `node scripts/look.mjs info` and copy the plate start times (seconds) into T below.
//   2. Write one block of events per plate (see the demo block and references/audio.md).
//   3. Render, look at the waveform:  ffmpeg -i track.wav -filter_complex "showwavespic=s=1800x300:split_channels=1" -frames:v 1 shots/wave.png
import fs from 'node:fs';

const SR = 44100, OUT = process.argv[2] || 'track.wav';
const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4;
// plate starts in seconds. Must mirror the plates in index.html (check with look.mjs info).
const T = { title: 0, end: 4 };

const N = Math.round(T.end * SR), L = new Float32Array(N), Rr = new Float32Array(N);
let seed = 20260101; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; const g2 = () => rnd() * 2 - 1;
const midi = m => 440 * Math.pow(2, (m - 69) / 12);

/* ---------- building blocks ---------- */
// mix a buffer into the master at time t0 with constant-power pan (-1..1)
function add(t0, arr, pan = 0, gain = 1) {
  const s0 = Math.round(t0 * SR), gl = Math.cos((pan + 1) * Math.PI / 4) * gain, gr = Math.sin((pan + 1) * Math.PI / 4) * gain;
  for (let i = 0; i < arr.length; i++) { const k = s0 + i; if (k < 0 || k >= N) continue; L[k] += arr[i] * gl; Rr[k] += arr[i] * gr; }
}
function lp(arr, fc) { const a = 1 - Math.exp(-2 * Math.PI * fc / SR); let y = 0; const o = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) { y += a * (arr[i] - y); o[i] = y; } return o; }
function hp(arr, fc) { const l = lp(arr, fc); const o = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) o[i] = arr[i] - l[i]; return o; }
// envelope: linear attack, hold, linear release; optional exponential decay
function shape(arr, { att = 0.005, rel = 0.02, decay = 0, hold = 1 } = {}) {
  const n = arr.length, o = new Float32Array(n), A = att * SR, Rl = rel * SR;
  for (let i = 0; i < n; i++) { let e = hold; if (i < A) e *= i / A; if (i > n - Rl) e *= (n - i) / Rl; if (decay > 0) e *= Math.exp(-i / SR / decay); o[i] = arr[i] * e; }
  return o;
}
// oscillator with exponential glide f0 -> f1, optional vibrato and noise
function osc(dur, f0, { f1 = f0, wave = 'sine', amp = 0.2, vib = 0, vibHz = 5, noiseAmt = 0 } = {}) {
  const n = Math.round(dur * SR), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n, f = f0 * Math.pow(f1 / f0, t) * (1 + vib * Math.sin(2 * Math.PI * vibHz * i / SR)); ph += f / SR; const x = ph % 1;
    const v = wave === 'sine' ? Math.sin(2 * Math.PI * x) : wave === 'saw' ? 2 * x - 1 : wave === 'square' ? (x < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(x - 0.5);
    o[i] = v * amp + (noiseAmt ? g2() * noiseAmt : 0);
  }
  return o;
}
function noise(dur, { amp = 0.2, lpf = 0, hpf = 0 } = {}) { const n = Math.round(dur * SR); let o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = g2() * amp; if (lpf) o = lp(o, lpf); if (hpf) o = hp(o, hpf); return o; }
function mul(arr, fn) { const o = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) o[i] = arr[i] * fn(i / SR); return o; }

/* ---------- instruments ---------- */
const kick = (t, amp = 0.55) => { add(t, shape(osc(0.32, 150, { f1: 42, amp }), { att: 0.001, decay: 0.11, rel: 0.01 })); add(t, shape(noise(0.02, { amp: 0.25, lpf: 4000 }), { att: 0.0005, decay: 0.006 })); };
const hat = (t, amp = 0.10, open = false) => add(t, shape(noise(open ? 0.25 : 0.06, { amp, hpf: 7000 }), { att: 0.001, decay: open ? 0.09 : 0.02 }), 0.25);
const rim = (t, amp = 0.22) => { add(t, shape(noise(0.08, { amp: amp * 0.8, hpf: 1500, lpf: 6000 }), { att: 0.001, decay: 0.03 }), -0.2); add(t, shape(osc(0.06, 420, { f1: 380, amp: amp * 0.5 }), { att: 0.001, decay: 0.02 }), -0.2); };
const click = (t, amp = 0.3) => add(t, shape(noise(0.006, { amp }), { att: 0.0003, decay: 0.002 }));
const beep = (t, f, dur, amp = 0.22, wave = 'sine') => add(t, shape(osc(dur, f, { amp, wave }), { att: 0.004, rel: 0.03 }));
// detuned saw pad through a low-pass; notes are MIDI numbers
const chord = (t, notes, dur, amp = 0.08, wave = 'saw', cut = 1800, det = 0.004) => { for (const m of notes) for (const d of [-det, det]) add(t, shape(lp(osc(dur, midi(m) * (1 + d), { amp, wave }), cut), { att: Math.min(0.6, dur * 0.3), rel: Math.min(0.8, dur * 0.4) }), d > 0 ? 0.35 : -0.35); };
// "data" chirp: a burst of short square tones, good for text appearing
const chirp = (t, amp = 0.10) => { let tt = t; for (let i = 0; i < 12; i++) { add(tt, shape(osc(0.022, 1200 + rnd() * 1400, { amp, wave: 'square' }), { att: 0.002, rel: 0.004 })); tt += 0.026; } };
// riser: filtered noise swelling into the next cut
const riser = (t, dur = 1.0, amp = 0.14) => add(t, mul(shape(noise(dur, { amp, hpf: 600 }), { att: dur * 0.3, rel: 0.02 }), x => (x / dur) * (x / dur)));

/* ---------- events, one block per plate ---------- */
// demo for the skeleton's title plate: a click, a soft pad, a tick on every beat, a short riser into the end
click(T.title, 0.5);
chord(T.title + 0.1, [57, 64, 69, 76], T.end - 0.4, 0.05, 'saw', 1400);
for (let t = T.title; t < T.end - 0.5; t += BEAT) beep(t, 1760, 0.03, 0.08);
riser(T.end - 1.0, 1.0, 0.10);

/* ---------- master: soft limiter, normalize to -1 dBFS, 16-bit stereo WAV ---------- */
let peak = 0; for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.3); Rr[i] = Math.tanh(Rr[i] * 1.3); peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i])); }
const norm = peak > 0 ? 0.89 / peak : 1, buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * norm * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Rr[i] * norm * 32767), 46 + i * 4); }
fs.writeFileSync(OUT, buf);
console.log(`${OUT}: ${T.end} s, peak before normalization ${peak.toFixed(2)}`);
