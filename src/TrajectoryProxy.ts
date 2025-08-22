
// A placeholder for the actual frame data structure.
export type FrameData = any;

/**
 * Defines the contract for a data source that can provide trajectory metadata and frame data.
 * This allows the TrajectoryProxy to be decoupled from the actual data fetching implementation (e.g., REST API, WebSocket).
 */
export interface TrajectoryDataSource {
  /**
   * Asynchronously retrieves metadata for the trajectory.
   * The returned object is expected to contain at least a `frameCount` property.
   */
  getMetadata: () => Promise<any>;

  /**
   * Asynchronously retrieves a chunk of frames.
   * @param start - The starting frame index (inclusive).
   * @param end - The ending frame index (exclusive).
   * @returns A promise that resolves to an array of frames.
   */
  getFrames: (start: number, end: number) => Promise<FrameData[]>;
}

/**
 * A proxy for a remote trajectory file that provides caching, pre-fetching,
 * and a responsive, concurrent data access model.
 */
export class TrajectoryProxy {
  private readonly dataSource: TrajectoryDataSource;
  private readonly chunkSize: number;
  private readonly maxCacheSize: number;

  private metadata: any | null = null;
  private cache = new Map<number, FrameData[]>();
  private pendingFetches = new Map<number, Promise<FrameData[]>>();

  constructor(options: {
    dataSource: TrajectoryDataSource;
    chunkSize: number;
    maxCacheSize: number;
  }) {
    if (options.chunkSize <= 0 || options.maxCacheSize <= 0) {
      throw new Error("chunkSize and maxCacheSize must be positive numbers.");
    }
    this.dataSource = options.dataSource;
    this.chunkSize = options.chunkSize;
    this.maxCacheSize = options.maxCacheSize;
  }

  /**
   * Initializes the proxy by fetching essential metadata from the data source.
   * This method must be called before any other methods are used.
   */
  public async init(): Promise<void> {
    if (this.metadata) {
      return;
    }
    this.metadata = await this.dataSource.getMetadata();
    if (typeof this.metadata?.frameCount !== 'number') {
        throw new Error("Metadata fetched from data source must include a 'frameCount' number property.");
    }
  }

  /**
   * Returns the metadata object fetched during initialization.
   * @throws {Error} If the proxy has not been initialized.
   */
  public getMetadata(): any {
    if (!this.metadata) {
      throw new Error("TrajectoryProxy not initialized. Call init() first.");
    }
    return this.metadata;
  }

  /**
   * Returns the total number of frames in the trajectory.
   * @throws {Error} If the proxy has not been initialized.
   */
  public getFrameCount(): number {
    // The check in init() ensures metadata and frameCount exist and are valid.
    return this.getMetadata().frameCount;
  }

  /**
   * Retrieves a single frame, utilizing caching and pre-fetching strategies.
   * @param frameIndex The index of the frame to retrieve.
   * @returns A promise that resolves to the requested frame data.
   */
  public async getFrame(frameIndex: number): Promise<FrameData> {
    if (!this.metadata) {
      // Auto-initialize if not done already.
      await this.init();
    }
    if (frameIndex < 0 || frameIndex >= this.getFrameCount()) {
      throw new Error(`Frame index ${frameIndex} is out of bounds (0-${this.getFrameCount() - 1}).`);
    }

    const chunkIndex = Math.floor(frameIndex / this.chunkSize);
    
    // Asynchronously trigger pre-fetch for the next chunk, but don't wait for it.
    this.prefetchNextChunk(chunkIndex);

    // Get the required chunk, waiting if necessary.
    const chunk = await this.getChunk(chunkIndex);
    const frameOffset = frameIndex % this.chunkSize;
    
    return chunk[frameOffset];
  }

  /**
   * Retrieves a chunk of frames, handling cache hits, pending requests, and new fetches.
   * This is the core of the concurrent request handling.
   */
  private getChunk(chunkIndex: number): Promise<FrameData[]> {
    // Case A: Chunk is in the LRU cache. Return it immediately.
    if (this.cache.has(chunkIndex)) {
      const chunk = this.cache.get(chunkIndex)!;
      this.updateLru(chunkIndex); // Mark as recently used.
      return Promise.resolve(chunk);
    }

    // Case B: Chunk is already being fetched. Return the existing promise.
    if (this.pendingFetches.has(chunkIndex)) {
      return this.pendingFetches.get(chunkIndex)!;
    }

    // Case C: Chunk is not available. Fetch it.
    const fetchPromise = this.dataSource.getFrames(
      chunkIndex * this.chunkSize,
      (chunkIndex + 1) * this.chunkSize
    ).then(chunkData => {
      this.pendingFetches.delete(chunkIndex);
      this.cache.set(chunkIndex, chunkData);
      this.evictLru();
      return chunkData;
    }).catch(err => {
      // On failure, remove the promise to allow for retries.
      this.pendingFetches.delete(chunkIndex);
      throw err;
    });

    this.pendingFetches.set(chunkIndex, fetchPromise);
    return fetchPromise;
  }

  /**
   * Initiates a "fire-and-forget" pre-fetch for the next chunk if it's not
   * already cached or being fetched.
   */
  private prefetchNextChunk(currentChunkIndex: number): void {
    const nextChunkIndex = currentChunkIndex + 1;
    const totalChunks = Math.ceil(this.getFrameCount() / this.chunkSize);

    if (nextChunkIndex >= totalChunks) {
      return; // No more chunks to prefetch.
    }

    if (!this.cache.has(nextChunkIndex) && !this.pendingFetches.has(nextChunkIndex)) {
      // We call getChunk but don't await it. Errors are caught to prevent unhandled promise rejections.
      this.getChunk(nextChunkIndex).catch(error => {
        console.error(`Error pre-fetching chunk ${nextChunkIndex}:`, error);
      });
    }
  }

  /**
   * Moves a chunk to the end of the cache map to mark it as recently used.
   */
  private updateLru(chunkIndex: number): void {
    const chunkData = this.cache.get(chunkIndex);
    if (chunkData) {
      this.cache.delete(chunkIndex);
      this.cache.set(chunkIndex, chunkData);
    }
  }

  /**
   * Evicts the least recently used items from the cache if it exceeds max size.
   */
  private evictLru(): void {
    while (this.cache.size > this.maxCacheSize) {
      // A Map iterates in insertion order, so the first key is the oldest.
      const oldestChunkIndex = this.cache.keys().next().value;
      this.cache.delete(oldestChunkIndex);
    }
  }
}
