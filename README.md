# 🛴 Ninebot F2 Pro D Tuner

Eine browserbasierte Web-App zur Konfiguration des **Ninebot F2 Pro D** E-Scooters via **Web Bluetooth** (BLE307-Protokoll). Kein Download, kein Backend – läuft direkt im Chrome-Browser.

> ⚠️ **Rechtlicher Hinweis:** Das Tunen erlischt die ABE und den Versicherungsschutz. Der Betrieb getunter Scooter auf öffentlichen Straßen ist nach **StVZO §22 illegal**. Diese App darf **ausschließlich auf privatem Gelände** verwendet werden.

---

## Features

- 📡 **Verbindung** per Web Bluetooth (UART Service, MTU 20 Byte)
- ⚡ **Methode A – HEX Direct:** Speed-Modus ohne Pairing aktivieren/deaktivieren (32 km/h)
- 🔐 **Methode B – Vollprotokoll:** 3-stufiges BLE307-Pairing mit AES-128-ECB-Verschlüsselung
- 🎛️ **Tuning-Register** direkt schreiben/lesen:
  - Geschwindigkeitslimit (10–35 km/h)
  - Fahrmodus (Eco / Drive / Sport)
  - Zero Start (kein Ankicken nötig)
  - Tempomat (Cruise Control)
- 🔄 **Live-Status-Polling** (Batterie, Geschwindigkeit, Fahrmodus – alle 3s)
- 🏭 **Reset** auf Werkseinstellungen (20 km/h, Drive-Modus)

---

## Browser-Kompatibilität

| Browser | Unterstützt |
|---|---|
| Chrome / Edge (Android, Windows, Mac, Linux) | ✅ |
| Firefox | ❌ (kein Web Bluetooth) |
| Safari / iOS | ❌ (kein Web Bluetooth) |

---

## Verwendung

1. Scooter einschalten und Bluetooth aktivieren
2. App über **HTTPS** im Chrome-Browser öffnen
3. **„Verbinden"** klicken und Scooter (`YG…`) im Picker auswählen
4. **Methode A:** „Speed ON" klicken → Scooter neu starten → S-Mode in Segway-App auf Max
5. **Methode B:** „Pairen" klicken → Power-Button am Scooter drücken (max. 30s) → Einstellungen anpassen und speichern

---

## Pairing-Ablauf (Methode B)

```

Schritt 1 – Handshake (0x5B):   App ↔ BLE-Modul, Seriennummer abrufen
Schritt 2 – Key Exchange (0x5C): 16-Byte Session Key senden, Power-Button bestätigen
Schritt 3 – SN Confirm (0x5D):  Seriennummer bestätigen → Crypto-Key aktiv

```

Nach erfolgreichem Pairing werden alle Pakete mit **AES-128 (CTR-Modus, ECB-basiert)** verschlüsselt.

---

## Projektstruktur

| Datei | Beschreibung |
|---|---|
| `index.html` | UI (Views: Start, Status, Tuning, Pairing, Info) |
| `style.css` | Styling |
| `app.js` | Haupt-App-Logik, UI-State, Event-Bindings |
| `ble.js` | Web Bluetooth Layer (Connect, Send-Queue, RX-Buffer) |
| `protocol.js` | Paketbau, Checksum, MTU-Splitting, Reassembly |
| `pairing.js` | 3-stufiger BLE307 Auth-Flow |
| `crypto.js` | AES-128-ECB Implementierung (NinebotCrypto) |
| `registers.js` | Register-Map, Adressen, UUIDs, Timing-Konstanten |

---

## Technische Details

### Paketformat

```

[0x5A] [0xA5] [len] [src] [dst] [cmd] [arg] [...payload] [csLow] [csHigh]

```

- Checksum: `0xFFFF XOR Summe(inner)`, Little-Endian
- MTU: 20 Byte (Pakete werden automatisch gesplittet)

### Wichtige Register (ESC `0x20`)

| Register | Adresse | Typ | Beschreibung |
|---|---|---|---|
| `SPEED_LIMIT_ECO_DRIVE` | `0x67` | uint16 LE | Geschwindigkeit Eco/Drive |
| `SPEED_LIMIT_SPORT` | `0x68` | uint16 LE | Geschwindigkeit Sport |
| `DRIVE_MODE` | `0x7B` | uint8 | 0=Eco, 1=Drive, 2=Sport |
| `ZERO_START` | `0x7C` | uint8 | 0=off, 1=on |
| `CRUISE_CONTROL` | `0x7D` | uint8 | 0=off, 1=on |
| `BATTERY` | `0x15` | uint16 LE | Akkustand 0–100% |
| `SPEED_CURRENT` | `0xF0` | uint16 LE | Aktuelle Geschwindigkeit |

---

## Credits

- Crypto-Implementierung basiert auf [scooterhacking/NinebotCrypto](https://github.com/scooterhacking/NinebotCrypto)
- Lizenz: **AGPL-3.0**
```
