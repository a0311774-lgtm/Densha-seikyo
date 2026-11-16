// Mechanical constants for a compact 6-speed sports saloon.
// Ported from VehicleSpecs.swift.

export const SPORTS_SALOON = Object.freeze({
  gearRatios: Object.freeze([3.583, 2.042, 1.400, 1.061, 0.852, 0.717]),
  finalDrive: 4.105,
  wheelRadius: 0.318,
  idleRPM: 800,
  redlineRPM: 6800,
  upshiftRPM: 5800,
  downshiftRPM: 2000,
  cruiseUpshiftRPM: 2800,
  cruiseDownshiftRPM: 1200,
  shiftDuration: 0.26,
  enterNeutralKmh: 1.2,
  leaveNeutralKmh: 2.5,
});

export function gearCount(specs = SPORTS_SALOON) {
  return specs.gearRatios.length;
}

export function ratioForGear(gear, specs = SPORTS_SALOON) {
  return specs.gearRatios[gear - 1];
}

/** Engine RPM implied by vehicle speed in a given forward gear, before idle clamp. */
export function rawRPM(speedMetersPerSecond, gear, specs = SPORTS_SALOON) {
  const wheelRPS = speedMetersPerSecond / (2.0 * Math.PI * specs.wheelRadius);
  return wheelRPS * ratioForGear(gear, specs) * specs.finalDrive * 60.0;
}

export function speedMetersPerSecondFromRPM(rpm, gear, specs = SPORTS_SALOON) {
  const wheelRPS = rpm / (ratioForGear(gear, specs) * specs.finalDrive * 60.0);
  return wheelRPS * 2.0 * Math.PI * specs.wheelRadius;
}
