import { TrajectoryDataSource, FrameData } from '../src/TrajectoryProxy';

/**
 * Defines the structure of a single frame parsed from the mdsrv binary format.
 */
export type ParsedFrameData = {
  coords: Float32Array;
  box: Float32Array;
};

/**
 * Parses a raw binary buffer for a SINGLE frame.
 * This function assumes it's receiving the data for exactly one frame, without any length prefix.
 * @param buffer The ArrayBuffer for a single frame.
 * @returns A parsed frame object.
 */
function parseSingleFrameBuffer(buffer: ArrayBuffer): ParsedFrameData {
  // The binary layout for a single frame is:
  // - bytes 0-3: Int32, frameCountInChunk (always 1)
  // - bytes 4-7: Float32, time (ignored)
  // - bytes 8-43: 9 * Float32, box matrix
  // - bytes 44-onwards: N * Float32, coordinates
  if (buffer.byteLength < 44) {
    throw new Error(`Frame buffer is too small to be valid (${buffer.byteLength} bytes).`);
  }
  const box = new Float32Array(buffer, 8, 9);
  const coords = new Float32Array(buffer, 44);
  return { coords, box };
}

/**
 * Parses a chunked buffer from the corrected /traj/slice endpoint.
 * The buffer is expected to be a sequence of [4-byte length][data] chunks.
 * @param buffer The complete ArrayBuffer received from the server.
 * @returns An array of parsed frame objects.
 */
function parseChunkedBuffer(buffer: ArrayBuffer): ParsedFrameData[] {
  const frames: ParsedFrameData[] = [];
  const dataView = new DataView(buffer);
  let offset = 0;

  while (offset < buffer.byteLength) {
    // Check if there's enough space for the 4-byte length prefix.
    if (offset + 4 > buffer.byteLength) {
      console.warn('Remaining buffer is too small for a length prefix.');
      break;
    }

    // Read the length of the next frame chunk (big-endian).
    const frameLength = dataView.getUint32(offset, false);
    offset += 4;

    // Check if the buffer contains the full frame data as promised by the length prefix.
    if (offset + frameLength > buffer.byteLength) {
      console.error('Buffer is truncated. Expected more data than available.');
      break;
    }

    // Slice the buffer to get the data for a single frame.
    const frameBuffer = buffer.slice(offset, offset + frameLength);

    // Parse the single frame buffer.
    frames.push(parseSingleFrameBuffer(frameBuffer));

    // Move the offset to the beginning of the next chunk.
    offset += frameLength;
  }

  return frames;
}

/**
 * An implementation of the TrajectoryDataSource interface that communicates with
 * a mdsrv.py compatible server with the corrected `traj_slice` endpoint.
 */
export class MdsrvDataSource implements TrajectoryDataSource {
  private readonly baseUrl: string;
  private readonly root: string;
  private readonly filename: string;

  constructor(options: {
    baseUrl: string;   // e.g., "http://localhost:5000"
    root: string;      // The data root on the server, e.g., "cwd"
    filename: string;  // The path to the file within the root, e.g., "data/trajectory.xtc"
  }) {
    this.baseUrl = options.baseUrl.endsWith('/')
      ? options.baseUrl.slice(0, -1)
      : options.baseUrl;
    this.root = options.root;
    this.filename = options.filename;
  }

  /**
   * Implements the getMetadata method by calling the /traj/numframes endpoint.
   */
  public async getMetadata(): Promise<{ frameCount: number }> {
    const url = `${this.baseUrl}/traj/numframes/${this.root}/${this.filename}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.status} ${response.statusText}`);
      }
      const frameCountStr = await response.text();
      const frameCount = parseInt(frameCountStr, 10);
      if (isNaN(frameCount)) {
        throw new Error(`Invalid frame count received: "${frameCountStr}"`);
      }
      return { frameCount };
    } catch (error) {
      console.error(`Error in getMetadata at ${url}:`, error);
      throw error;
    }
  }

  /**
   * Implements the getFrames method by calling the corrected /traj/slice endpoint.
   */
  public async getFrames(start: number, end: number): Promise<FrameData[]> {
    const url = `${this.baseUrl}/traj/slice/${start}/${end}/${this.root}/${this.filename}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams() // Send empty body as atom_indices is optional
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch frames ${start}-${end}: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      return parseChunkedBuffer(buffer);

    } catch (error) {
      console.error(`Error in getFrames for range ${start}-${end} at ${url}:`, error);
      throw error;
    }
  }
}
