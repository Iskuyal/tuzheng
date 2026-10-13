// Original, deterministic electronic score. No samples or third-party recordings.
import { writeFileSync } from 'node:fs';

export function writeScore(destination, duration = 90) {
  const rate = 48000;
  const count = Math.round(duration * rate);
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  const beat = 60 / 96;
  const bar = beat * 4;
  const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
  let seed = 20261012;
  const noise = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 0xffffffff * 2 - 1;
  };

  function add(start, length, gain, pan, voice) {
    const first = Math.max(0, Math.floor(start * rate));
    const last = Math.min(count, Math.floor((start + length) * rate));
    const gl = Math.cos((pan + 1) * Math.PI / 4) * gain;
    const gr = Math.sin((pan + 1) * Math.PI / 4) * gain;
    for (let i = first; i < last; i++) {
      const time = (i - first) / rate;
      const value = voice(time, length);
      left[i] += value * gl;
      right[i] += value * gr;
    }
  }

  // Dm9, Bbmaj9, Fmaj9, Cadd9: quiet, open harmony; changing every four bars.
  const chords = [[50, 57, 60, 64, 65], [46, 53, 57, 60, 62], [41, 48, 52, 55, 57], [48, 55, 60, 62, 64]];
  for (let measure = 0; measure < 36; measure += 4) {
    const chord = chords[(measure / 4) % chords.length];
    const start = measure * bar;
    chord.forEach((note, n) => {
      const hz = frequency(note);
      add(start, bar * 4 + 0.65, 0.037, (n - 2) * 0.3, (t, length) => {
        const attack = Math.min(1, t / 0.65);
        const release = Math.min(1, (length - t) / 0.9);
        const drift = 0.006 * Math.sin(t * 0.8 + n);
        const body = Math.sin(2 * Math.PI * hz * t + drift)
          + 0.24 * Math.sin(2 * Math.PI * hz * 2.002 * t)
          + 0.10 * Math.sin(2 * Math.PI * hz * 3 * t);
        return body * attack * release * (0.91 + 0.09 * Math.sin(t * 1.2));
      });
    });
  }

  const arp = [0, 2, 3, 1, 4, 3, 2, 1];
  for (let measure = 0; measure < 36; measure++) {
    const chord = chords[Math.floor(measure / 4) % chords.length];
    for (let step = 0; step < 8; step++) {
      if (measure < 4 && step % 2) continue;
      const at = measure * bar + step * beat / 2;
      const hz = frequency(chord[arp[step]] + 12);
      add(at, 1.25, measure < 4 ? 0.055 : 0.075, Math.sin(step * 1.2) * 0.55, (t, length) => {
        const attack = Math.min(1, t / 0.008);
        const tail = Math.min(1, (length - t) / 0.1);
        return (Math.sin(2 * Math.PI * hz * t)
          + 0.38 * Math.sin(2 * Math.PI * hz * 2 * t) * Math.exp(-t * 8)
          + 0.13 * Math.sin(2 * Math.PI * hz * 4 * t) * Math.exp(-t * 13))
          * Math.exp(-t * 4.7) * attack * tail;
      });
    }
    if (measure >= 4 && measure < 34) {
      const bassHz = frequency(chord[0] - 12);
      for (const step of [0, 2]) {
        add(measure * bar + step * beat, 1.2, 0.125, 0, (t) =>
          Math.sin(2 * Math.PI * bassHz * t) * Math.min(1, t / 0.015) * Math.exp(-t * 2.5));
        add(measure * bar + step * beat, 0.19, 0.16, 0, (t) =>
          Math.sin(2 * Math.PI * (48 * t + 50 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 23));
      }
      for (let step = 0; step < 8; step++) {
        add(measure * bar + (step + 0.5) * beat / 2, 0.06, 0.016, step % 2 ? -0.4 : 0.4, (t) =>
          noise() * Math.exp(-t * 80) * Math.sin(2 * Math.PI * 6200 * t));
      }
      for (const step of [1, 3]) {
        add(measure * bar + step * beat, 0.09, 0.026, 0.12, (t) => noise() * Math.exp(-t * 45));
      }
    }
  }

  // Short scanner sweeps and tonal acknowledgements are tied to meaningful cuts/actions.
  for (const at of [10, 17.5, 30, 40, 52.5, 65, 77.5, 85]) {
    add(at - 0.17, 0.42, 0.024, -0.15, (t, length) =>
      noise() * Math.sin(Math.PI * t / length) ** 2 * Math.sin(2 * Math.PI * (1700 + 2300 * t) * t));
  }
  for (const [at, note] of [[22, 74], [25.2, 77], [56, 74], [58.5, 69], [72.5, 77], [85.8, 74]]) {
    const hz = frequency(note);
    add(at, 0.95, 0.067, 0.2, (t) => Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * 5.5) * Math.min(1, t / 0.006));
  }

  // Small stereo echoes. Feedback is intentionally absent, so the score stays bounded.
  const delay = Math.round(rate * beat * 0.75);
  for (let i = count - 1; i >= delay; i--) {
    left[i] += right[i - delay] * 0.12;
    right[i] += left[i - delay] * 0.12;
  }
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / rate / 1.1, (duration - i / rate) / 2.2);
    left[i] *= fade; right[i] *= fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const normalization = 0.72 / Math.max(peak, 0.001);
  const wav = Buffer.alloc(44 + count * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(count * 4, 40);
  let sumSquares = 0;
  for (let i = 0; i < count; i++) {
    const l = Math.max(-1, Math.min(1, left[i] * normalization));
    const r = Math.max(-1, Math.min(1, right[i] * normalization));
    sumSquares += l * l + r * r;
    wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  writeFileSync(destination, wav);
  return { duration, rate, channels: 2, peak: 0.72, rms: Math.sqrt(sumSquares / count / 2), seed: 20261012 };
}
