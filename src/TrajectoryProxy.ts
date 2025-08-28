
import { get, set, del, createStore, UseStore } from 'idb-keyval';

// A placeholder for the actual frame data structure.
// Assuming FrameData is an object with a `byteLength` property for size calculation.
export type FrameData = {
  coords: Float32Array;
  box: Float32Array;
};
// export type FrameData = any;


/**
 * Defines the contract for a data source that can provide trajectory metadata and frame data.
 * This allows the TrajectoryProxy to be decoupled from the actual data fetching implementation.
 */
export interface TrajectoryDataSource {
  getMetadata: () => Promise<any>;
  getFrames: (start: number, end: number) => Promise<FrameData[]>;
}

// Internal node for the doubly linked list in the LRU cache.
class LRUNode<K, V> {
    constructor(public key: K, public value: V, public prev: LRUNode<K, V> | null = null, public next: LRUNode<K, V> | null = null) {}
}

// Generic LRU Cache implementation using a Map and a doubly linked list.
class LRUCache<K, V> {
    private capacity: number;
    private cache = new Map<K, LRUNode<K, V>>();
    private head: LRUNode<K, V> | null = null;
    private tail: LRUNode<K, V> | null = null;

    constructor(capacity: number) {
        this.capacity = capacity;
    }

    get(key: K): V | undefined {
        if (this.cache.has(key)) {
            const node = this.cache.get(key)!;
            this.moveToHead(node);
            return node.value;
        }
        return undefined;
    }

    set(key: K, value: V): { evicted?: { key: K, value: V } } {
        let evicted;
        if (this.cache.has(key)) {
            const node = this.cache.get(key)!;
            node.value = value;
            this.moveToHead(node);
        } else {
            const node = new LRUNode(key, value);
            this.cache.set(key, node);
            this.addToHead(node);
            if (this.cache.size > this.capacity) {
                evicted = this.evictTail();
            }
        }
        return { evicted };
    }
    
    has(key: K): boolean {
        return this.cache.has(key);
    }

    private addToHead(node: LRUNode<K, V>) {
        node.next = this.head;
        node.prev = null;
        if (this.head) {
            this.head.prev = node;
        }
        this.head = node;
        if (!this.tail) {
            this.tail = node;
        }
    }

    private removeNode(node: LRUNode<K, V>) {
        if (node.prev) {
            node.prev.next = node.next;
        } else {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        } else {
            this.tail = node.prev;
        }
    }

    private moveToHead(node: LRUNode<K, V>) {
        this.removeNode(node);
        this.addToHead(node);
    }

    private evictTail(): { key: K, value: V } | undefined {
        const tail = this.tail;
        if (tail) {
            this.removeNode(tail);
            this.cache.delete(tail.key);
            return { key: tail.key, value: tail.value };
        }
        return undefined;
    }
}


/**
 * A proxy for a remote trajectory file that provides a two-level (memory, IndexedDB)
 * cache, pre-fetching, and atomic, transactional data access.
 */
export class TrajectoryProxy {
    private readonly dataSource: TrajectoryDataSource;
    private readonly targetChunkSizeInBytes: number;
    private readonly l1CacheSizeInChunks: number;
    private readonly l2CacheSizeInBytes: number;

    private l1Cache: LRUCache<number, FrameData[]>;
    private l2Cache: LRUCache<number, { size: number }>; // L2 stores metadata (size) in memory
    private l2Store: UseStore;
    private l2CurrentSizeInBytes = 0;

    private metadata: any | null = null;
    private frameSizeInBytes: number | null = null; // To be set in init
    private framesPerChunk: number | null = null;
    private isTransparent = false;
    private lastRequestedChunkIndex: number | null = null;
    
    private pendingFetches = new Map<number, Promise<FrameData[]>>();

    constructor(options: {
        dataSource: TrajectoryDataSource;
        targetChunkSizeInBytes?: number;
        l1CacheSizeInChunks?: number;
        l2CacheSizeInBytes?: number;
    }) {
        this.dataSource = options.dataSource;
        this.targetChunkSizeInBytes = options.targetChunkSizeInBytes ?? 1 * 1024 * 1024; // 1MB
        this.l1CacheSizeInChunks = options.l1CacheSizeInChunks ?? 3;
        this.l2CacheSizeInBytes = options.l2CacheSizeInBytes ?? 50 * 1024 * 1024; // 50MB

        this.l1Cache = new LRUCache<number, FrameData[]>(this.l1CacheSizeInChunks);
        // L2 capacity is managed by size in bytes, not item count, so capacity is Infinity.
        this.l2Cache = new LRUCache<number, { size: number }>(Infinity);

        const dbName = `ngl-proxy-db-${Date.now()}-${Math.random()}`;
        const storeName = 'chunks';
        this.l2Store = createStore(dbName, storeName);
    }

    public async init(): Promise<void> {
        if (this.metadata) return;

        this.metadata = await this.dataSource.getMetadata();
        if (typeof this.metadata?.frameCount !== 'number') {
            throw new Error("Metadata must include a 'frameCount' number property.");
        }

        const firstFrameArr = await this.dataSource.getFrames(0, 1);
        if (!firstFrameArr || firstFrameArr.length === 0) {
            throw new Error("Failed to fetch first frame to determine size.");
        }
        
        const firstFrame = firstFrameArr[0];
        this.frameSizeInBytes = firstFrame.coords.byteLength + firstFrame.box.byteLength;

        if (this.frameSizeInBytes > this.targetChunkSizeInBytes) {
            this.isTransparent = true;
            console.warn("Single frame size is larger than target chunk size. Proxy is in transparent mode.");
        } else {
            this.framesPerChunk = Math.max(1, Math.floor(this.targetChunkSizeInBytes / this.frameSizeInBytes));
        }
        console.log("TrajectoryProxy initialized:", {
            frameCount: this.metadata.frameCount,
            frameSizeInBytes: this.frameSizeInBytes,
            framesPerChunk: this.framesPerChunk,
            isTransparent: this.isTransparent,
        });
    }

    public getMetadata(): any {
        if (!this.metadata) {
            throw new Error("Proxy not initialized. Call init() first.");
        }
        return this.metadata;
    }

    public getFrameCount(): number {
        if (!this.metadata) {
            throw new Error("Proxy not initialized. Call init() first.");
        }
        return this.metadata.frameCount;
    }

    public async getFrame(frameIndex: number): Promise<FrameData> {
        if (!this.metadata || this.framesPerChunk === null && !this.isTransparent) {
            throw new Error("Proxy not initialized. Call init() first.");
        }
        if (frameIndex < 0 || frameIndex >= this.getFrameCount()) {
            throw new Error(`Frame index ${frameIndex} is out of bounds.`);
        }

        if (this.isTransparent) {
            const frame = await this.dataSource.getFrames(frameIndex, frameIndex + 1);
            return frame[0];
        }

        const framesPerChunk = this.framesPerChunk!;
        const currentChunkIndex = Math.floor(frameIndex / framesPerChunk);

        if (currentChunkIndex !== this.lastRequestedChunkIndex) {
            this.prefetchNextChunk(currentChunkIndex + 1);
            this.lastRequestedChunkIndex = currentChunkIndex;
        }

        const chunk = await this.getOrFetchChunk(currentChunkIndex);
        const frameOffset = frameIndex % framesPerChunk;
        return chunk[frameOffset];
    }

    private async getOrFetchChunk(chunkIndex: number): Promise<FrameData[]> {
        // L1 Hit
        const l1Data = this.l1Cache.get(chunkIndex);
        if (l1Data) {
            return l1Data;
        }

        // L2 Hit
        if (this.l2Cache.has(chunkIndex)) {
            const chunkData = await get<FrameData[]>(chunkIndex, this.l2Store);
            if (chunkData) {
                this.l2Cache.get(chunkIndex); // Update L2 LRU
                this.addChunkToL1(chunkIndex, chunkData); // Promote to L1
                return chunkData;
            }
        }
        
        // Miss: Fetch from source
        if (this.pendingFetches.has(chunkIndex)) {
            return this.pendingFetches.get(chunkIndex)!;
        }

        const fetchPromise = (async () => {
            try {
                const start = chunkIndex * this.framesPerChunk!;
                const end = Math.min((chunkIndex + 1) * this.framesPerChunk!, this.getFrameCount());
                console.log(`Fetching chunk ${chunkIndex} (frames ${start} to ${end - 1}) from source...`);
                const chunkData = await this.dataSource.getFrames(start, end);

                // Transactional write: L2 then L1
                await this.addChunkToL2(chunkIndex, chunkData);
                await this.addChunkToL1(chunkIndex, chunkData);

                return chunkData;
            } catch (error) {
                console.error(`Failed to fetch/cache chunk ${chunkIndex}:`, error);
                throw error;
            }
        })();
        
        this.pendingFetches.set(chunkIndex, fetchPromise);
        fetchPromise.finally(() => {
            this.pendingFetches.delete(chunkIndex);
        });

        return fetchPromise;
    }

    private async addChunkToL1(chunkIndex: number, chunkData: FrameData[]): Promise<void> {
        const evicted = this.l1Cache.set(chunkIndex, chunkData).evicted;
        // L1 eviction doesn't require further action
    }

    private async addChunkToL2(chunkIndex: number, chunkData: FrameData[]): Promise<void> {
        if (this.frameSizeInBytes === null) {
            // This should not happen if init() was called, but as a safeguard:
            throw new Error("frameSizeInBytes is not initialized. Cannot calculate chunk size.");
        }
        const chunkSize = chunkData.length * this.frameSizeInBytes;
        
        this.l2CurrentSizeInBytes += chunkSize;
        const evicted = this.l2Cache.set(chunkIndex, { size: chunkSize }).evicted;
        if(evicted) {
            this.l2CurrentSizeInBytes -= evicted.value.size;
            await del(evicted.key, this.l2Store);
        }

        await set(chunkIndex, chunkData, this.l2Store);

        // Evict more if over budget
        while (this.l2CurrentSizeInBytes > this.l2CacheSizeInBytes) {
            const evicted = this.l2Cache.set(chunkIndex, { size: chunkSize }).evicted;
            if (evicted) {
                this.l2CurrentSizeInBytes -= evicted.value.size;
                await del(evicted.key, this.l2Store);
            } else {
                break; // Should not happen if size > 0
            }
        }
    }

    private prefetchNextChunk(chunkIndex: number): void {
        const totalChunks = Math.ceil(this.getFrameCount() / this.framesPerChunk!);
        if (chunkIndex >= totalChunks) return;

        if (!this.l1Cache.has(chunkIndex) && !this.l2Cache.has(chunkIndex) && !this.pendingFetches.has(chunkIndex)) {
            this.getOrFetchChunk(chunkIndex).catch(error => {
                console.error(`Error pre-fetching chunk ${chunkIndex}:`, error);
            });
        }
    }
}
