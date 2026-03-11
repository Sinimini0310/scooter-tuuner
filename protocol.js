// ============================================================
// protocol.js – Ninebot BLE Protocol
// Packet building, checksum, splitting, reassembly, parsing
// ============================================================

// ── Packet Builder ───────────────────────────────────────────

/**
 * Calculate 16-bit XOR checksum over inner bytes.
 * inner = [srcAddr, dstAddr, cmd, arg, ...payload]
 * Returns [lowByte, highByte] (Little-Endian)
 */
export function calcChecksum(inner) {
  let sum = 0;
  for (const b of inner) sum += b;
  const cs = 0xFFFF ^ (sum & 0xFFFF);
  return [cs & 0xFF, (cs >> 8) & 0xFF];
}

/**
 * Build a complete Ninebot BLE packet.
 * @param {number} srcAddr  - Sender address (0x3E = App)
 * @param {number} dstAddr  - Target address (0x20=ESC, 0x21=BLE, 0x22=BMS)
 * @param {number} cmd      - Command byte
 * @param {number} arg      - Argument / register address
 * @param {number[]} payload - Payload bytes (default: empty)
 * @returns {Uint8Array}
 */
export function buildPacket(srcAddr, dstAddr, cmd, arg, payload = []) {
  const inner = [srcAddr, dstAddr, cmd, arg, ...payload];
  const [csLow, csHigh] = calcChecksum(inner);
  return new Uint8Array([0x5A, 0xA5, payload.length, ...inner, csLow, csHigh]);
}

// ── MTU Splitting ────────────────────────────────────────────

const BLE_MTU = 20;

/**
 * Split a packet into 20-byte BLE chunks.
 * @param {Uint8Array} packet
 * @returns {Uint8Array[]}
 */
export function splitPacket(packet) {
  const chunks = [];
  for (let i = 0; i < packet.length; i += BLE_MTU) {
    chunks.push(packet.slice(i, i + BLE_MTU));
  }
  return chunks;
}

// ── Receive Buffer & Reassembly ──────────────────────────────

let receiveBuffer = new Uint8Array(0);
const packetHandlers = new Map(); // cmd → resolve function

/**
 * Append incoming BLE chunk to the receive buffer and
 * extract any complete packets.
 * @param {Uint8Array} chunk
 * @param {Function} onPacket  - Called with each complete Uint8Array packet
 */
export function processIncomingChunk(chunk, onPacket) {
  // Merge chunk into buffer
  const merged = new Uint8Array(receiveBuffer.length + chunk.length);
  merged.set(receiveBuffer);
  merged.set(chunk, receiveBuffer.length);
  receiveBuffer = merged;

  // Extract complete packets
  while (receiveBuffer.length >= 4) {
    // Resync: find start bytes 0x5A 0xA5
    if (receiveBuffer[0] !== 0x5A || receiveBuffer[1] !== 0xA5) {
      receiveBuffer = receiveBuffer.slice(1);
      continue;
    }

    const payloadLen = receiveBuffer[2];
    // Total: 2 header + 1 len + 4 (src,dst,cmd,arg) + payloadLen + 2 checksum
    const totalLen = 2 + 1 + 4 + payloadLen + 2;

    if (receiveBuffer.length < totalLen) break; // Not yet complete

    const fullPacket = receiveBuffer.slice(0, totalLen);
    receiveBuffer = receiveBuffer.slice(totalLen);

    if (isValidPacket(fullPacket)) {
      onPacket(fullPacket);
      dispatchPacket(fullPacket);
    }
  }
}

/** Reset the receive buffer (call on disconnect) */
export function resetReceiveBuffer() {
  receiveBuffer = new Uint8Array(0);
}

// ── Packet Validation ────────────────────────────────────────

/**
 * Verify checksum of a received packet.
 * @param {Uint8Array} packet
 * @returns {boolean}
 */
export function isValidPacket(packet) {
  if (packet.length < 7) return false;
  if (packet[0] !== 0x5A || packet[1] !== 0xA5) return false;

  const payloadLen = packet[2];
  const expectedLen = 2 + 1 + 4 + payloadLen + 2;
  if (packet.length < expectedLen) return false;

  // Inner bytes: from index 3 to index (3 + 4 + payloadLen - 1)
  const innerEnd = 3 + 4 + payloadLen;
  const inner = packet.slice(3, innerEnd);
  const [csLow, csHigh] = calcChecksum(Array.from(inner));

  return packet[innerEnd] === csLow && packet[innerEnd + 1] === csHigh;
}

// ── Response Waiter ──────────────────────────────────────────

/**
 * Return a Promise that resolves when a packet with the given
 * command byte is received.
 * @param {number} expectedCmd
 * @returns {Promise<Uint8Array>}
 */
export function waitForResponse(expectedCmd) {
  return new Promise((resolve) => {
    packetHandlers.set(expectedCmd, resolve);
  });
}

function dispatchPacket(packet) {
  const cmd = packet[5]; // cmd is at offset 5 in the full packet
  if (packetHandlers.has(cmd)) {
    const resolve = packetHandlers.get(cmd);
    packetHandlers.delete(cmd);
    resolve(packet);
  }
}

/** Clear all pending response waiters (call on disconnect) */
export function clearResponseWaiters() {
  packetHandlers.clear();
}

// ── Timeout Wrapper ──────────────────────────────────────────

/**
 * Race a promise against a timeout.
 * @param {Promise} promise
 * @param {number} ms       - Timeout in milliseconds
 * @param {string} errorMsg - Error message on timeout
 */
export function withTimeout(promise, ms, errorMsg) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(errorMsg)), ms)
  );
  return Promise.race([promise, timeout]);
}

// ── Packet Parser ────────────────────────────────────────────

/**
 * Parse a validated complete packet into its fields.
 * @param {Uint8Array} packet
 * @returns {{ srcAddr, dstAddr, cmd, arg, payload }}
 */
export function parsePacket(packet) {
  const payloadLen = packet[2];
  return {
    srcAddr:  packet[3],
    dstAddr:  packet[4],
    cmd:      packet[5],
    arg:      packet[6],
    payload:  packet.slice(7, 7 + payloadLen),
  };
}

/**
 * Read a uint16 Little-Endian value from a payload starting at offset.
 */
export function readUint16LE(payload, offset = 0) {
  return payload[offset] | (payload[offset + 1] << 8);
}

/**
 * Read a uint32 Little-Endian value from a payload starting at offset.
 */
export function readUint32LE(payload, offset = 0) {
  return (
    payload[offset] |
    (payload[offset + 1] << 8) |
    (payload[offset + 2] << 16) |
    (payload[offset + 3] << 24)
  ) >>> 0;
}
