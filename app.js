// Variables Globales d'État
let rawBeta = 0, rawGamma = 0;
let smoothBeta = 0, smoothGamma = 0;
let calibBeta = 0, calibGamma = 0;

let isAudioMuted = false;
let isFlashEnabled = true; // Activer/Désactiver le flash
let isFlashOn = false;
let videoTrack = null;
let wakeLock = null;

const SMOOTHING_FACTOR = 0.25; // Filtre de lissage
const MAX_RADIUS = 95;          // Limite de déplacement de la bulle (px)

// Sélection des éléments DOM
const bubble = document.getElementById('bubble');
const ringCenter = document.getElementById('ringCenter');
const mainAngleDisplay = document.getElementById('mainAngleDisplay');
const betaValue = document.getElementById('betaValue');
const gammaValue = document.getElementById('gammaValue');
const btnStart = document.getElementById('btnStart');
const btnCalibrate = document.getElementById('btnCalibrate');
const btnAudioToggle = document.getElementById('btnAudioToggle');
const btnFlashToggle = document.getElementById('btnFlashToggle');

// Synthèse Audio (Bip sonore)
let audioCtx = null;
let lastBeepTime = 0;

function playLevelBeep() {
  if (isAudioMuted) return;
  const now = Date.now();
  if (now - lastBeepTime < 300) return;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Note A5 (880 Hz)
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
    lastBeepTime = now;
  } catch (e) {
    console.error("Erreur Web Audio:", e);
  }
}

// Initialisation de la Caméra Arrière pour le Flash
async function initCameraFlash() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn("L'API MediaDevices n'est pas supportée sur ce navigateur.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' } // Caméra arrière
    });
    videoTrack = stream.getVideoTracks()[0];
    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    if (!capabilities.torch) {
      console.warn("Le flash/torche n'est pas géré par ce capteur ou ce navigateur.");
    }
  } catch (err) {
    console.warn("Accès caméra pour le flash refusé ou non disponible :", err.message);
  }
}

// Allumer / Éteindre la torche LED
async function setFlashlight(state) {
  if (!isFlashEnabled || !videoTrack) return;
  if (isFlashOn === state) return; // Évite les appels répétés inutiles

  try {
    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    if (capabilities.torch) {
      await videoTrack.applyConstraints({
        advanced: [{ torch: state }]
      });
      isFlashOn = state;
    }
  } catch (err) {
    console.error("Erreur de commande du flash:", err);
  }
}

// Vibration haptique
function triggerVibration() {
  if (navigator.vibrate) {
    // Motif de vibration court et réactif : vibre 100ms, pause 50ms, vibre 100ms
    navigator.vibrate([100, 50, 100]);
  }
}

// Maintien de l'écran allumé (Wake Lock API)
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.log('Wake Lock non disponible:', err.message);
  }
}

// Calcul et mise à jour de l'orientation
function updateOrientation(event) {
  if (event.beta === null || event.gamma === null) return;

  rawBeta = event.beta;   // Axe X [-180, 180]
  rawGamma = event.gamma; // Axe Y [-90, 90]

  // Prise en compte de la tare / calibration
  let adjBeta = rawBeta - calibBeta;
  let adjGamma = rawGamma - calibGamma;

  // Filtrage passe-bas pour lisser le mouvement
  smoothBeta += (adjBeta - smoothBeta) * SMOOTHING_FACTOR;
  smoothGamma += (adjGamma - smoothGamma) * SMOOTHING_FACTOR;

  let clampedBeta = Math.max(-45, Math.min(45, smoothBeta));
  let clampedGamma = Math.max(-45, Math.min(45, smoothGamma));

  let x = (clampedGamma / 45) * MAX_RADIUS;
  let y = (clampedBeta / 45) * MAX_RADIUS;

  bubble.style.transform = `translate(${x}px, ${y}px)`;

  // Angle total d'inclinaison
  let totalAngle = Math.sqrt(smoothBeta * smoothBeta + smoothGamma * smoothGamma);

  mainAngleDisplay.textContent = `${totalAngle.toFixed(1)}°`;
  betaValue.textContent = `${smoothBeta.toFixed(1)}°`;
  gammaValue.textContent = `${smoothGamma.toFixed(1)}°`;

  // --- NIVEAU PARFAIT TROUVÉ (< 0.4°) ---
  if (totalAngle < 0.4) {
    bubble.style.backgroundColor = 'var(--accent-green)';
    bubble.style.boxShadow = '0 0 25px var(--accent-green)';
    ringCenter.style.borderColor = 'var(--accent-green)';
    mainAngleDisplay.style.color = 'var(--accent-green)';

    triggerVibration();  // Active la vibration
    playLevelBeep();     // Émet le bip sonore
    setFlashlight(true); // ALLUME le Flash LED
  } else {
    // --- HORS NIVEAU ---
    bubble.style.backgroundColor = 'var(--accent-red)';
    bubble.style.boxShadow = '0 0 20px var(--accent-red)';
    ringCenter.style.borderColor = 'rgba(255, 255, 255, 0.4)';
    mainAngleDisplay.style.color = 'var(--text-main)';

    setFlashlight(false); // ÉTEINT le Flash LED dès qu'on quitte le niveau
  }
}

// Initialisation au clic sur le bouton
async function initSensors() {
  // Demander l'accès à la caméra pour le flash
  await initCameraFlash();

  // Autorisation des capteurs d'orientation (iOS 13+ & Android)
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission === 'granted') {
        window.addEventListener('deviceorientation', updateOrientation, true);
        btnStart.style.display = 'none';
        requestWakeLock();
      } else {
        alert("Permission refusée pour accéder aux capteurs d'orientation.");
      }
    } catch (e) {
      alert("Erreur permission: " + e.message);
    }
  } else if ('DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', updateOrientation, true);
    btnStart.style.display = 'none';
    requestWakeLock();
  } else {
    alert("Les capteurs d'orientation ne sont pas supportés sur cet appareil.");
  }
}

// Événements boutons
btnStart.addEventListener('click', initSensors);

btnCalibrate.addEventListener('click', () => {
  calibBeta = rawBeta;
  calibGamma = rawGamma;
  if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
  alert("Calibration effectuée ! Référence 0.0° mise à jour.");
});

btnAudioToggle.addEventListener('click', () => {
  isAudioMuted = !isAudioMuted;
  btnAudioToggle.classList.toggle('active', !isAudioMuted);
  btnAudioToggle.innerHTML = isAudioMuted ? '🔇' : '🔊';
});

if (btnFlashToggle) {
  btnFlashToggle.addEventListener('click', () => {
    isFlashEnabled = !isFlashEnabled;
    btnFlashToggle.classList.toggle('active', isFlashEnabled);
    btnFlashToggle.innerHTML = isFlashEnabled ? '⚡' : '🚫⚡';
    if (!isFlashEnabled) setFlashlight(false);
  });
}

// Enregistrement Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker enregistré:', reg.scope))
      .catch(err => console.error('Échec enregistrement SW:', err));
  });
}
