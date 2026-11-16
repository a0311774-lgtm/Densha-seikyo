import { drawTachometer, drawSpeedometer } from "./gauges.js";
import { EngineRunState } from "./app-model.js";
import { statusHeadline, statusDetail, GPS_STATUS } from "./speed.js";

const ENGINE_LABEL = {
  off: "啟動",
  cranking: "啟動中",
  running: "熄火",
  stopping: "熄火中",
};

const GATES = ["N", "1", "2", "3", "4", "5", "6"];

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function isApplePhone() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function demoSubtitle(model) {
  if (model.isDemoMode && model.gpsSpeedIsUsable) {
    return "GPS 車速已就緒，關閉示範模式即可跟路面速度。";
  }
  if (model.isDemoMode) return "無需 GPS，用滑桿試引擎聲同波段。";
  if (model.isUsingLiveGPS) return "而家跟住 GPS 車速。";
  return "未有有效 GPS 車速時，可開啟示範模式室內試用。";
}

function pillTone(model) {
  if (model.isUsingLiveGPS) return "ok";
  switch (model.gpsStatus.kind) {
    case GPS_STATUS.valid:
      return "ok";
    case GPS_STATUS.searching:
    case GPS_STATUS.notDetermined:
      return "wait";
    case GPS_STATUS.poorAccuracy:
      return "warn";
    default:
      return "bad";
  }
}

export function bindUI(model) {
  const tacho = document.getElementById("tacho");
  const speedo = document.getElementById("speedo");
  const speedSource = document.getElementById("speed-source");
  const pill = document.getElementById("status-pill");
  const pillDot = document.getElementById("status-dot");
  const pillText = document.getElementById("status-text");
  const gearDisplay = document.getElementById("gear-display");
  const gearGates = document.getElementById("gear-gates");
  const banner = document.getElementById("status-banner");
  const bannerTitle = document.getElementById("banner-title");
  const bannerDetail = document.getElementById("banner-detail");
  const engineBtn = document.getElementById("engine-btn");
  const engineLabel = document.getElementById("engine-label");
  const volume = document.getElementById("volume");
  const volumeValue = document.getElementById("volume-value");
  const demoToggle = document.getElementById("demo-toggle");
  const demoSubtitleEl = document.getElementById("demo-subtitle");
  const demoSliderWrap = document.getElementById("demo-slider-wrap");
  const demoSpeed = document.getElementById("demo-speed");
  const demoSpeedValue = document.getElementById("demo-speed-value");
  const allowLocation = document.getElementById("allow-location");
  const installHint = document.getElementById("install-hint");
  const dismissInstall = document.getElementById("dismiss-install");
  const audioError = document.getElementById("audio-error");

  GATES.forEach((gate) => {
    const el = document.createElement("span");
    el.className = "gate";
    el.dataset.gate = gate;
    el.textContent = gate;
    gearGates.appendChild(el);
  });

  engineBtn.addEventListener("click", async () => {
    audioError.hidden = true;
    try {
      await model.toggleEngine();
    } catch (err) {
      audioError.hidden = false;
      audioError.textContent = "未能啟動聲效。請喺 Safari 再按一次「啟動」，並確認唔係靜音封鎖呢個網站。";
      console.warn(err);
    }
  });

  volume.addEventListener("input", () => {
    model.setVolume(Number(volume.value) / 100);
  });

  demoToggle.addEventListener("change", () => {
    model.setDemoMode(demoToggle.checked);
  });

  demoSpeed.addEventListener("input", () => {
    model.setDemoSpeed(Number(demoSpeed.value));
  });

  allowLocation.addEventListener("click", () => {
    model.requestLocationPermission();
  });

  if (isApplePhone() && !isStandalone()) {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem("densha-install-dismissed") === "1";
    } catch {
      dismissed = false;
    }
    if (!dismissed) installHint.hidden = false;
  }
  dismissInstall.addEventListener("click", () => {
    installHint.hidden = true;
    try {
      sessionStorage.setItem("densha-install-dismissed", "1");
    } catch {
      /* private mode may block storage */
    }
  });

  let lastTacho = -1;
  let lastSpeed = -1;
  let lastGPS = false;
  let lastShift = false;

  const resize = () => {
    lastTacho = -1;
    lastSpeed = -1;
    render(true);
  };
  window.addEventListener("resize", resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
  }

  function render(force) {
    speedSource.textContent = model.speedSourceLabel;
    pillText.textContent = statusHeadline(model.gpsStatus);
    pill.dataset.tone = pillTone(model);
    pillDot.dataset.tone = pillTone(model);

    const nearRedline = model.displayedRPM >= 6200;
    gearDisplay.textContent = model.gearName;
    gearDisplay.classList.toggle("is-shifting", model.isShifting);
    gearDisplay.classList.toggle("is-redline", nearRedline);
    gearGates.querySelectorAll(".gate").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.gate === model.gearName);
    });

    const showBanner = !model.isDemoMode && !model.isUsingLiveGPS;
    banner.hidden = !showBanner;
    if (showBanner) {
      bannerTitle.textContent = statusHeadline(model.gpsStatus);
      bannerDetail.textContent = statusDetail(model.gpsStatus);
      banner.dataset.kind = model.gpsStatus.kind;
    }

    engineBtn.dataset.state = model.engineState;
    engineLabel.textContent = ENGINE_LABEL[model.engineState];
    engineBtn.setAttribute("aria-label", ENGINE_LABEL[model.engineState]);

    volumeValue.textContent = `${Math.round(model.volume * 100)}%`;
    if (document.activeElement !== volume) {
      volume.value = String(Math.round(model.volume * 100));
    }
    document.getElementById("volume-icon-on").hidden = model.volume <= 0.001;
    document.getElementById("volume-icon-off").hidden = model.volume > 0.001;

    demoToggle.checked = model.isDemoMode;
    demoSubtitleEl.textContent = demoSubtitle(model);
    demoSliderWrap.hidden = !model.isDemoMode;
    if (document.activeElement !== demoSpeed) {
      demoSpeed.value = String(Math.round(model.demoSpeedKmh));
    }
    demoSpeedValue.textContent = `${Math.round(model.demoSpeedKmh)} km/h`;

    allowLocation.hidden = model.gpsStatus.kind !== GPS_STATUS.notDetermined;

    const rpm = model.displayedRPM;
    const speed = model.speedKmh;
    const gps = model.isUsingLiveGPS;
    if (
      force ||
      Math.abs(rpm - lastTacho) > 2 ||
      model.isShifting !== lastShift
    ) {
      drawTachometer(tacho, {
        rpm,
        redline: 6800,
        isShifting: model.isShifting,
      });
      lastTacho = rpm;
      lastShift = model.isShifting;
    }
    if (force || Math.abs(speed - lastSpeed) > 0.15 || gps !== lastGPS) {
      drawSpeedometer(speedo, { speedKmh: speed, usingLiveGPS: gps });
      lastSpeed = speed;
      lastGPS = gps;
    }
  }

  model.onChange(() => render(false));
  volume.value = String(Math.round(model.volume * 100));
  demoSpeed.value = String(Math.round(model.demoSpeedKmh));
  render(true);
}
