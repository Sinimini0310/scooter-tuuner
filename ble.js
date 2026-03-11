// ============================================================
// ble.js – Web Bluetooth Layer
// Connect, Disconnect, Send Queue, Receive Buffer
// ============================================================

import { BLE_UUID, TIMING } from './registers.js';
import { processIncomingChunk, resetReceiveBuffer, clearResponseWaiters, splitPacket } from './protocol.js';
import { NinebotCrypto } from './crypto.js';

// ── State ────────────────────────────────────────────────────

let bleDevice   = null;
let gattServer  = null;
let txChar      = null;
let rxChar      = null;

export let ninebotCrypto = null;
export let isConnected   = false;

// Send queue state
const sendQueue  = [];
let   isSending  = false;

// Disconnect callback (set by app.js)
let onDisconnectCallback = null;

// ── Public API ────────────────────────────────────────────────

/**
 * Register a function to call when BLE disconnects.
 * @param {Function} cb
 */
export function onDisconnect(cb) {
  onDisconnectCallback = cb;
}

/**
 * Connect to the Ninebot scooter via Web Bluetooth.
 * Starts BLE notifications on RX characteristic.
 * @returns {Promise<string>} Device name
 */
export async function bleConnect() {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth nicht unterstützt. Bitte Chrome auf Android oder Desktop nutzen.');
  }

  // Zum Debuggen: Alle Geräte anzeigen, um den echten Namen zu sehen
  bleDevice = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [BLE_UUID.UART_SERVICE],
  });
  // Produktiv: Nur passende Geräte anzeigen
  // bleDevice = await navigator.bluetooth.requestDevice({
    // filters: [
      // { namePrefix: 'YG' },
      // { namePrefix: 'Ninebot' },
      // { namePrefix: 'MIScooter' },
      // { namePrefix: 'NB' },
    // ],
    // optionalServices: [BLE_UUID.UART_SERVICE],
  // });


  bleDevice.addEventListener('gattserverdisconnected', _handleDisconnect);

  gattServer = await bleDevice.gatt.connect();
  const service = await gattServer.getPrimaryService(BLE_UUID.UART_SERVICE);

  txChar = await service.getCharacteristic(BLE_UUID.TX_CHAR);
  rxChar = await service.getCharacteristic(BLE_UUID.RX_CHAR);

  await rxChar.startNotifications();
  rxChar.addEventListener('characteristicvaluechanged', _onDataReceived);

  ninebotCrypto = new NinebotCrypto();
  isConnected   = true;

  resetReceiveBuffer();
  clearResponseWaiters();

  return bleDevice.name ?? 'Unbekanntes Gerät';
}

/**
 * Disconnect from the scooter cleanly.
 */
export function bleDisconnect() {
  if (bleDevice && bleDevice.gatt.connected) {
    bleDevice.gatt.disconnect();
  }
  _cleanupState();
}

/**
 * Queue a packet for sending. Applies MTU splitting.
 * @param {Uint8Array} packet - Raw (unencrypted) packet
 * @param {boolean} encrypt   - Whether to encrypt via NinebotCrypto
 */
export function sendPacket(packet, encrypt = false) {
  let data = packet;
  if (encrypt && ninebotCrypto && ninebotCrypto._key) {
    data = ninebotCrypto.encrypt(packet);
  }
  sendQueue.push(data);
  if (!isSending) _processQueue();
}

/**
 * Send raw bytes directly (for Methode A hex direct).
 * @param {Uint8Array} bytes
 * @param {number} times - Repeat count
 */
export async function sendRaw(bytes, times = 3) {
  for (let i = 0; i < times; i++) {
    await txChar.writeValue(bytes);
    await _delay(TIMING.BETWEEN_WRITES_MS);
  }
}

/**
 * Returns the NinebotCrypto instance.
 */
export function getCrypto() {
  return ninebotCrypto;
}

// ── Internal Queue Processing ─────────────────────────────────

async function _processQueue() {
  if (!txChar || !isConnected) {
    isSending = false;
    sendQueue.length = 0;
    return;
  }
  isSending = true;
  while (sendQueue.length > 0) {
    const pkt = sendQueue.shift();
    const chunks = splitPacket(pkt);
    for (const chunk of chunks) {
      try {
        await txChar.writeValue(chunk);
      } catch (e) {
        console.error('BLE write error:', e);
      }
      await _delay(TIMING.CHUNK_DELAY_MS);
    }
    await _delay(TIMING.QUEUE_DELAY_MS);
  }
  isSending = false;
}

// ── Data Reception ────────────────────────────────────────────

function _onDataReceived(event) {
  const raw  = new Uint8Array(event.target.value.buffer);
  let chunk  = raw;

  // Decrypt if crypto is active
  if (ninebotCrypto && ninebotCrypto._key) {
    chunk = ninebotCrypto.decrypt(raw);
  }

  processIncomingChunk(chunk, _handleCompletePacket);
}

function _handleCompletePacket(packet) {
  // Dispatched internally by processIncomingChunk via dispatchPacket
  // Additional global handler hook for app-level status updates
  if (typeof window._ninebotPacketHook === 'function') {
    window._ninebotPacketHook(packet);
  }
}

// ── Disconnect Handling ───────────────────────────────────────

function _handleDisconnect() {
  _cleanupState();
  if (typeof onDisconnectCallback === 'function') {
    onDisconnectCallback();
  }
}

function _cleanupState() {
  isConnected  = false;
  gattServer   = null;
  txChar       = null;
  rxChar       = null;
  isSending    = false;
  sendQueue.length = 0;
  resetReceiveBuffer();
  clearResponseWaiters();
  if (ninebotCrypto) {
    ninebotCrypto.reset();
  }
}

// ── Utilities ─────────────────────────────────────────────────

function _delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
