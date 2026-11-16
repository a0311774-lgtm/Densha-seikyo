// Application model: speed source, gearbox, load, engine run state.
// Ported from AppModel.swift.

import { SPORTS_SALOON } from "./vehicle-specs.js";
import { Gearbox } from "./gearbox.js";
import { LocationSpeedService, statusIsUsable } from "./speed.js";
import { EngineAudioController } from "./audio-controller.js";

export const EngineRunState = {
  off: "off",
  cranking: "cranking",
  running: "running",
  stopping: "stopping",
};

export class AppModel {
  constructor() {
    this.speedKmh = 0;
    this.displayedRPM = 0;
    this.gearIndex = 0;
    this.gearName = "N";
    this.isShifting = false;
    this.engineState = EngineRunState.off;
    this.load = 0.3;
    this.isDemoMode = false;
    this.demoSpeedKmh = 40;
    this.volume = 0.75;
    this.location = new LocationSpeedService();
    this.audio = new EngineAudioController();
    this.audio.masterVolume = this.volume;

    this.gearbox = new Gearbox(SPORTS_SALOON);
    this.specs = SPORTS_SALOON;
    this.maxDemoKmh = 200;
    this.lastTick = 0;
    this.lastSpeedMps = 0;
    this.smoothedAccel = 0;
    this.stateElapsed = 0;
    this.rundownFromRPM = 800;
    this.raf = 0;
    this.listeners = new Set();
    this.wakeLock = null;
  }

  get gpsStatus() {
    return this.location.status;
  }

  get isEngineOn() {
    return this.engineState === EngineRunState.running || this.engineState === EngineRunState.cranking;
  }

  get gpsSpeedIsUsable() {
    return statusIsUsable(this.location.status) && this.location.kilometersPerHour != null;
  }

  get isUsingLiveGPS() {
    return !this.isDemoMode && this.gpsSpeedIsUsable;
  }

  get speedSourceLabel() {
    if (this.isDemoMode) return "示範車速";
    if (this.isUsingLiveGPS) return "GPS 車速";
    return "未有有效車速";
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  start() {
    this.location.start();
    this.location.onChange(() => this.emit());
    this.lastTick = performance.now();
    if (this.raf) return;
    const loop = (now) => {
      this.tickOnce(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, value));
    this.audio.masterVolume = this.volume;
    this.audio.pushParameters();
    this.emit();
  }

  setDemoMode(on) {
    this.isDemoMode = !!on;
    this.emit();
  }

  setDemoSpeed(kmh) {
    this.demoSpeedKmh = Math.min(this.maxDemoKmh, Math.max(0, kmh));
    this.emit();
  }

  requestLocationPermission() {
    this.location.requestPermission();
  }

  async toggleEngine() {
    if (this.engineState === EngineRunState.off || this.engineState === EngineRunState.stopping) {
      await this.startEngine();
    } else {
      this.stopEngine();
    }
  }

  async startEngine() {
    this.stateElapsed = 0;
    this.engineState = EngineRunState.cranking;
    this.emit();
    try {
      await this.audio.startPlaybackIfNeeded();
    } catch (err) {
      this.engineState = EngineRunState.off;
      this.emit();
      throw err;
    }
    this.requestWakeLock();
  }

  stopEngine() {
    if (this.engineState === EngineRunState.off) return;
    this.rundownFromRPM = Math.max(this.displayedRPM, this.specs.idleRPM);
    this.stateElapsed = 0;
    this.engineState = EngineRunState.stopping;
    this.audio.stopPlayback();
    this.releaseWakeLock();
    this.emit();
  }

  currentSpeedMetersPerSecond() {
    if (this.isDemoMode) {
      return Math.min(this.maxDemoKmh, Math.max(0, this.demoSpeedKmh)) / 3.6;
    }
    if (this.gpsSpeedIsUsable) {
      return Math.max(0, this.location.kilometersPerHour) / 3.6;
    }
    return 0;
  }

  updateLoad(speedMps, dt) {
    const accel = (speedMps - this.lastSpeedMps) / Math.max(dt, 1 / 60);
    this.lastSpeedMps = speedMps;
    const coeff = 1 - Math.exp(-dt / 0.22);
    this.smoothedAccel += (accel - this.smoothedAccel) * coeff;
    const accelLoad = Math.min(1, Math.max(-0.45, this.smoothedAccel / 2.5));
    const roadLoad = Math.min(0.45, speedMps / 40.0);
    this.load = Math.min(1, Math.max(0, 0.22 + roadLoad + accelLoad * 0.55));
  }

  gearboxThrottle() {
    const deadzoned = Math.abs(this.smoothedAccel) < 0.45 ? 0 : this.smoothedAccel;
    return Math.min(1, Math.max(0, deadzoned / 2.4));
  }

  pushAudio(rpm, engagement, running, cranking) {
    this.audio.setEngineState({
      rpm,
      load: this.load,
      engagement,
      running,
      cranking,
    });
  }

  tickOnce(now) {
    const elapsed = (now - this.lastTick) / 1000;
    const dt = Math.min(0.1, Math.max(1 / 60, elapsed || 1 / 60));
    this.lastTick = now;

    const speedMps = this.currentSpeedMetersPerSecond();
    this.speedKmh = speedMps * 3.6;
    this.updateLoad(speedMps, dt);

    switch (this.engineState) {
      case EngineRunState.off: {
        this.gearbox.reset();
        this.gearIndex = 0;
        this.gearName = "N";
        this.isShifting = false;
        this.displayedRPM = 0;
        this.pushAudio(0, 0, false, false);
        break;
      }
      case EngineRunState.cranking: {
        this.stateElapsed += dt;
        this.gearIndex = 0;
        this.gearName = "N";
        this.isShifting = false;
        if (this.stateElapsed < 0.85) {
          this.displayedRPM = 180 + 160 * Math.sin(this.stateElapsed * 14);
          this.pushAudio(400, 1, false, true);
        } else {
          this.gearbox.reset();
          this.engineState = EngineRunState.running;
          this.displayedRPM = this.specs.idleRPM;
          this.pushAudio(this.specs.idleRPM, 1, true, false);
        }
        break;
      }
      case EngineRunState.running: {
        const snapshot = this.gearbox.update(speedMps, dt, this.gearboxThrottle());
        this.gearIndex = snapshot.gearIndex;
        this.gearName = snapshot.gearName;
        this.isShifting = snapshot.isShifting;
        this.displayedRPM = snapshot.rpm;
        this.pushAudio(snapshot.rpm, snapshot.engagement, true, false);
        break;
      }
      case EngineRunState.stopping: {
        this.stateElapsed += dt;
        const span = 1.15;
        const t = Math.min(1, this.stateElapsed / span);
        const easing = 1 - (1 - t) * (1 - t);
        this.displayedRPM = Math.max(0, this.rundownFromRPM * (1 - easing));
        this.isShifting = false;
        if (t > 0.7) {
          this.gearIndex = 0;
          this.gearName = "N";
        }
        this.pushAudio(this.displayedRPM, 1 - easing, this.displayedRPM > 40, false);
        if (t >= 1) {
          this.engineState = EngineRunState.off;
          this.displayedRPM = 0;
          this.gearbox.reset();
          this.pushAudio(0, 0, false, false);
        }
        break;
      }
      default:
        break;
    }

    this.emit();
  }

  async requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  async releaseWakeLock() {
    if (!this.wakeLock) return;
    try {
      await this.wakeLock.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }
}
