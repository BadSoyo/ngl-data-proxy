import { TrajectoryDataSource, FrameData as ProxyFrameData } from '../src/TrajectoryProxy';

// Define a more specific FrameData type based on the binary parsing logic.
export type ParsedFrameData = {
  coords: Float32Array;
  box: Float32Array;
};

/**
 * Parses a raw binary chunk from the mdsrv server into an array of frame objects.
 * This logic is based on the analysis of `remote-trajectory.ts`.
 * @param buffer The ArrayBuffer received from the server.
 * @returns An array of frame objects.
 */
function parseFramesFromBuffer(buffer: ArrayBuffer): ParsedFrameData[] {
  // A valid buffer must at least contain the full header (11 * 4 = 44 bytes).
  if (buffer.byteLength < 44) {
    return [];
  }

  // The binary layout is as follows:
  // - bytes 0-3: Int32, frameCountInChunk (seems to always be 1)
  // - bytes 4-7: Float32, time (ignored)
  // - bytes 8-43: 9 * Float32, box matrix
  // - bytes 44-onwards: N * Float32, coordinates

  const frameCountInChunk = new Int32Array(buffer, 0, 1)[0];
  if (frameCountInChunk !== 1) {
    // This implementation assumes the server sends one frame per buffer, as suggested by the context files.
    // If the server could send multiple frames, a more complex loop would be needed here.
    console.warn(`Buffer indicates ${frameCountInChunk} frames, but we are parsing only one.`);
  }

  // Read 9 floats for the box matrix, starting at byte offset 8 (2 * 4).
  const box = new Float32Array(buffer, 8, 9);
  // Read all remaining floats for the coordinates, starting at byte offset 44 (11 * 4).
  const coords = new Float32Array(buffer, 44);

  // Return an array containing the single parsed frame object.
  return [{ coords, box }];
}


/**
 * An implementation of the TrajectoryDataSource interface that communicates with
 * a mdsrv.py compatible server.
 */
export class MdsrvDataSource implements TrajectoryDataSource {
  private readonly baseUrl: string;
  private readonly filePath: string;

  constructor(options: {
    baseUrl: string;   // e.g., "http://localhost:5000"
    filePath: string;  // e.g., "trajectories/1crn.xtc"
  }) {
    // Remove trailing slashes to ensure URL concatenation is correct
    this.baseUrl = options.baseUrl.endsWith('/') 
      ? options.baseUrl.slice(0, -1) 
      : options.baseUrl;
    this.filePath = options.filePath;
  }

  /**
   * Implements the getMetadata method by calling the /header endpoint.
   */
  public async getMetadata(): Promise<any> {
    const url = `${this.baseUrl}/header/${this.filePath}`;
    console.log(`Fetching metadata from: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.status} ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      console.error("Error in getMetadata:", error);
      throw error;
    }
  }

  /**
   * Implements the getFrames method by calling the /traj/... slice endpoint.
   */
  public async getFrames(start: number, end: number): Promise<ProxyFrameData[]> {
    const url = `${this.baseUrl}/traj/${this.filePath}/${start}:${end}`;
    console.log(`Fetching frames from: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch frames: ${response.status} ${response.statusText}`);
      }

      // The mdsrv.py server returns binary data (application/octet-stream)
      const buffer = await response.arrayBuffer();

      // Parse the binary buffer into structured frame data.
      const frames: ParsedFrameData[] = parseFramesFromBuffer(buffer);
      
      return frames;
    } catch (error) {
      console.error("Error in getFrames:", error);
      throw error;
    }
  }
}
