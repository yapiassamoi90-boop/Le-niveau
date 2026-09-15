// Variables d'état
let rawBeta = 0, rawGamma = 0;
let smoothBeta = 0, smoothGamma = 0;
let calibBeta = 0, calibGamma = 0;

let isAudioMuted = false;
let isFlashEnabled = true;
let isFlashOn = false;
let videoTrack = null;
let wakeLock = null;

// Mode de mesure : 'auto', 'surface' (plat), 'mur' (vertical)
let currentMode = 'auto'; 
let activeDisplayMode = 'surface'; // 'surface' ou 'mur'

const SMOOTHING_FACTOR = 0.25;
const MAX_RADIUS_SURFACE = 90; // px
const MAX_SHIFT_MUR = 110;     // px

// Éléments DOM
const targetSurface = document.getElementById('targetSurface');
const targetMur = document.getElementById('targetMur');
const bubbleSurface = document.getElementById('bubbleSurface');
const bubbleMur = document.getElementById('bubbleMur');
const ringCenter = document.getElementById('ringCenter');
const modeBadge = document.getElementById('modeBadge');
const mainAngleDisplay = document.getElementById('mainAngleDisplay');
const betaValue = document.getElementById('betaValue');
const gammaValue = document.getElementById('gammaValue');

const btnStart = document.getElementById('btnStart');
const btnCalibrate = document.getElementById('btnCalibrate');
const btnModeToggle = document.getElementById('btnModeToggle');
const btnAudioToggle = document.getElementById('btnAudioToggle');
const btnFlashToggle = document.getElementById('btnFlashToggle');

let audioCtx = null;
let lastBeepTime = 0;

// Bip sonore de niveau
function playLevelBeep() {
  if (isAudioMuted) return;
  const now = Date.now();
  if (now - lastBeepTime < 300) return;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
    lastBeepTime = now;
  } catch (e) {
    console.error("Audio error:", e);
  }
}

// Initialisation Caméra pour le Flash
async function initCameraFlash() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    videoTrack = stream.getVideoTracks()[0];
  } catch (err) {
    console.warn("Flash non disponible:", err.message);
  }
}

// Contrôle de la Torche LED
async function setFlashlight(state) {
  if (!isFlashEnabled || !videoTrack) return;
  if (isFlashOn === state) return;

  try {
    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    if (capabilities.torch) {
      await videoTrack.applyConstraints({ advanced: [{ torch: state }] });
      isFlashOn = state;
    }
  } catch (err) {
    console.error("Erreur Flash:", err);
  }
}

function triggerVibration() {
  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 100]);
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {}
}

// Mise à jour principale de l'orientation
function updateOrientation(event) {
  if (event.beta === null || event.gamma === null) return;

  rawBeta = event.beta;
  rawGamma = event.gamma;

  let adjBeta = rawBeta - calibBeta;
  let adjGamma = rawGamma - calibGamma;

  smoothBeta += (adjBeta - smoothBeta) * SMOOTHING_FACTOR;
  smoothGamma += (adjGamma - smoothGamma) * SMOOTHING_FACTOR;

  // Détection du mode (Plat vs Mur)
  if (currentMode === 'auto') {
    // Si le téléphone est redressé à plus de 50° par rapport à la table -> Mode Mur (Tableau)
    if (Math.abs(smoothBeta) > 50 || Math.abs(smoothGamma) > 50) {
      activeDisplayMode = 'mur';
    } else {
      activeDisplayMode = 'surface';
    }
  } else {
    activeDisplayMode = currentMode;
  }

  let totalAngle = 0;
  let isPerfectLevel = false;

  if (activeDisplayMode === 'surface') {
    // MODE PLAT (SOL / TABLE)
    targetSurface.style.display = 'flex';
    targetMur.style.display = 'none';
    modeBadge.textContent = 'Mode : Surface (Sol / Table)';

    let clampedBeta = Math.max(-45, Math.min(45, smoothBeta));
    let clampedGamma = Math.max(-45, Math.min(45, smoothGamma));

    let x = (clampedGamma / 45) * MAX_RADIUS_SURFACE;
    let y = (clampedBeta / 45) * MAX_RADIUS_SURFACE;

    bubbleSurface.style.transform = `translate(${x}px, ${y}px)`;
    totalAngle = Math.sqrt(smoothBeta * smoothBeta + smoothGamma * smoothGamma);
    isPerfectLevel = totalAngle < 0.4;

  } else {
    // MODE MUR (TABLEAU / CADRE)
    targetSurface.style.display = 'none';
    targetMur.style.display = 'flex';
    modeBadge.textContent = 'Mode : Mur / Tableau de classe';

    // En mode mur, l'inclinaison du tableau correspond à gamma
    let clampedGamma = Math.max(-30, Math.min(30, smoothGamma));
    let x = (clampedGamma / 30) * MAX_SHIFT_MUR;

    bubbleMur.style.transform = `translateX(${x}px)`;
    totalAngle = Math.abs(smoothGamma);
    isPerfectLevel = totalAngle < 0.4;
  }

  // Affichage des textes
  mainAngleDisplay.textContent = `${totalAngle.toFixed(1)}°`;
  betaValue.textContent = `${smoothBeta.toFixed(1)}°`;
  gammaValue.textContent = `${smoothGamma.toFixed(1)}°`;

  // --- ACTIONS QUAND LE NIVEAU EST TROUVÉ ---
  if (isPerfectLevel) {
    // Vert Néon / Réussite
    const greenGradient = 'radial-gradient(circle at 30% 30%, #a7f3d0 0%, #10b981 60%, #047857 100%)';
    bubbleSurface.style.background = greenGradient;
    bubbleMur.style.background = greenGradient;

    mainAngleDisplay.style.color = 'var(--accent-green)';
    ringCenter.style.borderColor = 'var(--accent-green)';

    triggerVibration();
    playLevelBeep();
    setFlashlight(true); // ALLUME LE FLASH LED
  } else {
    // Rouge Coral / Non de niveau
    const redGradient = 'radial-gradient(circle at 30% 30%, #fca5a5 0%, #ef4444 60%, #b91c1c 100%)';
    bubbleSurface.style.background = redGradient;
    bubbleMur.style.background = redGradient;

    mainAngleDisplay.style.color = 'var(--accent-blue)';
    ringCenter.style.borderColor = 'var(--accent-blue)';

    setFlashlight(false); // ÉTEINT LE FLASH LED
  }
}

// Initialisation
async function initSensors() {
  await initCameraFlash();

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission === 'granted') {
        window.addEventListener('deviceorientation', updateOrientation, true);
        btnStart.style.display = 'none';
        requestWakeLock();
      }
    } catch (e) {
      alert("Erreur permission capteurs: " + e.message);
    }
  } else if ('DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', updateOrientation, true);
    btnStart.style.display = 'none';
    requestWakeLock();
  }
}

// Boutons
btnStart.addEventListener('click', initSensors);

btnCalibrate.addEventListener('click', () => {
  calibBeta = rawBeta;
  calibGamma = rawGamma;
  if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
  alert("Étalonnage réussi (Référence 0.0° fixée).");
});

btnModeToggle.addEventListener('click', () => {
  if (currentMode === 'auto') currentMode = 'surface';
  else if (currentMode === 'surface') currentMode = 'mur';
  else currentMode = 'auto';

  btnModeToggle.textContent = currentMode === 'auto' ? '🔄 Auto' : (currentMode === 'surface' ? '📐 Plat' : '🧱 Mur');
});

btnAudioToggle.addEventListener('click', () => {
  isAudioMuted = !isAudioMuted;
  btnAudioToggle.classList.toggle('active', !isAudioMuted);
  btnAudioToggle.innerHTML = isAudioMuted ? '🔇' : '🔊';
});

btnFlashToggle.addEventListener('click', () => {
  isFlashEnabled = !isFlashEnabled;
  btnFlashToggle.classList.toggle('active', isFlashEnabled);
  btnFlashToggle.innerHTML = isFlashEnabled ? '⚡' : '🚫⚡';
  if (!isFlashEnabled) setFlashlight(false);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}
