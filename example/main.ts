import { TrajectoryProxy } from '../src/TrajectoryProxy';
import { MdsrvDataSource } from './MdsrvDataSource';
import type { ParsedFrameData } from './MdsrvDataSource';

// --- Configuration ---
const SERVER_BASE_URL = 'http://127.0.0.1:38359';
const TRAJECTORY_ROOT = 'cwd'; // The root directory on the mdsrv server
const TRAJECTORY_FILENAME = 'data/md.xtc'; // The file path within the root

// --- UI Elements ---
const viewport = document.getElementById('viewport');
if (!viewport) {
  throw new Error('The application requires a #viewport element in the HTML.');
}

// Clear the viewport and apply styles for our demo UI
viewport.innerHTML = '';
viewport.style.cssText = 'font-family: sans-serif; padding: 20px;';

const metadataDiv = document.createElement('div');
metadataDiv.innerHTML = '<h2>Metadata</h2><pre id="metadata-output"></pre>';
viewport.appendChild(metadataDiv);

const frameTestDiv = document.createElement('div');
frameTestDiv.innerHTML = '<h2>Frame Test</h2><input type="number" id="frame-input" placeholder="Frame Index" value="0" style="padding: 8px; margin-right: 10px;"><button id="get-frame-btn" style="padding: 8px 15px;">Get Frame</button><pre id="frame-output" style="max-height: 300px; overflow-y: auto; background: #f0f0f0; padding: 10px; border-radius: 5px;"></pre>';
viewport.appendChild(frameTestDiv);

const logDiv = document.createElement('div');
logDiv.innerHTML = '<h2>Logs</h2><pre id="log-output" style="max-height: 200px; overflow-y: auto; background: #e0e0e0; padding: 10px; border-radius: 5px;"></pre>';
viewport.appendChild(logDiv);

const metadataOutput = document.getElementById('metadata-output') as HTMLPreElement;
const frameInput = document.getElementById('frame-input') as HTMLInputElement;
const getFrameBtn = document.getElementById('get-frame-btn') as HTMLButtonElement;
const frameOutput = document.getElementById('frame-output') as HTMLPreElement;
const logOutput = document.getElementById('log-output') as HTMLPreElement;

// Simple logging function to display messages in the UI
function log(message: string) {
  const p = document.createElement('p');
  p.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
  logOutput.appendChild(p);
  logOutput.scrollTop = logOutput.scrollHeight; // Scroll to bottom
}

/**
 * Main function to set up the TrajectoryProxy and UI interactions.
 */
async function main() {
  log('Initializing TrajectoryProxy...');

  const dataSource = new MdsrvDataSource({
    baseUrl: SERVER_BASE_URL,
    root: TRAJECTORY_ROOT,
    filename: TRAJECTORY_FILENAME,
  });

  const proxy = new TrajectoryProxy({
    dataSource: dataSource,
    chunkSize: 100, // Number of frames per chunk
    maxCacheSize: 10,   // Maximum number of chunks to keep in memory
  });

  try {
    await proxy.init();
    log(`Proxy initialized. Total frames: ${proxy.getFrameCount()}`);
    metadataOutput.textContent = JSON.stringify(proxy.getMetadata(), null, 2);
    frameInput.max = (proxy.getFrameCount() - 1).toString();

    getFrameBtn.addEventListener('click', async () => {
      const frameIndex = parseInt(frameInput.value, 10);
      if (isNaN(frameIndex) || frameIndex < 0 || frameIndex >= proxy.getFrameCount()) {
        log(`Invalid frame index: ${frameInput.value}`);
        return;
      }

      log(`Requesting frame: ${frameIndex}...`);
      try {
        const frameData = await proxy.getFrame(frameIndex) as ParsedFrameData;
        frameOutput.textContent = JSON.stringify({
          frameIndex: frameIndex,
          coordsLength: frameData.coords.length,
          box: Array.from(frameData.box) // Convert TypedArray to regular Array for display
        }, null, 2);
        log(`Frame ${frameIndex} received.`);
      } catch (error: any) {
        log(`Error getting frame ${frameIndex}: ${error.message}`);
        frameOutput.textContent = `Error: ${error.message}`;
        console.error(error);
      }
    });

  } catch (error: any) {
    log(`Failed to initialize TrajectoryProxy: ${error.message}`);
    console.error('Failed to setup TrajectoryProxy:', error);
  }
}

// Run the main setup function
main();