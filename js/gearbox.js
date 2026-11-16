// Six-speed gearbox with shift hysteresis, clutch-slip idle, and a brief audible shift.
// Ported from Gearbox.swift.

import { SPORTS_SALOON, gearCount, rawRPM } from "./vehicle-specs.js";

export function gearDisplayName(gearIndex) {
  return gearIndex <= 0 ? "N" : String(gearIndex);
}

function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** RPM path through a shift: drop (cut) then catch the incoming gear. */
export function shiftRPM(progress, from, to, idle) {
  const p = Math.min(1, Math.max(0, progress));
  const dip = Math.max(idle * 0.9, Math.min(from, to) * 0.82);
  if (p < 0.42) return lerp(from, dip, p / 0.42);
  return lerp(dip, to, (p - 0.42) / 0.58);
}

/** Fuel/ignition cut envelope used by the audio engine (~200–300 ms). */
export function shiftEngagement(progress) {
  const p = Math.min(1, Math.max(0, progress));
  if (p < 0.12) return lerp(1.0, 0.18, p / 0.12);
  if (p < 0.55) return 0.18;
  return lerp(0.18, 1.0, (p - 0.55) / 0.45);
}

export class Gearbox {
  constructor(specs = SPORTS_SALOON) {
    this.specs = specs;
    this.reset();
  }

  reset() {
    this.currentGear = 0;
    this.shiftFromGear = 0;
    this.shiftToGear = 0;
    this.shiftElapsed = 0;
    this.isShifting = false;
  }

  update(speedMetersPerSecond, dt, throttle = 0) {
    dt = Math.max(0, dt);
    const speed = Math.max(0, speedMetersPerSecond);
    const kmh = speed * 3.6;
    throttle = Math.min(1, Math.max(0, throttle));
    const specs = this.specs;
    const upshiftRPM = lerp(specs.cruiseUpshiftRPM, specs.upshiftRPM, Math.pow(throttle, 0.75));
    const downshiftRPM = lerp(specs.cruiseDownshiftRPM, specs.downshiftRPM, throttle);

    if (this.isShifting) {
      return this.continueShift(speed, dt);
    }

    if (this.currentGear === 0) {
      if (kmh >= specs.leaveNeutralKmh) {
        const target = this.suitableGear(speed) ?? 1;
        this.beginShift(0, target);
        return this.continueShift(speed, dt);
      }
      return this.snapshot(0, specs.idleRPM, false, 1, 1);
    }

    if (kmh <= specs.enterNeutralKmh) {
      this.beginShift(this.currentGear, 0);
      return this.continueShift(speed, dt);
    }

    const rpmNow = this.displayedRPM(speed, this.currentGear);
    const count = gearCount(specs);

    if (this.currentGear < count && rpmNow >= upshiftRPM) {
      this.beginShift(this.currentGear, this.currentGear + 1);
      return this.continueShift(speed, dt);
    }

    if (this.currentGear > 1 && rpmNow <= downshiftRPM) {
      const lower = this.currentGear - 1;
      const lowerRPM = this.displayedRPM(speed, lower);
      if (lowerRPM < specs.redlineRPM - 200) {
        this.beginShift(this.currentGear, lower);
        return this.continueShift(speed, dt);
      }
    }

    if (this.currentGear > 1 && throttle > 0.72) {
      const lower = this.currentGear - 1;
      const lowerRPM = this.displayedRPM(speed, lower);
      if (lowerRPM < specs.upshiftRPM - 200 && rpmNow < specs.upshiftRPM * 0.85) {
        this.beginShift(this.currentGear, lower);
        return this.continueShift(speed, dt);
      }
    }

    return this.snapshot(this.currentGear, rpmNow, false, 1, 1);
  }

  suitableGear(speedMetersPerSecond) {
    const specs = this.specs;
    const speed = Math.max(0, speedMetersPerSecond);
    if (speed * 3.6 < specs.leaveNeutralKmh) return null;

    const minEngaged = Math.max(specs.downshiftRPM, specs.idleRPM + 200);
    const count = gearCount(specs);
    let chosen = null;
    for (let gear = 1; gear <= count; gear++) {
      const raw = rawRPM(speed, gear, specs);
      if (raw <= specs.upshiftRPM && raw >= minEngaged) {
        chosen = gear;
      }
    }
    if (chosen != null) return chosen;

    const firstRaw = rawRPM(speed, 1, specs);
    if (firstRaw <= specs.upshiftRPM) return 1;

    for (let gear = count; gear >= 1; gear--) {
      const raw = rawRPM(speed, gear, specs);
      if (raw <= specs.redlineRPM) return gear;
    }
    return count;
  }

  displayedRPM(speed, gear) {
    const specs = this.specs;
    if (gear < 1) return specs.idleRPM;
    const raw = rawRPM(speed, gear, specs);
    return Math.min(specs.redlineRPM + 200, Math.max(specs.idleRPM, raw));
  }

  beginShift(from, to) {
    this.isShifting = true;
    this.shiftFromGear = from;
    this.shiftToGear = to;
    this.shiftElapsed = 0;
  }

  continueShift(speed, dt) {
    this.shiftElapsed += dt;
    const duration = Math.max(0.05, this.specs.shiftDuration);
    const progress = Math.min(1, this.shiftElapsed / duration);

    const fromGear = Math.max(this.shiftFromGear, 0) === 0 ? 0 : this.shiftFromGear;
    const fromRPM = this.displayedRPM(speed, fromGear);
    const toRPM = this.displayedRPM(speed, this.shiftToGear);
    const rpm = shiftRPM(progress, fromRPM, toRPM, this.specs.idleRPM);
    const engagement = shiftEngagement(progress);

    if (progress >= 1) {
      this.currentGear = this.shiftToGear;
      this.isShifting = false;
      this.shiftElapsed = 0;
      return this.snapshot(
        this.currentGear,
        this.displayedRPM(speed, this.currentGear),
        false,
        1,
        1
      );
    }

    const shown = progress >= 0.35 ? this.shiftToGear : this.shiftFromGear;
    return this.snapshot(shown, rpm, true, progress, engagement);
  }

  snapshot(gear, rpm, shifting, progress, engagement) {
    return {
      gearIndex: gear <= 0 ? 0 : gear,
      gearName: gearDisplayName(gear),
      rpm,
      isShifting: shifting,
      shiftProgress: progress,
      engagement,
    };
  }
}
