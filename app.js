// ============================================================
// app.js – Main Application Logic
// UI state management, Method A (hex direct) & Method B (full protocol)
// ============================================================

import { bleConnect, bleDisconnect, sendRaw, sendPacket, onDisconnect, isConnected } from './ble.js';
import { buildPacket, waitForResponse, withTimeout, parsePacket, readUint16LE } from './protocol.js';
import { ADDR, CMD, REG, PRESET, DRIVE_MODE_NAMES, HEX_DIRECT, TIMING } from './registers.js';
import { startPairing, onPairingProgress } from './pairing.js';

// ── App State ─────────────────────────────────────────────────

const state = {
  connected:    false,
  paired:       false,
  deviceName:   '',
  battery:      0,
  speed:        0,
  driveMode:    1,
  speedLimit:   20,
  zeroStart:    false,
  cruiseCtrl:   false,
  statusInterval: null,
};

// ── DOM Element Cache ─────────────────────────────────────────

const el = {};

function cacheElements() {
  const ids = [
    'view-start','view-status','view-tuning','view-info','view-pairing',
    'btn-connect','btn-disconnect','btn-reconnect',
    'btn-speed-on','btn-speed-off',
    'btn-pair','btn-apply-all','btn-reset-all',
    'device-name','battery-value','speed-value','mode-value',
    'slider-speed','slider-speed-value',
    'toggle-zero-start','toggle-cruise',
    'select-drive-mode',
    'pairing-status','pairing-step',
    'toast-container',
    'loading-overlay','loading-text',
  ];
  for (const id of ids) {
    el[id] = document.getElementById(id);
  }
}

// ── View Navigation ───────────────────────────────────────────

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(viewId);
  if (view) view.classList.add('active');
}

// ── Toast Notifications ───────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
  const container = el['toast-container'];
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span class="toast-msg">${message}</span>
  `;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ── Loading Overlay ───────────────────────────────────────────

function showLoading(text = 'Bitte warten…') {
  if (el['loading-overlay']) {
    el['loading-text'].textContent = text;
    el['loading-overlay'].classList.add('visible');
  }
}

function hideLoading() {
  if (el['loading-overlay']) {
    el['loading-overlay'].classList.remove('visible');
  }
}

// ── Connection ────────────────────────────────────────────────

async function handleConnect() {
  showLoading('Verbinde mit Scooter…');
  try {
    const name = await bleConnect();
    state.connected = true;
    state.deviceName = name;

    if (el['device-name']) el['device-name'].textContent = name;

    showView('view-status');
    showToast(`Verbunden: ${name}`, 'success');
    startStatusPolling();
  } catch (e) {
    showToast(e.message || 'Verbindung fehlgeschlagen', 'error');
  } finally {
    hideLoading();
  }
}

function handleDisconnect() {
  stopStatusPolling();
  bleDisconnect();
  state.connected = false;
  state.paired    = false;
  showView('view-start');
  showToast('Verbindung getrennt', 'info');
}

onDisconnect(() => {
  stopStatusPolling();
  state.connected = false;
  state.paired    = false;
  showView('view-start');
  showToast('Verbindung unterbrochen', 'error');
});

// ── Method A: HEX Direct ─────────────────────────────────────

async function handleSpeedOn() {
  if (!state.connected) { showToast('Nicht verbunden', 'error'); return; }
  showLoading('Speed-Modus wird aktiviert…');
  try {
    // Import sendRaw from ble.js (already imported above)
    const { sendRaw: rawSend } = await import('./ble.js');
    await rawSend(HEX_DIRECT.SPEED_ON, 3);
    showToast('Speed-Modus aktiviert! Scooter neu starten + S-Mode auf Max setzen.', 'success', 5000);
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

async function handleSpeedOff() {
  if (!state.connected) { showToast('Nicht verbunden', 'error'); return; }
  showLoading('Normal-Modus wird wiederhergestellt…');
  try {
    const { sendRaw: rawSend } = await import('./ble.js');
    await rawSend(HEX_DIRECT.SPEED_OFF, 3);
    showToast('Normal-Modus (20 km/h) wiederhergestellt', 'success');
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ── Method B: Full Protocol Pairing ──────────────────────────

async function handlePair() {
  if (!state.connected) { showToast('Nicht verbunden', 'error'); return; }

  showView('view-pairing');
  el['pairing-status'].textContent = 'Pairing wird gestartet…';

  onPairingProgress((step, message) => {
    el['pairing-step'].textContent  = `Schritt ${step}/3`;
    el['pairing-status'].textContent = message;
  });

  try {
    await startPairing();
    state.paired = true;
    await _delay(500);
    showView('view-tuning');
    await loadCurrentSettings();
    showToast('Pairing erfolgreich – Einstellungen geladen', 'success');
  } catch (e) {
    showToast('Pairing fehlgeschlagen: ' + e.message, 'error');
    showView('view-status');
  }
}

// ── Register Read / Write ─────────────────────────────────────

async function readRegister(register) {
  const pkt = buildPacket(ADDR.APP, ADDR.ESC, CMD.READ, register, [0x02, 0x00]);
  sendPacket(pkt, true);

  const response = await withTimeout(
    waitForResponse(CMD.ACK_READ),
    TIMING.RESPONSE_TIMEOUT_MS,
    `Register 0x${register.toString(16)} Read Timeout`
  );

  const parsed = parsePacket(response);
  return readUint16LE(parsed.payload, 0);
}

async function writeRegister(register, value) {
  const lo = value & 0xFF;
  const hi = (value >> 8) & 0xFF;
  const pkt = buildPacket(ADDR.APP, ADDR.ESC, CMD.WRITE, register, [lo, hi]);
  sendPacket(pkt, true);

  await withTimeout(
    waitForResponse(CMD.ACK_WRITE),
    TIMING.RESPONSE_TIMEOUT_MS,
    `Register 0x${register.toString(16)} Write Timeout`
  );
}

async function readWriteRegister(register, value) {
  await readRegister(register);  // Read before write
  await _delay(100);
  await writeRegister(register, value);
}

// ── Load Current Settings ─────────────────────────────────────

async function loadCurrentSettings() {
  if (!state.paired) return;
  try {
    const speedLimit = await readRegister(REG.SPEED_LIMIT_ECO_DRIVE);
    const driveMode  = await readRegister(REG.DRIVE_MODE);
    const zeroStart  = await readRegister(REG.ZERO_START);
    const cruiseCtrl = await readRegister(REG.CRUISE_CONTROL);

    state.speedLimit = speedLimit;
    state.driveMode  = driveMode;
    state.zeroStart  = zeroStart === 1;
    state.cruiseCtrl = cruiseCtrl === 1;

    updateTuningUI();
  } catch (e) {
    showToast('Einstellungen konnten nicht geladen werden: ' + e.message, 'error');
  }
}

function updateTuningUI() {
  if (el['slider-speed']) {
    el['slider-speed'].value = state.speedLimit;
    el['slider-speed-value'].textContent = state.speedLimit + ' km/h';
  }
  if (el['select-drive-mode']) el['select-drive-mode'].value = state.driveMode;
  if (el['toggle-zero-start']) el['toggle-zero-start'].checked = state.zeroStart;
  if (el['toggle-cruise'])     el['toggle-cruise'].checked     = state.cruiseCtrl;
}

// ── Apply All Settings ────────────────────────────────────────

async function handleApplyAll() {
  if (!state.paired) { showToast('Bitte erst pairen', 'error'); return; }

  const speedLimit = parseInt(el['slider-speed']?.value ?? 20);
  const driveMode  = parseInt(el['select-drive-mode']?.value ?? 1);
  const zeroStart  = el['toggle-zero-start']?.checked ? 1 : 0;
  const cruiseCtrl = el['toggle-cruise']?.checked ? 1 : 0;

  showLoading('Einstellungen werden gespeichert…');
  try {
    await readWriteRegister(REG.SPEED_LIMIT_ECO_DRIVE, speedLimit);
    await readWriteRegister(REG.SPEED_LIMIT_SPORT, Math.min(speedLimit, 32));
    await readWriteRegister(REG.DRIVE_MODE, driveMode);
    await readWriteRegister(REG.ZERO_START, zeroStart);
    await readWriteRegister(REG.CRUISE_CONTROL, cruiseCtrl);

    state.speedLimit = speedLimit;
    state.driveMode  = driveMode;
    state.zeroStart  = zeroStart === 1;
    state.cruiseCtrl = cruiseCtrl === 1;

    showToast('Alle Einstellungen gespeichert!', 'success');
  } catch (e) {
    showToast('Fehler beim Speichern: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ── Reset All Settings ────────────────────────────────────────

async function handleResetAll() {
  if (!state.paired) { showToast('Bitte erst pairen', 'error'); return; }

  if (!confirm('Alle Einstellungen auf Standardwerte zurücksetzen?')) return;

  showLoading('Zurücksetzen auf Standardwerte…');
  try {
    const p = PRESET.NORMAL;
    await readWriteRegister(REG.SPEED_LIMIT_ECO_DRIVE, p[REG.SPEED_LIMIT_ECO_DRIVE]);
    await readWriteRegister(REG.SPEED_LIMIT_SPORT,     p[REG.SPEED_LIMIT_SPORT]);
    await readWriteRegister(REG.DRIVE_MODE,            p[REG.DRIVE_MODE]);
    await readWriteRegister(REG.ZERO_START,            p[REG.ZERO_START]);
    await readWriteRegister(REG.CRUISE_CONTROL,        p[REG.CRUISE_CONTROL]);

    state.speedLimit = p[REG.SPEED_LIMIT_ECO_DRIVE];
    state.driveMode  = p[REG.DRIVE_MODE];
    state.zeroStart  = false;
    state.cruiseCtrl = false;

    updateTuningUI();
    showToast('Standardwerte wiederhergestellt', 'success');
  } catch (e) {
    showToast('Reset fehlgeschlagen: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ── Live Status Polling ───────────────────────────────────────

function startStatusPolling() {
  stopStatusPolling();
  state.statusInterval = setInterval(async () => {
    if (!state.connected) return;
    try {
      const battery = await readRegister(REG.BATTERY);
      const speed   = await readRegister(REG.SPEED_CURRENT);
      const mode    = await readRegister(REG.DRIVE_MODE);

      state.battery   = Math.min(100, Math.max(0, battery));
      state.speed     = speed;
      state.driveMode = mode;

      updateStatusUI();
    } catch (_) {
      // Silent – status polling, non-critical
    }
  }, 3000);
}

function stopStatusPolling() {
  if (state.statusInterval) {
    clearInterval(state.statusInterval);
    state.statusInterval = null;
  }
}

function updateStatusUI() {
  if (el['battery-value']) el['battery-value'].textContent = `${state.battery}%`;
  if (el['speed-value'])   el['speed-value'].textContent   = `${state.speed} km/h`;
  if (el['mode-value'])    el['mode-value'].textContent    = DRIVE_MODE_NAMES[state.driveMode] ?? '–';

  // Update battery bar if present
  const bar = document.getElementById('battery-bar');
  if (bar) {
    bar.style.width = `${state.battery}%`;
    bar.className = 'battery-fill ' +
      (state.battery > 50 ? 'high' : state.battery > 20 ? 'mid' : 'low');
  }
}

// ── Slider Live Update ────────────────────────────────────────

function bindSlider() {
  const slider = el['slider-speed'];
  const label  = el['slider-speed-value'];
  if (!slider || !label) return;

  slider.addEventListener('input', () => {
    label.textContent = slider.value + ' km/h';
  });
}

// ── Nav Tab ───────────────────────────────────────────────────

function bindNavTabs() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      showView(target);
      document.querySelectorAll('[data-nav]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// ── Button Event Bindings ─────────────────────────────────────

function bindEvents() {
  el['btn-connect']?.addEventListener('click', handleConnect);
  el['btn-disconnect']?.addEventListener('click', handleDisconnect);
  el['btn-reconnect']?.addEventListener('click', handleConnect);

  el['btn-speed-on']?.addEventListener('click', handleSpeedOn);
  el['btn-speed-off']?.addEventListener('click', handleSpeedOff);

  el['btn-pair']?.addEventListener('click', handlePair);
  el['btn-apply-all']?.addEventListener('click', handleApplyAll);
  el['btn-reset-all']?.addEventListener('click', handleResetAll);

  bindSlider();
  bindNavTabs();
}

// ── Utility ───────────────────────────────────────────────────

function _delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  showView('view-start');
});
