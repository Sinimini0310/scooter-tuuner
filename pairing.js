// ============================================================
// pairing.js – BLE307 3-Step Pairing / Auth Flow
// Steps: 0x5B (Handshake) → 0x5C (Key Exchange) → 0x5D (SN Confirm)
// ============================================================

import { buildPacket, waitForResponse, withTimeout } from './protocol.js';
import { ADDR, CMD, TIMING } from './registers.js';
import { sendPacket, getCrypto } from './ble.js';

// ── Pairing State ─────────────────────────────────────────────

let serialNumber = null;  // 14-byte Uint8Array
let sessionKey   = null;  // 16-byte Uint8Array

// Progress callback: called with (step: 1|2|3, message: string)
let progressCallback = null;

export function onPairingProgress(cb) {
  progressCallback = cb;
}

function reportProgress(step, message) {
  if (typeof progressCallback === 'function') {
    progressCallback(step, message);
  }
}

// ── Public: Start Pairing ─────────────────────────────────────

/**
 * Execute the full 3-step BLE307 pairing.
 * Resolves when pairing is complete.
 * @returns {Promise<void>}
 * @throws {Error} on timeout or protocol failure
 */
export async function startPairing() {
  serialNumber = null;
  sessionKey   = null;

  await _step1_Handshake();
  await _step2_KeyExchange();
  await _step3_ConfirmSerialNumber();

  // Register key with crypto module
  const crypto = getCrypto();
  if (crypto) {
    crypto.setKey(sessionKey);
  }
}

// ── Step 1: Handshake (0x5B) ──────────────────────────────────

async function _step1_Handshake() {
  reportProgress(1, 'Verbindung wird hergestellt…');

  const packet = buildPacket(ADDR.APP, ADDR.BLE, CMD.HANDSHAKE, 0x00);

  // Retry up to 3 times
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      sendPacket(packet, false);

      const response = await withTimeout(
        waitForResponse(CMD.HANDSHAKE),
        TIMING.RESPONSE_TIMEOUT_MS,
        'Handshake Timeout – Kein Gerät gefunden'
      );

      _parseHandshakeResponse(response);
      reportProgress(1, 'Handshake erfolgreich');
      await _delay(200);
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await _delay(500);
    }
  }
}

function _parseHandshakeResponse(packet) {
  // Response payload starts at byte 7
  // Serial Number is at payload bytes 13–26 (14 bytes)
  const payload = packet.slice(7, packet.length - 2);

  if (payload.length < 27) {
    // Fallback: use whatever we got as placeholder SN
    serialNumber = new Uint8Array(14).fill(0x00);
    return;
  }

  // Serial number: bytes 13..26 in payload (0-indexed)
  serialNumber = payload.slice(13, 27);
}

// ── Step 2: Key Exchange (0x5C) ───────────────────────────────

async function _step2_KeyExchange() {
  reportProgress(2, 'Drücke den Power-Button am Scooter!');

  // Fix: use globalThis.crypto explicitly to avoid conflict with getCrypto() import
  sessionKey = globalThis.crypto.getRandomValues(new Uint8Array(16));

  const packet = buildPacket(ADDR.APP, ADDR.BLE, CMD.SEND_KEY, 0x00, Array.from(sessionKey));

  // Keep sending every 1s until button pressed (max 30s)
  const deadline = Date.now() + TIMING.PAIRING_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let responseReceived = false;

    // Register one-time response handler
    const responsePromise = waitForResponse(CMD.SEND_KEY);
    responsePromise
      .then((response) => {
        responseReceived = true;
        clearInterval(retryInterval);
        const ackByte = response[7]; // First payload byte after header
        if (ackByte === 0x01) {
          reportProgress(2, 'Button gedrückt – Pairing erfolgreich');
          resolve();
        } else {
          reject(new Error(`Key Exchange fehlgeschlagen – ACK: 0x${ackByte.toString(16)}`));
        }
      })
      .catch((err) => {
        // Fix: propagate errors from waitForResponse (e.g. timeout) to the outer Promise
        clearInterval(retryInterval);
        reject(err);
      });

    // Send key packet every second
    const retryInterval = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(retryInterval);
        if (!responseReceived) {
          reject(new Error('Pairing Timeout – Power-Button nicht gedrückt'));
        }
        return;
      }
      if (!responseReceived) {
        sendPacket(packet, false);
      }
    }, TIMING.PAIRING_RETRY_MS);

    // Send immediately on first call
    sendPacket(packet, false);
  });
}

// ── Step 3: Confirm Serial Number (0x5D) ─────────────────────

async function _step3_ConfirmSerialNumber() {
  reportProgress(3, 'Seriennummer wird bestätigt…');

  if (!serialNumber) {
    throw new Error('Keine Seriennummer aus Handshake erhalten');
  }

  const packet = buildPacket(
    ADDR.APP,
    ADDR.BLE,
    CMD.CONFIRM_SN,
    0x00,
    Array.from(serialNumber)
  );

  sendPacket(packet, false);

  const response = await withTimeout(
    waitForResponse(CMD.CONFIRM_SN),
    TIMING.RESPONSE_TIMEOUT_MS,
    'Seriennummer-Bestätigung Timeout'
  );

  const ackByte = response[7];
  if (ackByte !== 0x01) {
    throw new Error(`SN-Bestätigung fehlgeschlagen – ACK: 0x${ackByte.toString(16)}`);
  }

  await _delay(200);
  reportProgress(3, 'Pairing vollständig abgeschlossen!');
}

// ── Utility ───────────────────────────────────────────────────

function _delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
