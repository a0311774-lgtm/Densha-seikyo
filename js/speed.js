// GPS / Geolocation speed service.
// Prefers Position.coords.speed (m/s). Falls back to haversine only when speed is null,
// and never invents a high speed from jitter.

export const GPS_STATUS = {
  notDetermined: "notDetermined",
  denied: "denied",
  restricted: "restricted",
  searching: "searching",
  poorAccuracy: "poorAccuracy",
  valid: "valid",
  failed: "failed",
  unsupported: "unsupported",
};

const ACCURACY_LIMIT = 45; // metres; matches the native app
const EARTH_RADIUS = 6371000;

export const STATUS_COPY = {
  notDetermined: {
    headline: "等待定位權限",
    detail: "第一次使用時，請允許 Safari 存取位置，先可以按車速配引擎聲。",
  },
  denied: {
    headline: "未獲位置權限",
    detail: "可改用示範模式，或到「設定 > Safari」／「設定」入面呢個網頁 App，開啟位置權限。",
  },
  restricted: {
    headline: "定位功能受限制",
    detail: "系統限制咗定位。可改用示範模式試引擎聲同波段。",
  },
  searching: {
    headline: "搜尋衛星中…",
    detail: "請到戶外空曠位置。GPS 車速喺實際行駛時先比較準。",
  },
  poorAccuracy: {
    headline: "定位精確度不足",
    detail: "目前水平精確度不足，暫不採用呢個車速。可改用示範模式，或繼續喺戶外行駛。",
  },
  valid: {
    headline: "GPS 已鎖定",
    detail: "正使用 GPS 車速。關閉示範模式後會跟住路面速度。",
  },
  failed: {
    headline: "未能取得車速",
    detail: "定位失敗。可改用示範模式試引擎聲。",
  },
  unsupported: {
    headline: "此瀏覽器不支援定位",
    detail: "請用 iPhone 嘅 Safari 打開，並以 HTTPS 開啟呢個網頁。室內可改用示範模式。",
  },
};

export function statusHeadline(status) {
  return (STATUS_COPY[status.kind] || STATUS_COPY.failed).headline;
}

export function statusDetail(status) {
  if (status.kind === "poorAccuracy" && typeof status.meters === "number") {
    return `目前水平精確度約 ${Math.round(status.meters)} 米，暫不採用呢個車速。可改用示範模式，或繼續喺戶外行駛。`;
  }
  if (status.kind === "failed" && status.message) return status.message;
  return (STATUS_COPY[status.kind] || STATUS_COPY.failed).detail;
}

export function statusIsUsable(status) {
  return status && status.kind === GPS_STATUS.valid;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export class LocationSpeedService {
  constructor() {
    this.status = { kind: GPS_STATUS.notDetermined };
    this.metersPerSecond = null;
    this.horizontalAccuracy = null;
    this.watchId = null;
    this.listeners = new Set();
    this.lastFix = null;
    this.estimateBuffer = [];
  }

  get kilometersPerHour() {
    if (this.metersPerSecond == null || this.metersPerSecond < 0) return null;
    return this.metersPerSecond * 3.6;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  setStatus(status, clearSpeed = false) {
    if (clearSpeed) {
      this.metersPerSecond = null;
      this.horizontalAccuracy = null;
    }
    this.status = status;
    this.emit();
  }

  start() {
    if (!navigator.geolocation) {
      this.setStatus({ kind: GPS_STATUS.unsupported }, true);
      return;
    }
    if (this.watchId != null) return;
    if (this.status.kind === GPS_STATUS.notDetermined || this.status.kind === GPS_STATUS.denied) {
      // Keep denied if already known; otherwise show searching after the prompt.
    }
    if (this.status.kind !== GPS_STATUS.denied && this.status.kind !== GPS_STATUS.restricted) {
      this.setStatus({ kind: GPS_STATUS.searching }, this.status.kind !== GPS_STATUS.valid);
    }
    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.onPosition(position),
      (error) => this.onError(error),
      {
        enableHighAccuracy: true,
        maximumAge: 250,
        timeout: 15000,
      }
    );
  }

  requestPermission() {
    this.start();
  }

  stop() {
    if (this.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  onPosition(position) {
    const coords = position.coords;
    const accuracy = coords.accuracy;
    const timestamp = position.timestamp;
    this.horizontalAccuracy = accuracy;

    if (accuracy < 0 || accuracy > ACCURACY_LIMIT) {
      this.metersPerSecond = null;
      if (accuracy < 0) {
        this.status = { kind: GPS_STATUS.searching };
      } else {
        this.status = { kind: GPS_STATUS.poorAccuracy, meters: accuracy };
      }
      this.rememberFix(coords, timestamp, null);
      this.emit();
      return;
    }

    const reported = coords.speed;
    const hasReported = reported != null && Number.isFinite(reported);

    if (hasReported) {
      if (reported < 0) {
        this.metersPerSecond = null;
        this.status = { kind: GPS_STATUS.searching };
        this.rememberFix(coords, timestamp, null);
        this.emit();
        return;
      }
      this.metersPerSecond = reported;
      this.status = { kind: GPS_STATUS.valid };
      this.rememberFix(coords, timestamp, reported);
      this.emit();
      return;
    }

    // Fallback: estimate from successive lat/lon. Do not invent speed from jitter.
    const estimated = this.estimateSpeed(coords, timestamp, accuracy);
    if (estimated.skip) return;
    if (estimated.invalidate || estimated.speed == null) {
      this.metersPerSecond = null;
      this.status = { kind: GPS_STATUS.searching };
      this.emit();
      return;
    }
    this.metersPerSecond = estimated.speed;
    this.status = { kind: GPS_STATUS.valid };
    this.emit();
  }

  rememberFix(coords, timestamp, speed) {
    this.lastFix = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy: coords.accuracy,
      timestamp,
      speed,
    };
  }

  estimateSpeed(coords, timestamp, accuracy) {
    const prev = this.lastFix;
    if (!prev) {
      this.rememberFix(coords, timestamp, null);
      return { skip: true };
    }

    const dt = (timestamp - prev.timestamp) / 1000;
    // Wait for a wider window so wander does not become fake speed.
    if (dt < 0.5) return { skip: true };

    this.rememberFix(coords, timestamp, null);
    if (dt > 4) {
      this.estimateBuffer = [];
      return { invalidate: true };
    }

    const dist = haversineMeters(prev.lat, prev.lon, coords.latitude, coords.longitude);
    const combinedAccuracy = Math.max(accuracy, prev.accuracy || accuracy);

    // Movement inside the accuracy circle is jitter, not travel.
    // Accept a true standstill (0) when the fix is otherwise good, so idle works at the lights.
    if (dist < Math.max(combinedAccuracy * 0.5, 4)) {
      this.estimateBuffer.push(0);
      this.trimBuffer();
      return { speed: 0 };
    }

    const raw = dist / dt;
    // Reject a single implausible jump (e.g. 40 m/s from a bad fix).
    if (raw > 55) return { invalidate: true };

    this.estimateBuffer.push(raw);
    this.trimBuffer();

    if (this.estimateBuffer.length >= 2) {
      const sorted = [...this.estimateBuffer].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      if (mid < 0.4) return { speed: 0 };
      return { speed: mid };
    }
    return { speed: raw < 0.4 ? 0 : raw };
  }

  trimBuffer() {
    if (this.estimateBuffer.length > 5) {
      this.estimateBuffer.splice(0, this.estimateBuffer.length - 5);
    }
  }

  onError(error) {
    this.metersPerSecond = null;
    const code = error && error.code;
    if (code === 1) {
      // PERMISSION_DENIED
      this.status = { kind: GPS_STATUS.denied };
    } else if (code === 2) {
      this.status = {
        kind: GPS_STATUS.failed,
        message: "暫時未能確定位置。請到戶外空曠處再試，或改用示範模式。",
      };
    } else if (code === 3) {
      this.status = {
        kind: GPS_STATUS.failed,
        message: "定位逾時。請到戶外空曠處再試，或改用示範模式。",
      };
    } else {
      this.status = { kind: GPS_STATUS.failed, message: "定位失敗。可改用示範模式試引擎聲。" };
    }
    this.emit();
  }
}
