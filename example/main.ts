declare const NGL: any;
import { TrajectoryProxy } from '../src/TrajectoryProxy';
// import { TrajectoryProxy } from 'ngl-data-proxy';
import { MdsrvDataSource as CustomMdsrvDataSource } from './MdsrvDataSource';

// --- Configuration ---
const SERVER_BASE_URL = 'http://127.0.0.1:38359/';
const TRAJECTORY_ROOT = 'cwd';
const STRUCTURE_FILENAME = 'data/ala3.pdb';
const TRAJECTORY_FILENAME = 'data/ala3.dcd';

// --- UI Elements ---
const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
const slider = document.getElementById('slider') as HTMLInputElement;
const frameLabel = document.getElementById('frameLabel') as HTMLSpanElement;

// --- NGL Stage Setup ---
const stage = new NGL.Stage('viewport', { backgroundColor: 'white' });
window.addEventListener('resize', () => stage.handleResize());

let player: any | undefined;
let traj: any | undefined;
let isPlaying = false;

/**
 * Main function to set up the NGL player with our custom trajectory proxy.
 */
async function main() {
  // --- Part 1: Setup for Structure Loading (using NGL's MdsrvDataSource) ---
  const nglMdsrv = new NGL.MdsrvDatasource(SERVER_BASE_URL);
  NGL.DatasourceRegistry.add('mdsrv', nglMdsrv);

  // --- Part 2: Setup for Trajectory Loading (using our custom proxy) ---
  const customDataSource = new CustomMdsrvDataSource({
    baseUrl: SERVER_BASE_URL,
    root: TRAJECTORY_ROOT,
    filename: TRAJECTORY_FILENAME,
  });

  const proxy = new TrajectoryProxy({
    dataSource: customDataSource,
    targetChunkSizeInBytes: 4 * 1024 * 1024, // 1MB
    l2CacheSizeInBytes: 30 * 1024 * 1024, // 30MB
  });

  try {
    await proxy.init();
    console.log(`TrajectoryProxy initialized. Frame count: ${proxy.getFrameCount()}`);
  } catch (error) {
    console.error('Failed to initialize TrajectoryProxy:', error);
    alert('Error initializing trajectory proxy. See console for details.');
    return;
  }

  // --- Part 3: The "Glue" - The Request Callback for CallbackTrajectory ---
  const frameRequestCallback = (
    responseCallback: Function, // Generic function type
    frameIndex?: number
  ) => {
    // --- DEBUGGING ---
    // console.log(`frameRequestCallback invoked. frameIndex: ${frameIndex}`);
    // -----------------
    // Case 1: Initial call to get the frame count.
    if (frameIndex === undefined) {
      // The response callback expects only one argument: the count.
      responseCallback(proxy.getFrameCount());
      return;
    }

    // Case 2: Call to get a specific frame's data.
    proxy.getFrame(frameIndex).then(frameData => {
      // The response callback expects four arguments: index, box, coords, count.
      responseCallback(
        frameIndex,
        frameData.box,
        frameData.coords,
        proxy.getFrameCount()
      );
    }).catch(error => {
      console.error(`Error fetching frame ${frameIndex} via proxy:`, error);
    });
  };

  // --- Part 4: Load Structure and then add Trajectory ---
  const structureUrl = nglMdsrv.getUrl(`${TRAJECTORY_ROOT}/${STRUCTURE_FILENAME}`);
  stage.loadFile(structureUrl).then(o => {
    console.log('Structure loaded:', `${TRAJECTORY_ROOT}/${STRUCTURE_FILENAME}`);
    console.log('StructureComponent (o) details:', {
      name: o.structure.name,
      atomCount: o.structure.atomCount,
      bondCount: o.structure.bondCount,
      residueCount: o.structure.residueCount,
      chainCount: o.structure.chainCount
    });
    o.addRepresentation('cartoon');
    const hasPolymer = o.structure.polymerResidueCount > 0;
    o.addRepresentation(hasPolymer ? "cartoon" : "ball+stick", hasPolymer ? {} : { multipleBond: true });

    o.autoView();

    // Pass the callback function directly as the first argument to addTrajectory
    const trajComp = o.addTrajectory(
      frameRequestCallback, // Let NGL's makeTrajectory handle the creation
      proxy.getMetadata()   // Pass metadata as the second argument (params)
    );

    traj = trajComp.trajectory;
    console.log('Trajectory ready. Frame count:', traj.frameCount);

    slider.max = (traj.frameCount - 1).toString();
    slider.value = '0';
    frameLabel.textContent = '0';

    player = new NGL.TrajectoryPlayer(traj, {
      step: 1,
      timeout: 60, // milliseconds
      mode: 'loop'
    });

    traj.signals.frameChanged.add((value: number) => {
      slider.value = value.toString();
      frameLabel.textContent = value.toString();
    });

  }).catch(err => {
    console.error('Failed to load structure:', err);
    alert('Failed to load structure file. See console for details.');
  });

  // --- Part 5: Connect UI Controls ---
  playBtn.onclick = () => {
    if (!player) {
      console.log('Player not ready yet.');
      return;
    }
    if (isPlaying) {
      console.log('Calling player.pause()');
      player.pause();
      playBtn.textContent = 'Play';
    } else {
      console.log('Calling player.play()');
      player.play();
      playBtn.textContent = 'Pause';
    }
    isPlaying = !isPlaying;
  };

  slider.oninput = () => {
    if (traj) {
      if (isPlaying) {
        console.log('Scrubbing detected, pausing playback.');
        player.pause();
        isPlaying = false;
        playBtn.textContent = 'Play';
      }
      const frame = parseInt(slider.value, 10);
      traj.setFrame(frame);
    }
  };
}

main();