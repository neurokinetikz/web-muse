# web-muse

A modern JavaScript library for connecting to Muse EEG devices using Web Bluetooth API. Supports both legacy Muse devices (Muse 2016, Muse 2) and the Muse S Athena with automatic device detection. This project aims to provide a maintained alternative to [muse-js](https://github.com/urish/muse-js) which is no longer actively maintained.

## Why web-muse?

- 🔄 **Active Development**: Unlike muse-js, web-muse is actively maintained and works with current Muse firmware
- 🌐 **Web Bluetooth**: Direct browser connection without additional software
- 🧠 **Multi-Device Support**: Auto-detects and handles both legacy Muse and Muse S Athena protocols
- ⚛️ **React Integration**: Built-in React hooks and context for easy integration
- 🧪 **Mock Data**: Development support with mock data capabilities
- 📊 **Signal Processing**: Built-in EEG processing with frequency band analysis (delta, theta, alpha, beta, gamma)

## Features

- Direct connection to Muse EEG devices via Web Bluetooth
- **Automatic device detection** — seamlessly supports legacy Muse (12-bit EEG) and Muse S Athena (14-bit multiplexed OpenMuse protocol)
- Real-time EEG data streaming at 256Hz
- Built-in signal processing: power spectrum, frequency band analysis, recording/playback
- React hooks and context for easy integration
- **Mock data mode** for development and testing (no device required!)
- Support for:
  - EEG data (5 channels)
  - PPG data (3 channels)
  - Accelerometer data
  - Gyroscope data
  - Battery level monitoring

## Installation

### Local Development

1. Clone the repository:

```bash
git clone https://github.com/itayinbarr/web-muse.git
cd web-muse
```

2. Install dependencies:

```bash
npm install
```

3. Build the library:

```bash
npm run build
```

### Using in Your Project

You can install web-muse directly from your local clone using one of these methods:

#### Method 1: Using `npm link`

```bash
# In web-muse directory
npm link

# In your project directory
npm link web-muse
```

#### Method 2: Direct local path in package.json

Add this to your project's package.json:

```json
{
  "dependencies": {
    "web-muse": "file:../path/to/web-muse"
  }
}
```

Then run `npm install`

#### Method 3: Using GitHub URL

Add this to your project's package.json:

```json
{
  "dependencies": {
    "web-muse": "github:itayinbarr/web-muse"
  }
}
```

Then run `npm install`

## Quick Start

### Basic Usage (Vanilla JavaScript)

```javascript
import { connectMuse } from "web-muse";

async function connectToMuse() {
  // Connect to a real Muse device (auto-detects Muse 2 or Muse S Athena)
  const muse = await connectMuse();
  console.log("Connected to:", muse.modelName); // "Muse 2" or "Muse Athena"

  // Start receiving EEG data (5 channels)
  setInterval(() => {
    const eegData = muse.eeg.map((buffer) => buffer.read());
    console.log("EEG Data:", eegData);
  }, 1000 / 256); // 256Hz sampling rate

  // Disconnect when done
  muse.disconnect();
}

// Or use mock mode for development (no device required!)
async function connectToMuseMock() {
  const muse = await connectMuse({ mock: true });
  console.log("Connected in mock mode:", muse);

  // Same API - works identically to real device
  setInterval(() => {
    const eegData = muse.eeg.map((buffer) => buffer.read());
    console.log("Mock EEG Data:", eegData);
  }, 1000 / 256);
}
```

### React Usage

```jsx
import { useEEG, EEGProvider } from "web-muse/react";

// Wrap your app with the provider
function App() {
  return (
    <EEGProvider>
      <YourComponent />
    </EEGProvider>
  );
}

// Use the hook in your components
function YourComponent() {
  const { isConnected, connectMuse, rawEEG } = useEEG();

  const handleConnectReal = async () => {
    await connectMuse();
  };

  const handleConnectMock = async () => {
    await connectMuse({ mock: true });
  };

  return (
    <div>
      {!isConnected ? (
        <>
          <button onClick={handleConnectReal}>Connect to Real Device</button>
          <button onClick={handleConnectMock}>Use Mock Data</button>
        </>
      ) : (
        <div>EEG Data: {JSON.stringify(rawEEG)}</div>
      )}
    </div>
  );
}
```

## Mock Mode for Development

Mock mode allows you to develop and test your application without a physical Muse device. It plays back pre-recorded EEG data in a loop, providing realistic data for development and testing.

### Using Mock Mode

**Vanilla JavaScript:**

```javascript
import { connectMuse } from "web-muse";

// Connect with mock data
const muse = await connectMuse({ mock: true });

// Optionally specify a custom CSV file
const muse = await connectMuse({
  mock: true,
  mockDataPath: "/path/to/your/data.csv",
});
```

**Direct Instantiation:**

```javascript
import { Muse } from "web-muse";

const muse = new Muse({ mock: true });
await muse.connect();
```

You can also extend the `MuseBase` abstract class for custom implementations:

```javascript
import { MuseBase } from "web-muse";

class CustomMuse extends MuseBase {
  eegData(n, event) {
    // Handle legacy Muse EEG data for channel n
  }
  athenaEegData(n, event) {
    // Handle Muse S Athena EEG data for channel n
  }
  disconnected() {
    // Handle disconnect event
  }
}
```

### Mock Data Format

The default mock data is located at `assets/resting-state.csv` and contains real EEG recordings from a Muse device. The format is:

```csv
Timestamp (ms),TP9 (left ear),AF7 (left forehead),AF8 (right forehead),TP10 (right ear)
5,-0.48828125,0,-0.48828125,-0.48828125
7,0,-0.48828125,-0.48828125,0
...
```

You can provide your own CSV file in the same format for custom mock data scenarios.

## Signal Processing

web-muse includes built-in EEG signal processing utilities for frequency band analysis.

```javascript
import { setupPipeline, startRecording, stopRecording } from "web-muse/eeg";

// Set up a continuous data pipeline from the Muse device
const stopPipeline = setupPipeline(muse, (rawEEG) => {
  console.log("Raw EEG sample:", rawEEG); // [ch1, ch2, ch3, ch4]
});

// Record EEG data for analysis (minimum 3 seconds)
startRecording();

// After at least 3 seconds...
const result = stopRecording();
if (result) {
  console.log("Power by band:", result.powerData);
  // Each channel: { delta, theta, alpha, beta, gamma }
  console.log("Alpha power:", result.alphaData);
}

// Stop the pipeline when done
stopPipeline();
```

### Frequency Bands

| Band  | Frequency Range |
|-------|----------------|
| Delta | 0.5 - 4 Hz    |
| Theta | 4 - 8 Hz      |
| Alpha | 8 - 13 Hz     |
| Beta  | 13 - 30 Hz    |
| Gamma | 30 - 100 Hz   |

## Architecture

The library is built around two main classes:

- **`MuseBase`** — Abstract base class handling Bluetooth connection, service discovery, and protocol management. Supports both legacy Muse (service `0xfe8d`) and Muse S Athena (service `c8c0a708-...`) with automatic detection.
- **`Muse`** — Concrete implementation that extends `MuseBase` with circular buffer storage for all sensor data (EEG, PPG, accelerometer, gyroscope).

### Key Properties

| Property        | Type                     | Description                          |
|-----------------|--------------------------|--------------------------------------|
| `state`         | `number`                 | Connection state (0=idle, 1=connecting, 2=streaming) |
| `modelName`     | `string`                 | `"Muse 2"` or `"Muse Athena"`       |
| `eeg`           | `MuseCircularBuffer[5]`  | EEG channel buffers                  |
| `ppg`           | `MuseCircularBuffer[3]`  | PPG channel buffers                  |
| `accelerometer` | `MuseCircularBuffer[3]`  | Accelerometer axis buffers (x, y, z) |
| `gyroscope`     | `MuseCircularBuffer[3]`  | Gyroscope axis buffers (x, y, z)     |
| `batteryLevel`  | `number \| null`         | Battery percentage                   |
| `info`          | `object`                 | Device info from control characteristic |

### Methods

| Method         | Description                                       |
|----------------|---------------------------------------------------|
| `connect()`    | Connect to device (or start mock mode)             |
| `disconnect()` | Disconnect from device and stop data streaming     |

## Running the Examples

Both examples work without a physical Muse device — use the **Mock Data** button to stream pre-recorded EEG data.

### Vanilla Example

A minimal HTML/JS app showing real-time EEG channel values with no framework dependencies.

```bash
npm run example:vanilla
```

Opens on `http://localhost:5173`. Displays all 5 EEG channels, battery level, and device info.

### React Example

A full React app with live EEG chart visualization (Recharts), recording, and frequency band analysis.

```bash
npm run example:react
```

Opens on `http://localhost:3000`. Includes connect/disconnect, mock mode, recording with power spectrum results.

> Both commands auto-install example dependencies on first run.

## Development

```bash
# Install dependencies
npm install

# Build library
npm run build

# Run tests
npm test
```

## Requirements

- A Muse headband (tested with Muse 2016, Muse 2, and Muse S Athena)
- A Web Bluetooth-compatible browser:
  - Chrome (desktop & android)
  - Edge (desktop)
  - Opera (desktop & android)
  - Samsung Internet (android)

Note: Safari and iOS devices do not currently support Web Bluetooth.

## Browser Support

Web Bluetooth API is required. Check [browser compatibility](https://caniuse.com/web-bluetooth).

## Documentation

- [API Documentation](./docs/API.md)
- [Examples](./examples/)

## License

MIT

## Acknowledgments

- Thanks to [muse-js](https://github.com/urish/muse-js) for pioneering Web Bluetooth support for Muse devices
- Thanks to Interaxon for creating the Muse headband
