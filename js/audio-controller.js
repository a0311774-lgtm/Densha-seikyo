// Web Audio playback wrapper. Creates / resumes AudioContext inside the Start tap
// because iOS Safari will otherwise keep the context suspended.

import { EngineSynthesizer } from "./engine-synthesizer.js";

const WORKLET_URL = new URL("./engine-worklet.js", import.meta.url);

function AudioContextCtor() {
  return window.AudioContext || window.webkitAudioContext;
}

export class EngineAudioController {
  constructor() {
    this.masterVolume = 0.75;
    this.ctx = null;
    this.workletNode = null;
    this.scriptNode = null;
    this.synth = null;
    this.usingWorklet = false;
    this.isRunning = false;
    this.unlockStarted = false;
    this.rpm = 800;
    this.load = 0.3;
    this.engagement = 1;
    this.running = false;
    this.cranking = false;
    this._onState = null;
  }

  setEngineState({ rpm, load, engagement, running, cranking }) {
    this.rpm = rpm;
    this.load = Math.min(1, Math.max(-0.2, load));
    this.engagement = Math.min(1, Math.max(0, engagement));
    this.running = running;
    this.cranking = cranking;
    this.pushParameters();
  }

  /**
   * Must be called directly from a user gesture (the 啟動 button).
   * Creates the context and resumes it synchronously, then connects the graph.
   */
  async startPlaybackIfNeeded() {
    const Ctor = AudioContextCtor();
    if (!Ctor) throw new Error("呢個瀏覽器不支援 Web Audio。");

    if (!this.ctx) {
      this.ctx = new Ctor({ latencyHint: "interactive" });
    }

    // Resume and unlock in the same turn as the tap, before any await.
    this.unlock(this.ctx);
    if (this.ctx.state === "suspended") {
      try {
        this.ctx.resume();
      } catch {
        // retried after graph setup
      }
    }

    if (!this.isRunning) {
      await this.ensureGraph();
    }

    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    this.isRunning = true;
    this.listenForInterruptions();
    this.pushParameters();
  }

  stopPlayback() {
    this.running = false;
    this.cranking = false;
    this.pushParameters();
  }

  async shutdownGraph() {
    this.running = false;
    this.cranking = false;
    this.pushParameters();
    if (this.scriptNode) {
      try {
        this.scriptNode.disconnect();
      } catch {
        /* already disconnected */
      }
      this.scriptNode.onaudioprocess = null;
      this.scriptNode = null;
    }
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch {
        /* already disconnected */
      }
      this.workletNode = null;
    }
    this.synth = null;
    this.usingWorklet = false;
    this.isRunning = false;
    if (this.ctx && this.ctx.state !== "closed") {
      try {
        await this.ctx.suspend();
      } catch {
        /* ignore */
      }
    }
  }

  unlock(ctx) {
    if (this.unlockStarted) return;
    this.unlockStarted = true;
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      this.unlockStarted = false;
    }
  }

  async ensureGraph() {
    if (this.workletNode || this.scriptNode) return;
    const ctx = this.ctx;

    if (ctx.audioWorklet && typeof ctx.audioWorklet.addModule === "function") {
      try {
        await ctx.audioWorklet.addModule(WORKLET_URL.href);
        const node = new AudioWorkletNode(ctx, "engine-processor", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.connect(ctx.destination);
        this.workletNode = node;
        this.usingWorklet = true;
        this.pushParameters();
        return;
      } catch (err) {
        console.warn("AudioWorklet unavailable, falling back to ScriptProcessor", err);
        this.usingWorklet = false;
      }
    }

    this.attachScriptProcessor(ctx);
  }

  attachScriptProcessor(ctx) {
    const synth = new EngineSynthesizer();
    this.synth = synth;
    const bufferSize = 512;
    const node = ctx.createScriptProcessor(bufferSize, 0, 2);
    node.onaudioprocess = (event) => {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      synth.render(left, right, left.length, event.outputBuffer.sampleRate || ctx.sampleRate);
    };
    node.connect(ctx.destination);
    this.scriptNode = node;
    this.usingWorklet = false;
    this.pushParameters();
  }

  pushParameters() {
    const loadForAudio = Math.min(1, Math.max(0, 0.35 + 0.65 * this.load));
    const params = {
      rpm: this.rpm,
      load: loadForAudio,
      masterVolume: this.masterVolume,
      engagement: this.engagement,
      running: this.running,
      cranking: this.cranking,
    };
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "params", params });
    }
    if (this.synth) {
      this.synth.setParameters(params);
    }
  }

  listenForInterruptions() {
    if (this._onState) return;
    const resumeIfNeeded = async () => {
      if (!this.ctx) return;
      if ((this.running || this.cranking) && this.ctx.state === "suspended") {
        try {
          await this.ctx.resume();
        } catch {
          /* may need another gesture */
        }
      }
    };
    this._onState = () => {
      resumeIfNeeded();
    };
    this.ctx.addEventListener("statechange", this._onState);
    document.addEventListener("visibilitychange", resumeIfNeeded);
    window.addEventListener("focus", resumeIfNeeded);
    window.addEventListener("pageshow", resumeIfNeeded);
  }
}
