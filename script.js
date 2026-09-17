/* ============================================================================
   فلش‌کارت سه‌بعدی چشم — WebAR (MindAR image tracking + A-Frame/Three.js)
   ----------------------------------------------------------------------------
   این پروژه کاملاً استاتیک است و بدون npm/build روی GitHub Pages اجرا می‌شود.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1) قابل‌ویرایش‌ترین بخش فایل: مقیاس و موقعیت مدل سه‌بعدی
   این مقادیر مستقیماً روی <a-entity id="eye-model-entity"> در index.html اعمال
   می‌شوند. اعداد را تغییر بده و صفحه را رفرش کن تا نتیجه را ببینی.
   واحد position بر حسب "واحد مارکر" است (مارکر یک مربع به ضلع 1 در نظر گرفته
   می‌شود)، rotation بر حسب درجه است.
--------------------------------------------------------------------------- */
const MODEL_SCALE = 0.5;       // فقط وقتی MODEL_AUTO_FIT=false باشد استفاده می‌شود (بزرگ‌نمایی دستی)
const MODEL_POSITION_X = 0;    // جابه‌جایی چپ/راست نسبت به مرکز فلش‌کارت
const MODEL_POSITION_Y = 0.15; // ارتفاع مدل بالای سطح فلش‌کارت
const MODEL_POSITION_Z = 0;    // جابه‌جایی جلو/عقب نسبت به مرکز فلش‌کارت
const MODEL_ROTATION_X = -90;  // چرخش حول محور X (برای مدل‌هایی که "به پشت خوابیده" اکسپورت شده‌اند معمولاً 90- یا 90 لازم است)
const MODEL_ROTATION_Y = 0;    // چرخش حول محور Y
const MODEL_ROTATION_Z = 0;    // چرخش حول محور Z

/* ---------------------------------------------------------------------------
   بزرگ‌نمایی خودکار (رفع اشکال «۱۰ برابر هم کم بود»)
   ----------------------------------------------------------------------------
   دلیل اینکه هر بار عدد MODEL_SCALE را ۱۰ برابر می‌کردیم و باز هم کوچک بود
   این است: فایل‌های GLB هرکدام با «واحد» متفاوتی ساخته/اکسپورت می‌شوند (مثلاً
   بعضی مدل‌ها در مقیاس واقعی چند متری صادر می‌شوند)، پس یک عدد ثابت برای همه‌ی
   مدل‌ها کار نمی‌کند. راه‌حل درست: به‌جای حدس زدن، ابعاد واقعی مدل (bounding
   box) را بعد از بارگذاری اندازه می‌گیریم و خودمان مقیاس لازم را حساب می‌کنیم
   تا بزرگ‌ترین ضلع مدل دقیقاً برابر MODEL_TARGET_SIZE (بر حسب واحد فلش‌کارت،
   یعنی ۱ = هم‌عرض خودِ کارت) بشود.
--------------------------------------------------------------------------- */
const MODEL_AUTO_FIT = true;   // true = بزرگ‌نمایی خودکار بر اساس ابعاد واقعی مدل (پیشنهادی)
const MODEL_TARGET_SIZE = 1.4; // اندازه‌ی هدف مدل نسبت به عرض فلش‌کارت — عدد بزرگ‌تر = مدل بزرگ‌تر (۱٫۴ یعنی کمی بزرگ‌تر از خودِ کارت)

/* ---------------------------------------------------------------------------
   2) رجیستری فلش‌کارت‌ها — برای افزودن کارت‌های جدید (سلول گیاهی، قلب، مغز...)
   اگر فایل targets.mind را با چند تصویر هدف در کنار هم کامپایل کنی، هر تصویر
   یک targetIndex می‌گیرد (0، 1، 2 ...). کافی‌ست این آبجکت را گسترش بدهی و یک
   <a-entity mindar-image-target="targetIndex: N"> متناظر در index.html اضافه کنی.
   به بخش README.md → "افزودن فلش‌کارت جدید" مراجعه کن.
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
  // مثال برای کارت بعدی:
  // 1: {
  //   name: "سلول گیاهی",
  //   markerImage: "assets/plant-cell-marker.png",
  //   model: "assets/plant-cell.glb",
  //   scale: 0.04,
  //   position: { x: 0, y: 0.1, z: 0 },
  //   rotation: { x: -90, y: 0, z: 0 },
  // },
};

/* ============================================================================
   از این خط به پایین، منطق برنامه است — نیازی به تغییر آن نیست.
   ============================================================================ */

const el = (id) => document.getElementById(id);

const state = {
  started: false,
  cameraGranted: false,
};

/* ---------------------------------------------------------------------------
   بررسی پشتیبانی مرورگر پیش از هر کاری
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
   درخواست صریح دسترسی دوربین (پیام فارسی مناسب در صورت رد شدن)
   ----------------------------------------------------------------------------
   نکته‌ی مهم/رفع اشکال: در یک نسخه‌ی قبلی، این تابع بلافاصله بعد از گرفتن
   مجوز، استریم را stop() می‌کرد و بعد MindAR جداگانه دوباره دوربین را باز
   می‌کرد؛ همین "باز و بستنِ سریع" باعث می‌شد در برخی مرورگرهای موبایل ویدیوی
   زنده نمایش داده نشود (پس‌زمینه‌ی خاکستری). اما حذفِ کاملِ این درخواست هم
   خودش باعث شد که در برخی دستگاه‌ها بارگذاری هرگز کامل نشود. راه‌حل درست:
   درخواست اولیه را نگه می‌داریم (چون بدون آن روند بارگذاری MindAR در برخی
   مرورگرها به مشکل می‌خورد)، ولی دیگر فوراً stop() نمی‌کنیم — استریم را زنده
   نگه می‌داریم تا وقتی MindAR واقعاً آماده شود (رویداد arReady)، و فقط در
   آن لحظه (یا در صورت خطا/تایم‌اوت، برای پاک‌سازی) آزادش می‌کنیم.
--------------------------------------------------------------------------- */
let preflightStream = null;

async function requestCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    preflightStream = stream; // عمداً اینجا stop نمی‌شود؛ نگاه کن به releasePreflightStream()
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
   اعمال مقادیر Scale/Position/Rotation از تنظیمات بالای فایل روی مدل
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
   رفع اشکالِ «تصویر دوربین به‌صورت خاکستری ثابت دیده می‌شود ولی ردیابی کار می‌کند»
   ----------------------------------------------------------------------------
   این دقیقاً یک باگِ شناخته‌شده در برخی نسخه‌های Safari/WKWebView (از جمله
   iOS 18) است: جریان زنده‌ی دوربین واقعاً در حال پخش است و فریم‌های واقعی
   دریافت می‌شود (برای همین ردیابیِ MindAR درست کار می‌کند — چون از همان
   فریم‌ها برای پردازش استفاده می‌کند)، اما مرورگر به‌صورت بصری آن را روی
   صفحه رندر (paint) نمی‌کند تا وقتی یک repaint واقعی اتفاق بیفتد (مثلاً
   کاربر روی نوار آدرس مرورگر ضربه بزند). خودِ ویدیو توسط MindAR به‌صورت
   پویا و بدون id به body اضافه می‌شود (body > video)، بنابراین اینجا با
   یک سلکتور ساده پیدایش می‌کنیم و با یک تغییر جزئی و بی‌اثر روی استایلش
   مرورگر را مجبور به رندر مجدد آن می‌کنیم.
--------------------------------------------------------------------------- */
function nudgeCameraVideoRepaint() {
  const tryNudge = () => {
    const camVideo = document.querySelector("body > video");
    if (!camVideo) return;
    camVideo.play().catch(() => {});
    // اجبار به repaint: یک تغییر بی‌اثر ولی واقعی روی style
    camVideo.style.transform = "translateZ(0)";
    // eslint-disable-next-line no-unused-expressions
    camVideo.offsetHeight; // خواندن layout باعث flush شدن استایل می‌شود
    camVideo.style.opacity = "0.999999";
    requestAnimationFrame(() => {
      camVideo.style.opacity = "1";
    });
  };
  // چند بار در فاصله‌های کوتاه امتحان می‌کنیم چون ممکن است اولین فریمِ واقعی
  // کمی دیرتر از رویداد arReady برسد.
  [100, 500, 1200, 2500].forEach((delay) => setTimeout(tryNudge, delay));
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
    // اگر محاسبه به هر دلیلی شکست خورد، همان مقیاس دستیِ MODEL_SCALE
    // (که قبلاً توسط applyModelTransform اعمال شده) باقی می‌ماند.
  }
}

/* ---------------------------------------------------------------------------
   راه‌اندازی صحنه MindAR پس از آماده شدن مدل و گرفتن مجوز دوربین
--------------------------------------------------------------------------- */
function initScene(clearBootWatchdog) {
  const sceneEl = el("ar-scene");
  const modelEntity = el("eye-model-entity");
  const targetEntity = el("eye-target");
  const statusBanner = el("status-banner");

  applyModelTransform();

  // پیگیری بارگذاری مدل GLB
  let modelLoaded = false;
  modelEntity.addEventListener("model-loaded", (evt) => {
    modelLoaded = true;
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
  });
  targetEntity.addEventListener("targetLost", () => {
    statusBanner.textContent = "تصویر فلش‌کارت را مقابل دوربین قرار دهید.";
    statusBanner.style.background = "";
    statusBanner.classList.remove("hidden");
    el("bottom-hint").textContent = "فلش‌کارت را مقابل دوربین قرار دهید";
  });

  // وقتی MindAR کاملاً آماده شد (دوربین گرفته شد و tracker بارگذاری شد)
  sceneEl.addEventListener("arReady", () => {
    setProgress(100);
    setLoadingText("فلش‌کارت را مقابل دوربین قرار دهید");
    setTimeout(() => {
      el("loading-screen").classList.add("hidden");
      statusBanner.classList.remove("hidden");
    }, 400);
    nudgeCameraVideoRepaint();
  });

  sceneEl.addEventListener("arError", () => {
    showError(
      "دسترسی به دوربین ممکن نشد یا این مرورگر از واقعیت افزوده پشتیبانی نمی‌کند. مطمئن شوید دسترسی دوربین را برای این سایت اجازه داده‌اید (تنظیمات مرورگر ← Site settings ← Camera) و از Chrome یا Safari به‌روز استفاده کنید، سپس دوباره تلاش کنید."
    );
  });

  setProgress(85);

  // اگر به هر دلیلی (مثلاً targets.mind هنوز جایگزین نشده) رویداد آماده‌بودن
  // هرگز شلیک نشود، بعد از چند ثانیه پیام خطای مناسب نشان می‌دهیم به‌جای
  // اینکه کاربر برای همیشه پشت صفحه‌ی بارگذاری بماند.
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
  sceneEl.addEventListener("arReady", () => releasePreflightStream(), { once: true });
  sceneEl.addEventListener("arError", () => releasePreflightStream(), { once: true });

  // شروع MindAR (چون autoStart:false گذاشته‌ایم، خودمان کنترل شروع را داریم)
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
   محافظ کلی در برابر خطاهای غیرمنتظره (مثلاً فایل targets.mind نامعتبر)
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

  /* -------------------------------------------------------------------------
     محافظ کلیِ کل فرآیند بارگذاری (رفع اشکال)
     ---------------------------------------------------------------------
     قبلاً یک تایم‌اوت فقط داخل initScene() تعریف شده بود، یعنی اگر صحنه‌ی
     A-Frame اصلاً به رویداد "loaded" نمی‌رسید (مثلاً چون assets/targets.mind
     هنوز فایل placeholder است یا مسیر assets/u.glb اشتباه است)، initScene()
     هرگز اجرا نمی‌شد و در نتیجه هیچ تایم‌اوتی هم فعال نمی‌شد — کاربر برای
     همیشه پشت صفحه‌ی «در حال بارگذاری مدل سه‌بعدی...» می‌ماند. این محافظِ
     بیرونی از همین‌جا (قبل از منتظر ماندن برای رویداد "loaded") شروع می‌شود
     و مستقل از initScene() است.
  --------------------------------------------------------------------------- */
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
