import { MuseCircularBuffer } from "./CircularBuffer.js";

/**
 * An abstract base class for interfaces that connect to a Muse headband.
 * Supports both legacy Muse devices (Muse 2016, Muse 2) and Muse S Athena.
 */
export class MuseBase {
  // Legacy Muse service UUID (Muse 2016, Muse 2)
  #LEGACY_SERVICE = 0xfe8d;
  // 221e Muse v3 Custom Service — also used by Interaxon Muse S Athena which
  // embeds a 221e IMU module.  Interaxon EEG characteristics (273e-...) and
  // 221e IMU characteristics (CMD/DATA) both live under this service.
  #MUSE_S_SERVICE = "c8c0a708-e361-4b5e-a365-98fa6b0a836f";
  
  #CONTROL_CHARACTERISTIC = "273e0001-4c4d-454d-96be-f03bac821358";
  #BATTERY_CHARACTERISTIC = "273e000b-4c4d-454d-96be-f03bac821358";
  #GYROSCOPE_CHARACTERISTIC = "273e0009-4c4d-454d-96be-f03bac821358";
  #ACCELEROMETER_CHARACTERISTIC = "273e000a-4c4d-454d-96be-f03bac821358";
  #PPG1_CHARACTERISTIC = "273e000f-4c4d-454d-96be-f03bac821358";
  #PPG2_CHARACTERISTIC = "273e0010-4c4d-454d-96be-f03bac821358";
  #PPG3_CHARACTERISTIC = "273e0011-4c4d-454d-96be-f03bac821358";
  
  // Legacy Muse EEG characteristics (Muse 2016, Muse 2)
  #EEG1_CHARACTERISTIC = "273e0003-4c4d-454d-96be-f03bac821358";
  #EEG2_CHARACTERISTIC = "273e0004-4c4d-454d-96be-f03bac821358";
  #EEG3_CHARACTERISTIC = "273e0005-4c4d-454d-96be-f03bac821358";
  #EEG4_CHARACTERISTIC = "273e0006-4c4d-454d-96be-f03bac821358";
  #EEG5_CHARACTERISTIC = "273e0007-4c4d-454d-96be-f03bac821358";
  
  // Muse S Athena EEG characteristics (new multiplexed format)
  #ATHENA_EEG1_CHARACTERISTIC = "273e0013-4c4d-454d-96be-f03bac821358";
  #ATHENA_EEG2_CHARACTERISTIC = "273e0014-4c4d-454d-96be-f03bac821358";
  #ATHENA_EEG3_CHARACTERISTIC = "273e0015-4c4d-454d-96be-f03bac821358";
  
  // 221e Muse v3 TLV protocol characteristics — these stream IMU sensor data
  // (accelerometer, gyroscope, magnetometer) using binary Type-Length-Value
  // encoding per the 221e protocol spec (docs.221e.com).  NOT EEG data.
  // Kept for diagnostic/reference but not routed to EEG parsers.
  #V3_CMD_CHARACTERISTIC = "d5913036-2d8a-41ee-85b9-4e361aa5c8a7";
  #V3_DATA_CHARACTERISTIC = "09bf2c52-d1d9-c0b7-4145-475964544307";
  
  #state = 0;
  #dev = null;
  #controlChar = null;
  #infoFragment = "";
  #activeService = null;
  #isAthena = false;

  constructor(options = {}) {
    if (new.target === MuseBase) {
      throw new TypeError("Cannot construct MuseBase instances directly");
    }
    this.mock = options.mock || false;
    this.mockDataPath =
      options.mockDataPath ||
      new URL("../../assets/resting-state.csv", import.meta.url).href;
    this.mockDataIndex = 0;
    this.mockInterval = null;
    this.mockData = null;
  }

  get state() {
    return this.#state;
  }

  get modelName() {
    if (this.#isAthena) {
      return 'Muse Athena';
    }
    return 'Muse 2';
  }

  batteryData(event) {}
  accelerometerData(event) {}
  gyroscopeData(event) {}
  controlData(event) {}
  eegData(n, event) {}
  athenaEegData(n, event) {}
  ppgData(n, event) {}
  disconnected() {}
  devicePicked(deviceName) {}

  #decodeInfo(bytes) {
    return new TextDecoder().decode(bytes.subarray(1, 1 + bytes[0]));
  }

  #decodeUnsigned24BitData(samples) {
    const samples24Bit = [];
    for (let i = 0; i < samples.length; i += 3) {
      samples24Bit.push(
        (samples[i] << 16) | (samples[i + 1] << 8) | samples[i + 2]
      );
    }
    return samples24Bit;
  }

  #decodeUnsigned12BitData(samples) {
    const samples12Bit = [];
    for (let i = 0; i < samples.length; i++) {
      if (i % 3 === 0) {
        samples12Bit.push((samples[i] << 4) | (samples[i + 1] >> 4));
      } else {
        samples12Bit.push(((samples[i] & 0xf) << 8) | samples[i + 1]);
        i++;
      }
    }
    return samples12Bit;
  }

  #encodeCommand(cmd) {
    const encoded = new TextEncoder().encode(`X${cmd}\n`);
    encoded[0] = encoded.length - 1;
    return encoded;
  }

  eventBatteryData(event) {
    let data = event.target.value;
    data = data.buffer ? data : new DataView(data);
    return data.getUint16(2) / 512;
  }

  motionData(dv, scale, ofs) {
    return [
      scale * dv.getInt16(ofs),
      scale * dv.getInt16(ofs + 2),
      scale * dv.getInt16(ofs + 4),
    ];
  }

  eventAccelerometerData(event) {
    const scale = 0.0000610352;
    let data = event.target.value;
    data = data.buffer ? data : new DataView(data);
    let accelerometer = [[], [], []];
    for (let ofs = 2; ofs <= 14; ofs += 6) {
      const vals = this.motionData(data, scale, ofs);
      accelerometer[0].push(vals[0]);
      accelerometer[1].push(vals[1]);
      accelerometer[2].push(vals[2]);
    }
    return accelerometer;
  }

  eventGyroscopeData(event) {
    const scale = 0.0074768;
    let data = event.target.value;
    data = data.buffer ? data : new DataView(data);
    let gyroscope = [[], [], []];
    for (let ofs = 2; ofs <= 14; ofs += 6) {
      const vals = this.motionData(data, scale, ofs);
      gyroscope[0].push(vals[0]);
      gyroscope[1].push(vals[1]);
      gyroscope[2].push(vals[2]);
    }
    return gyroscope;
  }

  eventControlData(event) {
    let data = event.target.value;
    data = data.buffer ? data : new DataView(data);
    const buf = new Uint8Array(data.buffer);
    
    // Log raw control data to understand Athena protocol
    console.log("[web-muse] Control data:", Array.from(buf.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    const str = this.#decodeInfo(buf);
    let info = {};
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      this.#infoFragment = this.#infoFragment + c;
      if (c === "}") {
        try {
          const tmp = JSON.parse(this.#infoFragment);
          this.#infoFragment = "";
          for (const key in tmp) {
            info[key] = tmp[key];
          }
        } catch (e) {
          // Incomplete or malformed JSON fragment, continue accumulating
          // This can happen with nested objects or Muse S Athena's different format
        }
      }
    }
    return info;
  }

  eventEEGData(event) {
    let data = event.target.value;
    data = data.buffer ? data : new DataView(data);
    return this.#decodeUnsigned12BitData(
      new Uint8Array(data.buffer).subarray(2)
    );
  }

  eventPPGData(event) {
    let data = event.target.value;
    data = data.buffer ? data : new DataView(data);
    return this.#decodeUnsigned24BitData(
      new Uint8Array(data.buffer).subarray(2)
    );
  }

  async #sendCommand(cmd) {
    if (this.#controlChar) {
      await this.#controlChar["writeValue"](this.#encodeCommand(cmd));
    }
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async #pause() {
    await this.#sendCommand("h");
  }

  async #resume() {
    await this.#sendCommand("d");
  }

  async #start() {
    await this.#pause();
    await this.#sendCommand("p50");
    await this.#sendCommand("s");
    await this.#resume();
  }

  disconnect() {
    if (this.mock) {
      this.#stopMockDataStream();
    }
    if (this.#dev) this.#dev["gatt"]["disconnect"]();
    this.#dev = null;
    this.#state = 0;
    this.disconnected();
  }

  async #connectCharOptional(service, cid, hook) {
    try {
      const c = await service["getCharacteristic"](cid);
      c["oncharacteristicvaluechanged"] = (event) => {
        hook(event);
      };
      await c["startNotifications"]();
      console.log(`[web-muse] Connected to characteristic ${cid}`);
      return c;
    } catch (e) {
      console.log(`[web-muse] Characteristic ${cid} not available:`, e.message);
      return null;
    }
  }

  async #loadMockData() {
    try {
      const response = await fetch(this.mockDataPath);
      const text = await response.text();
      const lines = text.trim().split("\n");

      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",");
        if (values.length >= 5) {
          data.push({
            timestamp: parseFloat(values[0]),
            eeg: [
              parseFloat(values[1]),
              parseFloat(values[2]),
              parseFloat(values[3]),
              parseFloat(values[4]),
            ],
          });
        }
      }
      return data;
    } catch (error) {
      console.error("Failed to load mock data:", error);
      throw error;
    }
  }

  #startMockDataStream() {
    if (!this.mockData || this.mockData.length === 0) {
      console.error("No mock data available");
      return;
    }

    this.mockDataIndex = 0;
    const that = this;

    const feedNextSample = () => {
      if (!that.mock || that.#state !== 2) {
        return;
      }

      const currentSample = that.mockData[that.mockDataIndex];
      const nextIndex = (that.mockDataIndex + 1) % that.mockData.length;
      const nextSample = that.mockData[nextIndex];

      let delay = 4;
      if (currentSample.timestamp && nextSample.timestamp) {
        delay = nextSample.timestamp - currentSample.timestamp;
        if (delay < 0) {
          delay = 4;
        }
      }

      for (let i = 0; i < 4; i++) {
        const mockEvent = {
          target: {
            value: that.#createMockEEGData(currentSample.eeg[i]),
          },
        };
        that.eegData(i, mockEvent);
      }

      that.mockDataIndex = nextIndex;
      that.mockInterval = setTimeout(feedNextSample, delay);
    };

    feedNextSample();
  }

  #createMockEEGData(value) {
    const unsigned12bit = Math.max(
      0,
      Math.min(0xfff, Math.round(value / 0.48828125 + 0x800))
    );

    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);

    for (let i = 0; i < 12; i++) {
      const byteOffset = 2 + Math.floor(i * 1.5);
      if (i % 2 === 0) {
        uint8[byteOffset] = (unsigned12bit >> 4) & 0xff;
        uint8[byteOffset + 1] =
          ((unsigned12bit & 0x0f) << 4) | ((unsigned12bit >> 8) & 0x0f);
      } else {
        uint8[byteOffset] =
          (uint8[byteOffset] & 0xf0) | ((unsigned12bit >> 8) & 0x0f);
        uint8[byteOffset + 1] = unsigned12bit & 0xff;
      }
    }

    return view;
  }

  #stopMockDataStream() {
    if (this.mockInterval) {
      clearTimeout(this.mockInterval);
      this.mockInterval = null;
    }
  }

  async connect() {
    if (this.#dev || this.#state !== 0) {
      return;
    }
    this.#state = 1;

    // Mock mode
    if (this.mock) {
      try {
        console.log("[web-muse] Connecting in mock mode...");
        this.mockData = await this.#loadMockData();
        console.log(`[web-muse] Loaded ${this.mockData.length} samples from mock data`);
        this.#state = 2;
        this.#startMockDataStream();
        return;
      } catch (error) {
        console.error("[web-muse] Failed to connect in mock mode:", error);
        this.#state = 0;
        throw error;
      }
    }

    // Real device connection - try multiple service UUIDs
    console.log("[web-muse] Requesting Bluetooth device (supports Muse S Athena and legacy Muse)...");
    
    // V3 protocol service UUID (Muse S Gen2 / Athena)
    const V3_SERVICE = "feed6b64-4cf5-11ee-be56-0242ac120002";
    
    try {
      // Request device filtered by service UUIDs only - this ensures Chrome
      // pre-authorizes the services and getPrimaryService() won't hang.
      // DO NOT add namePrefix filter - it causes service discovery to hang
      // because Chrome matches the device by name without authorizing any service.
      this.#dev = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [this.#LEGACY_SERVICE] },
          { services: [this.#MUSE_S_SERVICE] },
          { services: [V3_SERVICE] }
        ],
        optionalServices: [V3_SERVICE, this.#LEGACY_SERVICE, this.#MUSE_S_SERVICE]
      });
      console.log("[web-muse] Device selected:", this.#dev.name);
      this.devicePicked(this.#dev.name || 'Muse');
    } catch (error) {
      console.error("[web-muse] requestDevice error:", error);
      this.#dev = null;
      this.#state = 0;
      throw error;
    }

    let gatt;
    try {
      gatt = await this.#dev.gatt.connect();
      console.log("[web-muse] GATT connected");
    } catch (error) {
      console.error("[web-muse] GATT connect error:", error);
      this.#dev = null;
      this.#state = 0;
      throw error;
    }

    // Discover all available services on this device.
    // A device matched by the V3 filter may also expose the Muse S or legacy
    // service where the actual EEG/control characteristics live.
    const availableServices = [];
    const serviceLabels = [];
    const serviceUUIDs = [
      { uuid: this.#LEGACY_SERVICE, label: "legacy" },
      { uuid: this.#MUSE_S_SERVICE, label: "Muse S" },
      { uuid: V3_SERVICE, label: "V3" },
    ];

    console.log("[web-muse] Discovering available services...");
    for (const { uuid, label } of serviceUUIDs) {
      try {
        const svc = await gatt.getPrimaryService(uuid);
        availableServices.push(svc);
        serviceLabels.push(label);
        console.log(`[web-muse] Found ${label} service`);
      } catch (e) {
        // Service not available on this device
      }
    }

    if (availableServices.length === 0) {
      console.error("[web-muse] No compatible Muse service found");
      this.#dev = null;
      this.#state = 0;
      throw new Error("No compatible Muse service found on device");
    }

    this.#activeService = serviceLabels[0];
    console.log(`[web-muse] Available services: ${serviceLabels.join(", ")} — using ${serviceLabels[0]} as primary`);

    const that = this;
    this.#dev.addEventListener("gattserverdisconnected", function () {
      that.#dev = null;
      that.#state = 0;
      that.disconnected();
    });

    // Helper: try to connect a characteristic across all available services.
    // Arrow function to preserve `this` for private field access.
    const connectCharAcrossServices = async (charUUID, hook) => {
      for (const svc of availableServices) {
        const result = await this.#connectCharOptional(svc, charUUID, hook);
        if (result) return result;
      }
      return null;
    };

    // Connect to characteristics - try each across all available services
    this.#controlChar = await connectCharAcrossServices(
      this.#CONTROL_CHARACTERISTIC,
      (event) => that.controlData(event)
    );

    // Detect device type FIRST by probing Athena EEG characteristics.
    // This must happen before requesting battery/gyro/accel, because
    // Athena firmware in p50 multiplexed mode disables those dedicated
    // characteristics (000b, 0009, 000a, 0004-0007).  On Athena, battery
    // arrives via embedded 0x88/0x98 subpackets and IMU via 0x47 ACCGYRO
    // inside the multiplexed EEG stream.
    const athenaChar1 = await connectCharAcrossServices(
      this.#ATHENA_EEG1_CHARACTERISTIC,
      (event) => that.athenaEegData(0, event)
    );

    const athenaChar2 = await connectCharAcrossServices(
      this.#ATHENA_EEG2_CHARACTERISTIC,
      (event) => that.athenaEegData(1, event)
    );

    const athenaChar3 = await connectCharAcrossServices(
      this.#ATHENA_EEG3_CHARACTERISTIC,
      (event) => that.athenaEegData(2, event)
    );

    if (athenaChar1 || athenaChar2 || athenaChar3) {
      this.#isAthena = true;
      console.log("[web-muse] Detected Muse S Athena - using multiplexed EEG format");
      console.log("[web-muse] Skipping dedicated battery/gyro/accel characteristics (disabled in p50 mode)");
    } else {
      // Legacy Muse — connect dedicated sensor characteristics
      console.log("[web-muse] Detected legacy Muse - connecting dedicated sensor characteristics");

      await connectCharAcrossServices(
        this.#BATTERY_CHARACTERISTIC,
        (event) => that.batteryData(event)
      );

      await connectCharAcrossServices(
        this.#GYROSCOPE_CHARACTERISTIC,
        (event) => that.gyroscopeData(event)
      );

      await connectCharAcrossServices(
        this.#ACCELEROMETER_CHARACTERISTIC,
        (event) => that.accelerometerData(event)
      );

      // Legacy EEG characteristics (0003-0007)
      await connectCharAcrossServices(
        this.#EEG1_CHARACTERISTIC,
        (event) => that.eegData(0, event)
      );

      await connectCharAcrossServices(
        this.#EEG2_CHARACTERISTIC,
        (event) => that.eegData(1, event)
      );

      await connectCharAcrossServices(
        this.#EEG3_CHARACTERISTIC,
        (event) => that.eegData(2, event)
      );

      await connectCharAcrossServices(
        this.#EEG4_CHARACTERISTIC,
        (event) => that.eegData(3, event)
      );

      await connectCharAcrossServices(
        this.#EEG5_CHARACTERISTIC,
        (event) => that.eegData(4, event)
      );
    }

    // PPG — available on both Athena (optics tags 0x34/0x35/0x36) and legacy
    await connectCharAcrossServices(
      this.#PPG1_CHARACTERISTIC,
      (event) => that.ppgData(0, event)
    );

    await connectCharAcrossServices(
      this.#PPG2_CHARACTERISTIC,
      (event) => that.ppgData(1, event)
    );

    await connectCharAcrossServices(
      this.#PPG3_CHARACTERISTIC,
      (event) => that.ppgData(2, event)
    );

    // 221e Muse v3 TLV protocol characteristics (d5913036-... CMD, 09bf2c52-... DATA)
    // stream IMU sensor data (accelerometer/gyroscope/magnetometer) in binary TLV
    // format — NOT EEG data. If no Interaxon EEG characteristics were found, we
    // cannot stream EEG from this device; log a diagnostic instead of mis-routing
    // IMU packets to the EEG parser.
    if (!this.#controlChar && !this.#isAthena) {
      const hasLegacyEEG = this.eeg && this.eeg.some(buf => buf != null);
      if (!hasLegacyEEG) {
        console.warn(
          "[web-muse] No Interaxon EEG characteristics found on any service. " +
          "221e Muse v3 CMD/DATA characteristics stream IMU data (TLV binary), " +
          "not EEG. This device may not support EEG streaming via Web Bluetooth."
        );
      }
    }

    // Start streaming if control characteristic is available
    if (this.#controlChar) {
      console.log("[web-muse] Sending start commands via control characteristic...");
      
      if (this.#isAthena) {
        // Muse S Athena protocol v7 - OpenMuse sequence
        console.log("[web-muse] Trying Athena protocol v7 (OpenMuse) start sequence...");
        
        // 1. Version query
        await this.#sendCommand("v6");
        await this.#sleep(200);
        
        // 2. Status query
        await this.#sendCommand("s");
        await this.#sleep(200);
        
        // 3. Halt/reset
        await this.#sendCommand("h");
        await this.#sleep(200);
        
        // 4. Apply preset (p1041 for all channels)
        await this.#sendCommand("p1041");
        await this.#sleep(200);
        
        // 5. Query status after preset change
        await this.#sendCommand("s");
        await this.#sleep(200);
        
        // 6. START STREAMING - dc001 MUST be sent TWICE!
        console.log("[web-muse] Sending dc001 (start streaming) twice...");
        await this.#sendCommand("dc001");
        await this.#sleep(50);
        await this.#sendCommand("dc001");
        await this.#sleep(100);
        
        // 7. Enable low-latency mode
        await this.#sendCommand("L1");
        await this.#sleep(300);
        
        // 8. Final status query
        await this.#sendCommand("s");
        await this.#sleep(200);
        
        console.log("[web-muse] Athena start commands sent");
      } else {
        await this.#start();
        await this.#sendCommand("v1");
        console.log("[web-muse] Start commands sent");
      }
    } else {
      console.log("[web-muse] No control characteristic - device may stream automatically");
    }

    this.#state = 2;
    console.log("[web-muse] Connection complete, state:", this.#state);
    
    // Log which characteristics were connected
    console.log("[web-muse] EEG buffers available:", this.eeg ? this.eeg.length : 0);
  }
}

export class Muse extends MuseBase {
  constructor(options = {}) {
    super(options);
    const BUFFER_SIZE = 256;
    this.batteryLevel = null;
    this.info = {};
    this.eeg = [
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
    ];
    this.ppg = [
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
    ];
    this.accelerometer = [
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
    ];
    this.gyroscope = [
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
      new MuseCircularBuffer(BUFFER_SIZE),
    ];
  }

  batteryData(event) {
    this.batteryLevel = this.eventBatteryData(event);
  }

  accelerometerData(event) {
    const samples = this.eventAccelerometerData(event);
    for (let i = 0; i < samples[0].length; i++) {
      this.accelerometer[0].write(samples[0][i]);
      this.accelerometer[1].write(samples[1][i]);
      this.accelerometer[2].write(samples[2][i]);
    }
  }

  gyroscopeData(event) {
    const samples = this.eventGyroscopeData(event);
    for (let i = 0; i < samples[0].length; i++) {
      this.gyroscope[0].write(samples[0][i]);
      this.gyroscope[1].write(samples[1][i]);
      this.gyroscope[2].write(samples[2][i]);
    }
  }

  controlData(event) {
    const info = this.eventControlData(event);
    for (const key in info) {
      this.info[key] = info[key];
    }
  }

  eegData(n, event) {
    let samples = this.eventEEGData(event);
    samples = samples.map(function (x) {
      return 0.48828125 * (x - 0x800);
    });
    for (let i = 0; i < samples.length; i++) {
      this.eeg[n].write(samples[i]);
    }
  }

  athenaEegData(charIndex, event) {
    // Muse S Athena uses multiplexed binary format (OpenMuse protocol)
    // Packets have 14-byte headers followed by sensor subpackets
    let data = event.target.value;
    data = data.buffer ? data : new DataView(data);
    const bytes = new Uint8Array(data.buffer);
    
    // Log first few packets to understand format
    if (!this._athenaLogCount) this._athenaLogCount = 0;
    if (this._athenaLogCount < 3) {
      console.log(`[web-muse] Athena char ${charIndex}: ${bytes.length} bytes, first 30:`, 
        Array.from(bytes.slice(0, 30)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      this._athenaLogCount++;
    }
    
    // Sensor data lengths (from OpenMuse protocol)
    const SENSOR_DATA_LEN = {
      0x11: 28,  // EEG 4ch x 4samples
      0x12: 28,  // EEG 8ch x 2samples
      0x34: 30,  // OPTICS 4ch
      0x35: 40,  // OPTICS 8ch
      0x36: 40,  // OPTICS 16ch
      0x47: 36,  // ACCGYRO
      0x53: 24,  // Unknown
      0x88: 188, // Battery (new)
      0x98: 20,  // Battery (old)
    };
    
    // Parse all packets in the message
    let pktOffset = 0;
    while (pktOffset < bytes.length) {
      const pktLen = bytes[pktOffset];
      if (pktLen < 14 || pktOffset + pktLen > bytes.length) break;
      
      const pktData = bytes.subarray(pktOffset, pktOffset + pktLen);
      const pktId = pktData[9]; // Primary sensor TAG
      
      // Data section starts after 14-byte header
      let dataOffset = 14;
      
      // First subpacket uses pktId as its type (no TAG byte)
      const firstDataLen = SENSOR_DATA_LEN[pktId] || 0;
      if (pktId === 0x11 || pktId === 0x12) {
        if (dataOffset + firstDataLen <= pktData.length) {
          this.#parseAthenaEegSubpacket(pktId, pktData.subarray(dataOffset, dataOffset + firstDataLen));
        }
      } else if (pktId === 0x88 || pktId === 0x98) {
        if (dataOffset + firstDataLen <= pktData.length) {
          this._parseAthenaBatterySubpacket(pktId, pktData.subarray(dataOffset, dataOffset + firstDataLen));
        }
      }
      dataOffset += firstDataLen;
      
      // Additional subpackets have [TAG (1 byte)][header (4 bytes)][data]
      while (dataOffset + 5 < pktData.length) {
        const tag = pktData[dataOffset];
        const subDataLen = SENSOR_DATA_LEN[tag];
        if (!subDataLen) break;
        
        const subStart = dataOffset + 5; // Skip TAG + 4-byte header
        const subEnd = subStart + subDataLen;
        
        if (subEnd > pktData.length) break;
        
        if (tag === 0x11 || tag === 0x12) {
          this.#parseAthenaEegSubpacket(tag, pktData.subarray(subStart, subEnd));
        } else if (tag === 0x88 || tag === 0x98) {
          this._parseAthenaBatterySubpacket(tag, pktData.subarray(subStart, subEnd));
        }
        
        dataOffset = subEnd;
      }
      
      pktOffset += pktLen;
    }
  }
  
 #parseAthenaEegSubpacket(tag, dataBytes) {
    const EEG_SCALE = 1450.0 / 16383.0; 
    const nChannels = (tag === 0x11) ? 4 : 8;
    const nSamples = (tag === 0x11) ? 4 : 2;
    
    if (dataBytes.length < 28) return;
    
    // Initialize DSP filters for each channel if they don't exist
    if (!this._dsp) {
      this._dsp = Array(8).fill(0).map(() => ({
        x1: 0, x2: 0, y1: 0, y2: 0, // 60Hz Notch State
        dcX: 0, dcY: 0              // DC Blocker State
      }));
    }
    
    const values = this.#decode14BitData(dataBytes);
    
    for (let s = 0; s < nSamples; s++) {
      for (let ch = 0; ch < Math.min(nChannels, 4); ch++) {
        const idx = s * nChannels + ch;
        if (idx < values.length && ch < this.eeg.length) {
          
          // 1. Raw scaled microvolts
          const raw_uV = (values[idx] - 8192) * EEG_SCALE;
          const st = this._dsp[ch];
          
          // Step initialization to prevent massive startup ringing
          if (st.x1 === 0 && st.x2 === 0) {
              st.x1 = raw_uV; st.x2 = raw_uV;
              st.y1 = raw_uV; st.y2 = raw_uV;
              st.dcX = raw_uV;
          }
          
          // 2. 60Hz Notch Filter (Fs=256Hz, Q=30)
          const b0 = 0.983684, b1 = -0.192835, b2 = 0.983684;
          const a1 = -0.192835, a2 = 0.967369;
          
          const notch_y = b0 * raw_uV + b1 * st.x1 + b2 * st.x2 - a1 * st.y1 - a2 * st.y2;
          
          st.x2 = st.x1; st.x1 = raw_uV;
          st.y2 = st.y1; st.y1 = notch_y;
          
          // 3. DC Blocker (High Pass, cutoff ~0.4Hz) to remove skin drift
          const clean_y = notch_y - st.dcX + 0.99 * st.dcY;
          
          st.dcX = notch_y;
          st.dcY = clean_y;

          this.eeg[ch].write(clean_y);
        }
      }
    }
  }
  
  _parseAthenaBatterySubpacket(tag, dataBytes) {
    const dv = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    if (tag === 0x98 && dataBytes.length >= 4) {
      const level = dv.getUint16(2) / 512;
      if (level >= 0 && level <= 100) {
        this.batteryLevel = Math.round(level);
      }
      if (!this._batteryLogged) {
        this._batteryLogged = true;
        console.log(`[web-muse] Athena battery (0x98): ${this.batteryLevel}%`,
          `raw first 10 bytes:`, Array.from(dataBytes.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      }
    } else if (tag === 0x88 && dataBytes.length >= 4) {
      const level = dv.getUint16(2) / 512;
      if (level >= 0 && level <= 100) {
        this.batteryLevel = Math.round(level);
      }
      if (!this._batteryLogged) {
        this._batteryLogged = true;
        const rawHex = Array.from(dataBytes.slice(0, 30)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log(`[web-muse] Athena battery (0x88): level=${this.batteryLevel}%, ${dataBytes.length} bytes`);
        console.log(`[web-muse] Battery raw: ${rawHex}`);
        if (this.batteryLevel === null || this.batteryLevel === 0) {
          console.log(`[web-muse] Battery parse may need adjustment. uint16 candidates:`,
            `@0=${dv.getUint16(0)}`, `@2=${dv.getUint16(2)}`, `@4=${dv.getUint16(4)}`,
            `@6=${dv.getUint16(6)}`, `@8=${dv.getUint16(8)}`);
        }
      }
    }
  }

  #decode14BitData(bytes) {
    // Neurovis Patch: 14-bit Little-Endian (LSB) unpacker
    const values = [];
    for (let i = 0; i + 6 < bytes.length; i += 7) {
      // 4 x 14-bit values packed in 7 bytes, Little-Endian orientation
      values.push((bytes[i] | ((bytes[i+1] & 0x3F) << 8)) & 0x3FFF);
      values.push(((bytes[i+1] >> 6) | (bytes[i+2] << 2) | ((bytes[i+3] & 0x0F) << 10)) & 0x3FFF);
      values.push(((bytes[i+3] >> 4) | (bytes[i+4] << 4) | ((bytes[i+5] & 0x03) << 12)) & 0x3FFF);
      values.push(((bytes[i+5] >> 2) | (bytes[i+6] << 6)) & 0x3FFF);
    }
    return values;
  }

  // Public version of decode for use in athenaEegData
  #decodeUnsigned12BitDataPublic(samples) {
    const samples12Bit = [];
    for (let i = 0; i < samples.length; i++) {
      if (i % 3 === 0) {
        samples12Bit.push((samples[i] << 4) | (samples[i + 1] >> 4));
      } else {
        samples12Bit.push(((samples[i] & 0xf) << 8) | samples[i + 1]);
        i++;
      }
    }
    return samples12Bit;
  }

  ppgData(n, event) {
    const samples = this.eventPPGData(event);
    for (let i = 0; i < samples.length; i++) {
      this.ppg[n].write(samples[i]);
    }
  }
}

export const connectMuse = async (options = {}) => {
  const muse = new Muse(options);
  if (options.mock) {
    console.log("[web-muse] Connecting in mock mode...");
  } else {
    console.log("[web-muse] Connecting to Muse device...");
  }
  await muse.connect();
  console.log("[web-muse] Connected:", muse.state === 2);
  return muse;
};
