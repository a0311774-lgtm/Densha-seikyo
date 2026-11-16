import { AppModel } from "./app-model.js";
import { bindUI } from "./ui.js";

const model = new AppModel();
bindUI(model);
model.start();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && model.isUsingLiveGPS === false) {
    model.location.start();
  }
  if (document.visibilityState === "visible" && model.isEngineOn) {
    model.requestWakeLock();
  }
});
