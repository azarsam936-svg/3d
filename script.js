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
const MODEL_SCALE = 0.5;       // مقیاس یکنواخت مدل (بزرگ/کوچک کردن چشم) — ۱۰ برابرِ مقدار قبلی (0.05)
const MODEL_POSITION_X = 0;    // جابه‌جایی چپ/راست نسبت به مرکز فلش‌کارت
const MODEL_POSITION_Y = 0.15; // ارتفاع مدل بالای سطح فلش‌کارت
const MODEL_POSITION_Z = 0;    // جابه‌جایی جلو/عقب نسبت به مرکز فلش‌کارت
const MODEL_ROTATION_X = -90;  // چرخش حول محور X (برای مدل‌هایی که "به پشت خوابیده" اکسپورت شده‌اند معمولاً 90- یا 90 لازم است)
const MODEL_ROTATION_Y = 0;    // چرخش حول محور Y
const MODEL_ROTATION_Z = 0;    // چرخش حول محور Z

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
   بررسی وجود دوربین، بدون باز کردن جریان تصویر (getUserMedia)
   ----------------------------------------------------------------------------
   نکته‌ی مهم/رفع اشکال: نسخه‌ی قبلی این تابع یک‌بار خودش getUserMedia را صدا
   می‌زد (فقط برای گرفتن مجوز) و بلافاصله همان جریان را stop() می‌کرد، و بعد
   MindAR دوباره و جداگانه دوربین را باز می‌کرد. این الگو (باز کردن و فوراً
   بستن دوربین، سپس باز کردن دوباره) در بسیاری از مرورگرهای موبایل (به‌خصوص
   iOS Safari و برخی نسخه‌های Chrome اندروید) باعث می‌شود درخواست دومِ MindAR
   در وضعیتی «گیر کند»: ردیابی مارکر کار می‌کند (چون از فریم‌های تصویر برای
   پردازش استفاده می‌شود) اما خودِ تگ <video> هرگز پخش واقعی را نشان نمی‌دهد و
   به‌جایش یک پس‌زمینه‌ی خاکستری/تیره‌ی ثابت دیده می‌شود. برای رفع این مشکل،
   دیگر دوربین را از قبل باز و بسته نمی‌کنیم؛ فقط با enumerateDevices (که به
   مجوز نیاز ندارد و هیچ جریانی باز نمی‌کند) وجود دوربین را بررسی می‌کنیم و
   اجازه می‌دهیم MindAR تنها و یگانه درخواست getUserMedia را خودش انجام دهد.
--------------------------------------------------------------------------- */
async function checkCameraAvailability() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCamera = devices.some((d) => d.kind === "videoinput");
    if (!hasCamera) {
      showError("هیچ دوربینی روی این دستگاه پیدا نشد.");
      return false;
    }
    return true;
  } catch (e) {
    // اگر enumerateDevices در دسترس نبود یا خطا داد، به MindAR اجازه می‌دهیم
    // خودش تلاش کند؛ خطای واقعی دوربین (رد مجوز و غیره) از طریق رویداد
    // arError در initScene() نمایش داده می‌شود.
    return true;
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

function resetModelTransform() {
  applyModelTransform();
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
   راه‌اندازی صحنه MindAR پس از آماده شدن مدل و گرفتن مجوز دوربین
--------------------------------------------------------------------------- */
function initScene() {
  const sceneEl = el("ar-scene");
  const modelEntity = el("eye-model-entity");
  const targetEntity = el("eye-target");
  const statusBanner = el("status-banner");

  applyModelTransform();

  // پیگیری بارگذاری مدل GLB
  let modelLoaded = false;
  modelEntity.addEventListener("model-loaded", () => {
    modelLoaded = true;
    setProgress(70);
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
      showError(
        "بارگذاری واقعیت افزوده بیش از حد طول کشید. مطمئن شوید فایل assets/targets.mind به‌درستی ساخته و جایگزین شده است، سپس دوباره تلاش کنید.",
        { showRetry: true }
      );
    }
  }, 15000);

  sceneEl.addEventListener("arReady", () => clearTimeout(readyTimeout), { once: true });
  sceneEl.addEventListener("arError", () => clearTimeout(readyTimeout), { once: true });

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

  setLoadingText("در حال آماده‌سازی دوربین...");
  setProgress(15);

  const hasCamera = await checkCameraAvailability();
  if (!hasCamera) return;

  setLoadingText("در حال بارگذاری مدل سه‌بعدی...");
  setProgress(40);

  const sceneEl = el("ar-scene");
  if (sceneEl.hasLoaded) {
    initScene();
  } else {
    sceneEl.addEventListener("loaded", initScene);
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
