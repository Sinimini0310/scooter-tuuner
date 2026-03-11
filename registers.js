// ============================================================
// registers.js – Ninebot F2 Pro D Register Map
// All register addresses and value constants
// ============================================================

// ── Device Addresses ─────────────────────────────────────────
export const ADDR = {
  APP:  0x3E,   // Smartphone / App (sender)
  ESC:  0x20,   // Motor Controller (Fahrt-Einstellungen)
  BLE:  0x21,   // BLE Module (Pairing / Auth)
  BMS:  0x22,   // Battery Management System
};

// ── Command Codes ─────────────────────────────────────────────
export const CMD = {
  READ:           0x01,   // Read register  → ACK: 0x04
  WRITE:          0x02,   // Write register → ACK: 0x05
  WRITE_NO_ACK:   0x03,   // Write without ACK
  ACK_READ:       0x04,   // Read response
  ACK_WRITE:      0x05,   // Write response
  HANDSHAKE:      0x5B,   // Pairing Step 1
  SEND_KEY:       0x5C,   // Pairing Step 2
  CONFIRM_SN:     0x5D,   // Pairing Step 3
};

// ── ESC Registers (Address 0x20) ──────────────────────────────
export const REG = {
  // ─ Speed / Drive Settings ─
  SPEED_LIMIT_ECO_DRIVE:  0x67,   // uint16 LE, km/h (Eco + Drive mode limit)
  SPEED_LIMIT_SPORT:      0x68,   // uint16 LE, km/h (Sport mode limit)
  DRIVE_MODE:             0x7B,   // uint8: 0=Eco, 1=Drive, 2=Sport
  ZERO_START:             0x7C,   // uint8: 0=off, 1=on (no push needed)
  CRUISE_CONTROL:         0x7D,   // uint8: 0=off, 1=on

  // ─ Read-Only Status ─
  SPEED_CURRENT:          0xF0,   // uint16 LE, km/h (current speed)
  BATTERY:                0x15,   // uint16 LE, 0–100 (battery %)
  TOTAL_DISTANCE:         0x25,   // uint32 LE, meters (total odometer)
  FIRMWARE_VERSION:       0x10,   // uint16 LE (firmware version)
};

// ── Register Value Presets ─────────────────────────────────────
export const PRESET = {
  NORMAL: {
    [REG.SPEED_LIMIT_ECO_DRIVE]: 20,
    [REG.SPEED_LIMIT_SPORT]:     20,
    [REG.ZERO_START]:             0,
    [REG.CRUISE_CONTROL]:         0,
    [REG.DRIVE_MODE]:             1,  // Drive
  },
  TUNED: {
    [REG.SPEED_LIMIT_ECO_DRIVE]: 35,
    [REG.SPEED_LIMIT_SPORT]:     32,
    [REG.ZERO_START]:             1,
    [REG.CRUISE_CONTROL]:         1,
    [REG.DRIVE_MODE]:             2,  // Sport
  },
};

// ── Drive Mode Names ──────────────────────────────────────────
export const DRIVE_MODE_NAMES = {
  0: 'Eco',
  1: 'Drive',
  2: 'Sport',
};

// ── Speed Limits ──────────────────────────────────────────────
export const SPEED = {
  MIN: 10,   // Minimum tunable speed (km/h)
  MAX: 35,   // Maximum speed (km/h)
  DEFAULT: 20,
};

// ── Methode A: HEX-Direktmethode ─────────────────────────────
// These byte sequences activate Speed Mode without crypto/pairing
export const HEX_DIRECT = {
  SPEED_ON:  new Uint8Array([0x55,0xAB,0x46,0x32,0x53,0x63,0x6F,0x6F,0x74,0x65,0x72,0x5F,0x31]),
  SPEED_OFF: new Uint8Array([0x55,0xAB,0x46,0x32,0x53,0x63,0x6F,0x6F,0x74,0x65,0x72,0x5F,0x30]),
};

// ── BLE Service UUIDs ─────────────────────────────────────────
export const BLE_UUID = {
  UART_SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  TX_CHAR:      '6e400002-b5a3-f393-e0a9-e50e24dcca9e',  // Write
  RX_CHAR:      '6e400003-b5a3-f393-e0a9-e50e24dcca9e',  // Notify
};

// ── Timings ───────────────────────────────────────────────────
export const TIMING = {
  BETWEEN_WRITES_MS:   200,  // Delay between consecutive BLE writes
  QUEUE_DELAY_MS:      100,  // Delay between queued packets
  CHUNK_DELAY_MS:       50,  // Delay between MTU chunks
  RESPONSE_TIMEOUT_MS: 3000, // Max wait for ACK
  PAIRING_TIMEOUT_MS: 30000, // Max wait for Power button press
  PAIRING_RETRY_MS:   1000,  // Resend interval during pairing step 2
};
