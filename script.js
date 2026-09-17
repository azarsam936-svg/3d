/* ============================================================================
   فلش‌کارت سه‌بعدی چشم — WebAR (MindAR image tracking + A-Frame/Three.js)
   ----------------------------------------------------------------------------
   این پروژه کاملاً استاتیک است و بدون npm/build روی GitHub Pages اجرا می‌شود.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1) قابل‌ویرایش‌ترین بخش فایل: مقیاس و موقعیت مدل سه‌بعدی
--------------------------------------------------------------------------- */
const MODEL_SCALE = 0.5;
const MODEL_POSITION_X = 0;
const MODEL_POSITION_Y = 0.15;
const MODEL_POSITION_Z = 0;
const MODEL_ROTATION_X = 90;
const MODEL_ROTATION_Y = 0;
const MODEL_ROTATION_Z = 0;

const MODEL_AUTO_FIT = true;
const MODEL_TARGET_SIZE = 1.4;

/* ---------------------------------------------------------------------------
   2) رجیستری فلش‌کارت‌ها
--------------------------------------------------------------------------- */
const CARD_REGISTRY = {
  0: {
    name: "چشم انسان",
    markerImage: "assets/eye-marker.png",
    model: "assets/u.glb",
    scale: MODEL_SCALE,
    position: { x: MODEL_POSITION_X, y: MODEL_POSITION_Y, z: MODEL_POSITION_Z },
    rotation: { x: MODEL_ROTATION_X, y: MODEL_ROTATION_Y, z: MODEL_ROTATION_Z },
  },
};

/* ============================================================================
   از این خط به پایین، منطق برنامه است
   ============================================================================ */

const el = (id) => document.getElementById(id);

const state = {
  started: false,
  cameraGranted: false,
};

/* ---------------------------------------------------------------------------
   بررسی پشتیبانی مرورگر
--------------------------------------------------------------------------- */
function browserSupportsAR() {
  const hasWebGL = (() => {
    try {
      const canvas = document.createElement("canvas");
      return !!(window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
    } catch (e) {
      return false;
    }
  })();
  const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  return hasWebGL && hasMediaDevices;
}

function showError(message, { showRetry = true } = {}) {
  el("loading-screen").classList.add("hidden");
  el("error-text").textContent = message;
  el("error-retry-btn").classList.toggle("hidden", !showRetry);
  el("error-screen").classList.remove("hidden");
}

function setLoadingText(text) {
  const node = el("loading-text");
  if (node) node.textContent = text;
}

function setProgress(pct) {
  const bar = el("progress-bar");
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

/* ---------------------------------------------------------------------------
   درخواست دسترسی دوربین
--------------------------------------------------------------------------- */
let preflightStream = null;

async function requestCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    preflightStream = stream;
    state.cameraGranted = true;
    return true;
  } catch (err) {
    state.cameraGranted = false;
    if (err && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
      showError(
        "دسترسی دوربین رد شد. برای استفاده از واقعیت افزوده، لطفاً از تنظیمات مرورگر به این سایت اجازه دسترسی به دوربین بدهید و دوباره تلاش کنید."
      );
    } else if (err && err.name === "NotFoundError") {
      showError("هیچ دوربینی روی این دستگاه پیدا نشد.");
    } else {
      showError("امکان دسترسی به دوربین وجود نداشت. لطفاً دوباره تلاش کنید.");
    }
    return false;
  }
}

function releasePreflightStream() {
  if (preflightStream) {
    preflightStream.getTracks().forEach((track) => track.stop());
    preflightStream = null;
  }
}

/* ---------------------------------------------------------------------------
   اعمال مقادیر Scale/Position/Rotation
--------------------------------------------------------------------------- */
function applyModelTransform() {
  const cfg = CARD_REGISTRY[0];
  const modelEntity = el("eye-model-entity");
  if (!modelEntity) return;
  modelEntity.setAttribute("position", cfg.position);
  modelEntity.setAttribute("rotation", cfg.rotation);
  modelEntity.setAttribute("scale", { x: cfg.scale, y: cfg.scale, z: cfg.scale });
}

let lastLoadedModelObject3D = null;

function resetModelTransform() {
  applyModelTransform();
  if (MODEL_AUTO_FIT && lastLoadedModelObject3D) {
    applyAutoFitScale(el("eye-model-entity"), lastLoadedModelObject3D);
  }
  const banner = el("status-banner");
  banner.textContent = "موقعیت مدل بازنشانی شد.";
  banner.classList.remove("hidden");
  banner.style.background = "rgba(47, 90, 168, 0.92)";
  setTimeout(() => {
    banner.classList.add("hidden");
    banner.style.background = "";
  }, 1400);
}

/* ---------------------------------------------------------------------------
   ⭐ نمایش اجباری ویدیوی دوربین
   ----------------------------------------------------------------------------
   MindAR خودش یه <video> به body اضافه می‌کنه. توی بعضی مرورگرها این ویدیو
   رندر نمی‌شه (باگ WebKit). اینجا با استایل دستی و اجبار به repaint، ویدیو
   رو قابل مشاهده می‌کنیم.
--------------------------------------------------------------------------- */
function forceShowCameraVideo() {
  const camVideo = document.querySelector("body > video");
  if (!camVideo) return false;

  // استایل‌های ضروری برای نمایش تمام‌صفحه
  camVideo.style.position = "fixed";
  camVideo.style.top = "0";
  camVideo.style.left = "0";
  camVideo.style.width = "100vw";
  camVideo.style.height = "100vh";
  camVideo.style.objectFit = "cover";
  camVideo.style.zIndex = "-1";
  camVideo.style.opacity = "1";
  camVideo.style.visibility = "visible";
  camVideo.style.display = "block";

  // اطمینان از پخش
  const playPromise = camVideo.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(() => {});
  }

  // اجبار به repaint
  camVideo.style.transform = "translateZ(0)";
  // eslint-disable-next-line no-unused-expressions
  camVideo.offsetHeight;
  camVideo.style.opacity = "0.999999";
  requestAnimationFrame(() => {
    camVideo.style.opacity = "1";
  });

  return true;
}

function nudgeCameraVideoRepaint() {
  // چندین بار با فاصله‌های مختلف امتحان می‌کنیم چون ممکن است ویدیو با تأخیر
  // به DOM اضافه شود یا اولین فریم دیر برسد.
  const delays = [0, 100, 300, 600, 1000, 1500, 2500, 4000];
  delays.forEach((delay) => {
    setTimeout(() => {
      if (!forceShowCameraVideo()) {
        // اگه ویدیو پیدا نشد، بازم تلاش می‌کنیم
        return;
      }
    }, delay);
  });

  // یه interval هم می‌ذاریم که اگه ویدیو دیرتر اضافه شد، سریع پیداش کنیم
  let attempts = 0;
  const intervalId = setInterval(() => {
    attempts++;
    const found = forceShowCameraVideo();
    if (found || attempts > 40) {
      clearInterval(intervalId);
    }
  }, 250);
}

function applyAutoFitScale(modelEntity, object3D) {
  try {
    if (!object3D || !window.AFRAME || !AFRAME.THREE) return;
    const box = new AFRAME.THREE.Box3().setFromObject(object3D);
    const size = new AFRAME.THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (!maxDim || !isFinite(maxDim)) return;
    const factor = MODEL_TARGET_SIZE / maxDim;
    modelEntity.setAttribute("scale", { x: factor, y: factor, z: factor });
  } catch (e) {
    // در صورت خطا، همان مقیاس دستی باقی می‌مونه
  }
}

/* ---------------------------------------------------------------------------
   راه‌اندازی صحنه MindAR
--------------------------------------------------------------------------- */
function initScene(clearBootWatchdog) {
  const sceneEl = el("ar-scene");
  const modelEntity = el("eye-model-entity");
  const targetEntity = el("eye-target");
  const statusBanner = el("status-banner");

  applyModelTransform();

  // پیگیری بارگذاری مدل GLB
  modelEntity.addEventListener("model-loaded", (evt) => {
    setProgress(70);
    if (MODEL_AUTO_FIT) {
      lastLoadedModelObject3D = evt.detail && evt.detail.model;
      applyAutoFitScale(modelEntity, lastLoadedModelObject3D);
    }
  });
  modelEntity.addEventListener("model-error", () => {
    showError(
      "بارگذاری مدل سه‌بعدی (assets/u.glb) ناموفق بود. مطمئن شوید فایل u.glb داخل پوشه assets قرار دارد."
    );
  });

  // نمایان/پنهان شدن مدل بر اساس دیده شدن مارکر
  targetEntity.addEventListener("targetFound", () => {
    statusBanner.classList.add("hidden");
    el("bottom-hint").textContent = "فلش‌کارت شناسایی شد ✓";
    // هر بار مارکر پیدا شد، ویدیو رو دوباره مجبور به نمایش کن
    forceShowCameraVideo();
  });
  targetEntity.addEventListener("targetLost", () => {
    statusBanner.textContent = "تصویر فلش‌کارت را مقابل دوربین قرار دهید.";
    statusBanner.style.background = "";
    statusBanner.classList.remove("hidden");
    el("bottom-hint").textContent = "فلش‌کارت را مقابل دوربین قرار دهید";
  });

  // وقتی MindAR آماده شد
  sceneEl.addEventListener("arReady", () => {
    setProgress(100);
    setLoadingText("فلش‌کارت را مقابل دوربین قرار دهید");
    setTimeout(() => {
      el("loading-screen").classList.add("hidden");
      statusBanner.classList.remove("hidden");
    }, 400);

    // ⭐ ویدیو رو نمایش بده (به جای releasePreflightStream)
    nudgeCameraVideoRepaint();
  });

  sceneEl.addEventListener("arError", () => {
    showError(
      "دسترسی به دوربین ممکن نشد یا این مرورگر از واقعیت افزوده پشتیبانی نمی‌کند. مطمئن شوید دسترسی دوربین را برای این سایت اجازه داده‌اید و از Chrome یا Safari به‌روز استفاده کنید."
    );
  });

  setProgress(85);

  // تایم‌اوت اگه arReady نیومد
  const readyTimeout = setTimeout(() => {
    if (!el("loading-screen").classList.contains("hidden")) {
      releasePreflightStream();
      showError(
        "بارگذاری واقعیت افزوده بیش از حد طول کشید. مطمئن شوید فایل assets/targets.mind به‌درستی ساخته و جایگزین شده است، سپس دوباره تلاش کنید.",
        { showRetry: true }
      );
    }
  }, 15000);

  sceneEl.addEventListener("arReady", () => clearTimeout(readyTimeout), { once: true });
  sceneEl.addEventListener("arError", () => clearTimeout(readyTimeout), { once: true });
  sceneEl.addEventListener("arReady", () => clearBootWatchdog(), { once: true });
  sceneEl.addEventListener("arError", () => clearBootWatchdog(), { once: true });

  // ⚠️ این خط حذف شد چون استریم رو قطع می‌کرد و ویدیو سیاه می‌شد:
  // sceneEl.addEventListener("arReady", () => releasePreflightStream(), { once: true });

  // فقط توی خطا استریم رو آزاد کن
  sceneEl.addEventListener("arError", () => releasePreflightStream(), { once: true });

  // شروع MindAR
  const startMindAR = () => {
    try {
      sceneEl.systems["mindar-image-system"].start();
    } catch (e) {
      showError(
        "این مرورگر از قابلیت واقعیت افزوده پشتیبانی نمی‌کند. لطفاً از Chrome یا Safari استفاده کنید."
      );
    }
  };

  if (sceneEl.systems && sceneEl.systems["mindar-image-system"]) {
    startMindAR();
  } else {
    sceneEl.addEventListener("loaded", startMindAR, { once: true });
  }
}

/* ---------------------------------------------------------------------------
   محافظ کلی در برابر خطاهای غیرمنتظره
--------------------------------------------------------------------------- */
window.addEventListener("error", () => {
  if (el("error-screen") && el("error-screen").classList.contains("hidden") &&
      el("loading-screen") && !el("loading-screen").classList.contains("hidden")) {
    showError(
      "خطایی در بارگذاری واقعیت افزوده رخ داد. لطفاً از معتبر بودن فایل‌های assets/targets.mind و assets/u.glb مطمئن شوید."
    );
  }
});

/* ---------------------------------------------------------------------------
   راه‌اندازی کلی برنامه
--------------------------------------------------------------------------- */
async function boot() {
  if (!browserSupportsAR()) {
    showError(
      "این مرورگر از قابلیت واقعیت افزوده پشتیبانی نمی‌کند. لطفاً از Chrome یا Safari استفاده کنید.",
      { showRetry: false }
    );
    return;
  }

  setLoadingText("در حال درخواست دسترسی دوربین...");
  setProgress(15);

  const granted = await requestCameraPermission();
  if (!granted) return;

  setLoadingText("در حال بارگذاری مدل سه‌بعدی...");
  setProgress(40);

  const bootWatchdog = setTimeout(() => {
    if (!el("loading-screen").classList.contains("hidden")) {
      releasePreflightStream();
      showError(
        "بارگذاری بیش از حد طول کشید. معمولاً یعنی assets/targets.mind هنوز فایل واقعیِ کامپایل‌شده نیست (یا مسیر/نام assets/u.glb اشتباه است). مطمئن شوید هر دو فایل واقعی هستند و روی GitHub Pages آپلود شده‌اند، سپس دوباره تلاش کنید."
      );
    }
  }, 20000);
  const clearBootWatchdog = () => clearTimeout(bootWatchdog);

  const sceneEl = el("ar-scene");
  if (sceneEl.hasLoaded) {
    initScene(clearBootWatchdog);
  } else {
    sceneEl.addEventListener("loaded", () => initScene(clearBootWatchdog));
  }
}

/* ---------------------------------------------------------------------------
   رویدادهای رابط کاربری
--------------------------------------------------------------------------- */
el("help-btn").addEventListener("click", () => el("help-modal").classList.remove("hidden"));
el("close-help-btn").addEventListener("click", () => el("help-modal").classList.add("hidden"));
el("help-modal").addEventListener("click", (e) => {
  if (e.target.id === "help-modal") el("help-modal").classList.add("hidden");
});

el("reset-btn").addEventListener("click", resetModelTransform);

el("error-retry-btn").addEventListener("click", () => {
  el("error-screen").classList.add("hidden");
  el("loading-screen").classList.remove("hidden");
  setProgress(0);
  boot();
});

document.addEventListener("DOMContentLoaded", boot);
