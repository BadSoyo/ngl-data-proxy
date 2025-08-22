# NGL Data Proxy Component: Development and Publication Workflow

This document outlines the structure, tools, and process for developing, testing, and publishing the NGL data proxy component.

---

### 1. Final Design (V4)

#### 1.1. Core Concepts

- **Dependency Injection**: The component will not contain any server-specific logic. Instead, the logic for fetching data will be injected at construction time. This is achieved by requiring a `TrajectoryDataSource` object.
- **Abstraction**: The component is named `TrajectoryProxy` to reflect its role as a generic proxy for remote trajectory data, decoupled from any specific NGL class.
- **Object Identity**: An instance of `TrajectoryProxy` is bound to the state of the remote file at the time of its `.init()` call. If the remote file changes, a new instance of the proxy must be created. Behavior is undefined otherwise.
- **Concurrency Model**: The component uses an async model that separates the immediate fulfillment of a data request from background pre-fetching tasks to ensure high responsiveness.

#### 1.2. `TrajectoryDataSource` Interface

This interface defines the contract that any injected data source must follow.

```typescript
interface TrajectoryDataSource {
  getMetadata: () => Promise<any>;
  getFrames: (start: number, end: number) => Promise<FrameData[]>;
}
```

#### 1.3. `TrajectoryProxy` Class API

- `constructor(options: { dataSource: TrajectoryDataSource, chunkSize: number, maxCacheSize: number })`
- `async init(): Promise<void>`: Initializes the proxy by fetching metadata via the data source.
- `getMetadata(): any`: Returns the fetched metadata.
- `getFrameCount(): number`: A convenience method to get the frame count from the metadata.
- `async getFrame(frameIndex: number): Promise<FrameData>`: The core method to retrieve a specific frame, implementing the caching and pre-fetching logic.

---

### 2. Development and Publication Workflow

(The workflow remains as previously defined: using Vite for development and testing, and `npm` for building and publishing.)

---

## 执行历史 (Execution History)

*   **2025-08-22**:
    *   Project structure initialized with Vite.
    *   Git repository created and pushed to GitHub.
    *   Finalized V4 design plan.