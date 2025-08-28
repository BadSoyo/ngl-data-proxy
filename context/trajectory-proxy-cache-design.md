### `TrajectoryProxy` 第四版设计方案

#### 1. 核心概念与公共 API

*   **核心功能:** 一个具有两级缓存（L1 内存, L2 IndexedDB）的高性能代理，其缓存生命周期与页面会话绑定。
*   **公共 API:** `TrajectoryProxy` 的公共 API 由以下四个方法组成：
    *   `init()`: 异步初始化代理，必须在调用任何其他方法之前完成。
    *   `getMetadata()`: 同步返回在`init()`中获取的元数据。
    *   `getFrame(frameIndex)`: 异步获取指定索引的单帧数据。
    *   `getFrameCount()`: 同步返回总帧数。
*   **接口不变:** `FrameData` 和 `TrajectoryDataSource` 外部接口定义保持不变。

#### 2. 构造函数与初始化 (`init`)

##### **构造函数 `constructor`**

*   在构造函数中，将生成一个页面唯一的ID，并用它来初始化一个`idb-keyval`的自定义存储实例。
    ```typescript
    const pageUniqueId = `ngl-proxy-db-${Date.now()}-${Math.random()}`;
    this.l2Store = new Store(pageUniqueId, 'chunks');
    ```

##### **初始化方法 `init()`**

1.  调用 `dataSource.getMetadata()` 获取 `frameCount`。
2.  调用 `dataSource.getFrames(0, 1)` 获取第一帧数据，**仅用于**计算`frameSizeInBytes`，随后立即丢弃。
3.  计算 `this.framesPerChunk`。
4.  处理透明代理降级情况。
5.  **重要:** L1和L2的缓存管理结构（哈希表和双向链表）都在内存中被创建并初始化为空状态。**不再有任何从IndexedDB中恢复旧状态的逻辑。**

#### 3. 缓存实现 (L1 & L2)

##### **L1 缓存 (内存)**

*   实现方式不变（内存中的哈希表 + 双向链表）。

##### **L2 缓存 (IndexedDB)**

*   **缓存策略：完全会话隔离。** L2缓存作为L1的扩展，提供更大的容量，但其生命周期与当前页面会话绑定。**刷新或关闭页面后，IndexedDB中的数据将因数据库名称的唯一性而变得不可访问，并最终由浏览器回收。**
*   **实现方式:** L2的LRU管理结构（哈希表和双向链表）在内存中实现。数据本身存储在会话唯一的IndexedDB数据库中。

#### 4. 请求处理

##### **缓存未命中：保证原子性与事务性**

此前的原子性设计消除了重复请求的风险，现在我们通过**串行写入**来进一步保证缓存更新的“事务性”，杜绝状态不一致的可能。

**问题场景回顾:**
并行写入L1和L2时，若L2（IndexedDB）写入失败而L1（内存）写入成功，会导致L1中存在L2中没有的“幽灵数据”，破坏缓存设计的一致性。

**解决方案：串行写入**
当缓存未命中时，`getOrFetchChunk`方法将严格遵循以下顺序，确保操作的事务性：

1.  **检查 `pendingFetches`:** 合并并发请求。
2.  **网络请求:** `await` `dataSource.getFrames()` 完成网络数据获取。
3.  **缓存更新 (串行):**
    a.  `await` **L2 缓存写入** (`addChunkToL2`)。L2是主要的持久化（会话内）和易失败环节，必须首先成功。
    b.  **只有在L2写入成功后**，才 `await` **L1 缓存写入** (`addChunkToL1`)。
    c.  如果在此过程中的任何一步失败，整个操作将失败，并且不会留下部分成功（不一致）的缓存状态。
4.  **清理与返回:**
    *   所有操作成功后，从`pendingFetches`中移除记录。
    *   最后，`resolve` Promise，将数据返回给调用者。

**更新后的示例代码结构:**

```typescript
// 内部方法，处理数据获取与缓存
private getOrFetchChunk(chunkIndex: number): Promise<FrameData[]> {
    // ... L1 and L2 cache hit logic ...

    // --- Cache Miss Atomic & Transactional Logic ---
    if (this.pendingFetches.has(chunkIndex)) {
        return this.pendingFetches.get(chunkIndex)!;
    }

    const fetchPromise = (async () => {
        try {
            // 1. Await 网络数据返回
            const chunkData = await this.dataSource.getFrames(start, end);

            // 2. Await 缓存更新 (串行)
            //    a. 先写 L2
            await this.addChunkToL2(chunkIndex, chunkData);
            //    b. 再写 L1
            await this.addChunkToL1(chunkIndex, chunkData);

            // 3. 最终 resolve Promise 并返回数据
            return chunkData;
        } catch (error) {
            // 任何一步失败都会进入catch块，确保在失败时清理
            this.pendingFetches.delete(chunkIndex);
            throw error;
        }
    })();

    // 在Promise链的末尾进行清理
    fetchPromise.finally(() => {
        this.pendingFetches.delete(chunkIndex);
    });
    
    this.pendingFetches.set(chunkIndex, fetchPromise);
    return fetchPromise;
}
```

##### **焦点块预加载策略**

*   此策略保持不变。仅当用户请求的帧跨越到新的数据块时，才触发对下一个块的预加载。