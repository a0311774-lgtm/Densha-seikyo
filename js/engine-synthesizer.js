// Procedural engine DSP. Ported from EngineSynthesizer.swift.

const INT32_MAX = 2147483647;

function defaultParams() {
  return {
    rpm: 800,
    load: 0.3,
    masterVolume: 0.75,
    engagement: 1,
    running: false,
    cranking: false,
  };
}

function newVoice() {
  return {
    crankPhase: 0,
    firePhase: 0,
    env: [0, 0, 0, 0],
    pulse: 0,
    lpfLow: 0,
    lpfBand: 0,
    lpf2Low: 0,
    lpf2Band: 0,
    delayIndex: 0,
    delay: new Float64Array(0),
    rumblePhase: 0,
    harmonicPhase: [0, 0, 0, 0, 0, 0, 0, 0],
    starterPhase: 0,
    rightDelay: new Float64Array(0),
    rightIndex: 0,
    noiseState: 0xA3C59AC3,
  };
}

/**
 * Real-time procedural combustion-engine synthesizer.
 * Ported from EngineSynthesizer.swift.
 */
class EngineSynthesizer {
  constructor() {
    this.pending = defaultParams();
    this.current = defaultParams();
    this.smoothedRPM = 800;
    this.smoothedLoad = 0.3;
    this.smoothedVolume = 0;
    this.smoothedEngagement = 1;
    this.outputGain = 0;
    this.sampleRate = 48000;
    this.configuredRate = 0;
    this.voice = newVoice();
  }

  setParameters(parameters) {
    this.pending = {
      rpm: parameters.rpm,
      load: parameters.load,
      masterVolume: parameters.masterVolume,
      engagement: parameters.engagement,
      running: !!parameters.running,
      cranking: !!parameters.cranking,
    };
  }

  reset() {
    this.pending = defaultParams();
    this.current = defaultParams();
    this.smoothedRPM = 800;
    this.smoothedLoad = 0.3;
    this.smoothedVolume = 0;
    this.smoothedEngagement = 1;
    this.outputGain = 0;
    this.voice = newVoice();
    this.configuredRate = 0;
  }

  render(left, right, frames, sampleRate) {
    if (sampleRate !== this.configuredRate && sampleRate > 0) {
      this.sampleRate = sampleRate;
      this.configureBuffers(sampleRate);
      this.configuredRate = sampleRate;
    }

    this.current = this.pending;

    const dt = 1.0 / this.sampleRate;
    const rpmCoeff = 1.0 - Math.exp(-dt / 0.045);
    const loadCoeff = 1.0 - Math.exp(-dt / 0.06);
    const volCoeff = 1.0 - Math.exp(-dt / 0.02);
    const engageCoeff = 1.0 - Math.exp(-dt / 0.012);

    const delayFrames = this.voice.delay.length;
    const rightDelayFrames = this.voice.rightDelay.length;
    const voice = this.voice;

    for (let i = 0; i < frames; i++) {
      this.smoothedRPM += (this.current.rpm - this.smoothedRPM) * rpmCoeff;
      this.smoothedLoad += (this.current.load - this.smoothedLoad) * loadCoeff;
      const targetVolume = this.current.running || this.current.cranking ? this.current.masterVolume : 0;
      this.smoothedVolume += (targetVolume - this.smoothedVolume) * volCoeff;
      this.smoothedEngagement += (this.current.engagement - this.smoothedEngagement) * engageCoeff;

      let sample;
      if (this.current.cranking && !this.current.running) {
        sample = this.starterSample(dt);
      } else if (this.outputGain < 0.0002 && this.smoothedVolume < 0.0002 && !this.current.running) {
        sample = 0;
        this.idleFilters();
      } else {
        sample = this.engineSample(dt);
      }

      const targetGain = this.smoothedVolume * (this.current.cranking && !this.current.running ? 0.7 : 1);
      this.outputGain += (targetGain - this.outputGain) * volCoeff;
      let out = sample * this.outputGain * 0.42;
      if (out > 1.2) out = 1.2;
      if (out < -1.2) out = -1.2;

      left[i] = out;
      if (right) {
        if (rightDelayFrames > 0) {
          const delayed = voice.rightDelay[voice.rightIndex];
          voice.rightDelay[voice.rightIndex] = out;
          voice.rightIndex += 1;
          if (voice.rightIndex >= rightDelayFrames) voice.rightIndex = 0;
          right[i] = delayed * 0.96;
        } else {
          right[i] = out;
        }
      }
    }
  }

  engineSample(dt) {
    const voice = this.voice;
    const rpm = Math.max(400, this.smoothedRPM);
    const revPerSec = rpm / 60.0;
    const fireFreq = revPerSec * 2.0;
    const load = Math.min(1, Math.max(0, this.smoothedLoad));
    const rpmNorm = Math.min(1, Math.max(0, (rpm - 700) / 6100));

    voice.crankPhase += revPerSec * dt;
    if (voice.crankPhase >= 2) voice.crankPhase -= 2;
    const offsets = [0.0, 0.50, 1.0, 1.50];
    const strengths = [1.0, 0.93, 0.98, 0.90];
    for (let c = 0; c < 4; c++) {
      let d = voice.crankPhase - offsets[c];
      if (d < 0) d += 2;
      if (d < 0.018 || d > 1.982) {
        voice.env[c] = 1.0;
      }
      voice.env[c] *= Math.exp(-dt * (38.0 + 22.0 * rpmNorm));
    }
    const pulse =
      voice.env[0] * strengths[0] +
      voice.env[1] * strengths[1] +
      voice.env[2] * strengths[2] +
      voice.env[3] * strengths[3];
    voice.pulse = pulse;

    let harmonic = 0.0;
    const amplitudes = [1.00, 0.72, 0.48, 0.34, 0.22, 0.16, 0.11, 0.08];
    for (let k = 0; k < 8; k++) {
      const freq = fireFreq * (k + 1);
      voice.harmonicPhase[k] += freq * dt;
      if (voice.harmonicPhase[k] >= 1) {
        voice.harmonicPhase[k] -= Math.floor(voice.harmonicPhase[k]);
      }
      const wobble = 1.0 + 0.012 * Math.sin(voice.crankPhase * Math.PI * (k + 3));
      harmonic += amplitudes[k] * Math.sin(voice.harmonicPhase[k] * 2.0 * Math.PI) * wobble;
    }
    voice.rumblePhase += fireFreq * 0.5 * dt;
    if (voice.rumblePhase >= 1) voice.rumblePhase -= Math.floor(voice.rumblePhase);
    const rumble = Math.sin(voice.rumblePhase * 2.0 * Math.PI) * (0.22 + 0.18 * (1 - rpmNorm));

    const noise = this.nextNoise();
    const roughness = noise * (0.35 + 0.55 * load) * (0.25 + pulse * 0.85);

    let raw = harmonic * (0.55 + 0.28 * pulse);
    raw += rumble;
    raw += roughness;
    const drive = 1.05 + 1.35 * load + 0.55 * rpmNorm;
    raw = Math.tanh(raw * drive);

    if (voice.delay.length > 0) {
      const delayed = voice.delay[voice.delayIndex];
      const feedback = 0.32 + 0.12 * load;
      voice.delay[voice.delayIndex] = raw + delayed * feedback;
      voice.delayIndex += 1;
      if (voice.delayIndex >= voice.delay.length) voice.delayIndex = 0;
      raw = raw * 0.72 + delayed * 0.55;
    }

    const cutoff = 620 + 5200 * Math.pow(rpmNorm, 0.82) * (0.62 + 0.48 * load);
    const q = 0.85 + 0.35 * load;
    const sv1 = this.stateVariable(raw, cutoff, q, "lpfLow", "lpfBand");
    const filtered = this.stateVariable(sv1, cutoff * 1.35, 0.7, "lpf2Low", "lpf2Band");

    const presence = (0.16 + 0.84 * (0.28 + 0.72 * rpmNorm)) * (0.52 + 0.48 * load);
    const cut = 0.12 + 0.88 * Math.min(1, Math.max(0, this.smoothedEngagement));
    return filtered * presence * cut;
  }

  starterSample(dt) {
    const voice = this.voice;
    voice.starterPhase += dt * 12.2;
    if (voice.starterPhase >= 1) voice.starterPhase -= 1;
    const grind = voice.starterPhase < 0.38 ? 1.0 : 0.15;
    const buzzFreq = 410.0 + 40.0 * Math.sin(voice.starterPhase * 2.0 * Math.PI);
    voice.firePhase += buzzFreq * dt;
    if (voice.firePhase >= 1) voice.firePhase -= Math.floor(voice.firePhase);
    const buzz = Math.sin(voice.firePhase * 2.0 * Math.PI);
    const noise = this.nextNoise() * 0.45;
    const raw = (buzz * 0.55 + noise) * grind;
    return Math.tanh(raw * 1.6) * 0.7;
  }

  idleFilters() {
    const voice = this.voice;
    voice.lpfLow *= 0.9;
    voice.lpfBand *= 0.9;
    voice.lpf2Low *= 0.9;
    voice.lpf2Band *= 0.9;
    voice.pulse = 0;
    for (let i = 0; i < voice.env.length; i++) voice.env[i] *= 0.9;
  }

  stateVariable(input, cutoff, q, lowKey, bandKey) {
    const voice = this.voice;
    const sr = this.sampleRate;
    const clipped = Math.min(cutoff, sr * 0.22);
    let f = 2.0 * Math.sin((Math.PI * clipped) / sr);
    if (f > 1.2) f = 1.2;
    const damp = Math.min(2.0, Math.max(0.12, 1.0 / Math.max(0.2, q)));
    voice[lowKey] += f * voice[bandKey];
    const high = input - voice[lowKey] - damp * voice[bandKey];
    voice[bandKey] += f * high;
    return voice[lowKey];
  }

  nextNoise() {
    let x = this.voice.noiseState >>> 0;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    this.voice.noiseState = x >>> 0;
    const signed = x > 0x7fffffff ? x - 0x100000000 : x;
    return signed / INT32_MAX;
  }

  configureBuffers(sampleRate) {
    const pipe = Math.max(32, Math.round(0.011 * sampleRate));
    this.voice.delay = new Float64Array(pipe);
    this.voice.delayIndex = 0;
    const width = Math.max(2, Math.round(0.0014 * sampleRate));
    this.voice.rightDelay = new Float64Array(width);
    this.voice.rightIndex = 0;
  }
}


export { EngineSynthesizer };
