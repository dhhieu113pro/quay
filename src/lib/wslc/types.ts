export type HostGate = "checking" | "missing" | "ready" | "lab";

export type ViewId =
  | "dashboard"
  | "containers"
  | "terminal"
  | "logs"
  | "audit"
  | "images"
  | "groups"
  | "volumes"
  | "session";

export type ContainerStatus =
  | "created"
  | "running"
  | "paused"
  | "exited"
  | "removing";

export type ProcessOutputMode = "Event" | "Handle";

export interface PortMap {
  host: number;
  container: number;
  protocol: "tcp" | "udp";
}

export interface Mount {
  source: string;
  destination: string;
  mode: "rw" | "ro";
}

export interface LogLine {
  ts: number;
  stream: "stdout" | "stderr";
  text: string;
}

export interface AggregatedLogLine extends LogLine {
  id: string;
  containerId: string;
  containerName: string;
  cubeId?: string;
  cubeName?: string;
}

export type AuditStatus = "doing" | "done" | "error";

export interface AuditEvent {
  id: string;
  operationId: string;
  ts: number;
  category: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  status: AuditStatus;
  message?: string;
  command?: string;
  error?: string;
  durationMs?: number;
  metadataJson?: string;
}

export interface AuditQuery {
  status?: AuditStatus;
  category?: string;
  target?: string;
  search?: string;
  fromTs?: number;
  toTs?: number;
  limit?: number;
  beforeTs?: number;
}

export interface ContainerLogRecord {
  id: number;
  containerId?: string;
  containerName: string;
  cubeId?: string;
  cubeName?: string;
  sourceTs?: number;
  capturedTs: number;
  stream: "stdout" | "stderr";
  text: string;
  payloadBytes: number;
  dedupeKey: string;
}

export interface ContainerLogQuery {
  containerName?: string;
  cubeId?: string;
  search?: string;
  fromTs?: number;
  toTs?: number;
  limit?: number;
  beforeId?: number;
}

export interface ContainerLogTarget {
  containerId?: string;
  containerName: string;
  cubeId?: string;
  cubeName?: string;
  lastCapturedTs: number;
}

export interface StorageStats {
  available: boolean;
  databaseBytes: number;
  auditRows: number;
  containerLogRows: number;
  containerLogPayloadBytes: number;
}

export interface ContainerLogWrite {
  containerId?: string;
  containerName: string;
  cubeId?: string;
  cubeName?: string;
  sourceTs?: number;
  capturedTs: number;
  stream: "stdout" | "stderr";
  text: string;
  dedupeKey: string;
}

export interface LegacyOperationLogInput {
  id: string;
  ts: number;
  containerName?: string;
  command: string;
  text: string;
}

export interface LegacyImportResult {
  imported: number;
  alreadyImported: boolean;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  ports: PortMap[];
  mounts: Mount[];
  env: Record<string, string>;
  gpu: boolean;
  cpuPercent: number;
  memoryMB: number;
  memoryLimitMB: number;
  command: string[];
  workdir: string;
  user: string;
  exitCode?: number;
  logs: LogLine[];
  groupId?: string;
}

export interface ImageRecord {
  id: string;
  repository: string;
  tag: string;
  digest: string;
  sizeBytes: number;
  createdAt: number;
  containers: number;
}

export type PullJobStatus =
  | "queued"
  | "pulling"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "interrupted";

export interface PullJob {
  id: string;
  reference: string;
  status: PullJobStatus;
  currentBytes: number;
  totalBytes?: number;
  progress?: number;
  bytesPerSecond?: number;
  startedAt?: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  message?: string;
  error?: string;
}

export interface ImageSearchResult {
  name: string;
  description: string;
  official: boolean;
  stars?: number;
  pulls?: number;
  updatedAt?: string;
}

export interface VolumeRecord {
  name: string;
  driver: string;
  mountpoint: string;
  sizeBytes: number;
  createdAt: number;
  inUse: boolean;
}

export type FilesystemMode = "virtiofs" | "9p";
export type NetworkMode = "consomme" | "nat" | "none";

export interface SessionInfo {
  name: string;
  dataPath: string;
  cpuCount: number;
  memoryMB: number;
  running: boolean;
  filesystem: FilesystemMode;
  networking: NetworkMode;
  gpu: boolean;
  gpuName: string;
  version: string;
  wslVersion: string;
  missingComponents: string[];
  startedAt?: number;
}

export interface ApiCall {
  id: string;
  at: number;
  method: string;
  csharp: string;
  cli: string;
  result: string;
  ok: boolean;
}

export interface RunSpec {
  image: string;
  name: string;
  command: string;
  ports: string;
  env: string;
  mounts: string;
  gpu: boolean;
  remove: boolean;
  detach: boolean;
  workdir: string;
  workspacePath?: string;
  workspaceTarget?: string;
  groupId?: string;
}

export interface ContainerGroup {
  id: string;
  name: string;
  network: string;
  env: string;
  builtIn: boolean;
  autoStart: boolean;
  workspacePath?: string;
  protectedEnvKeys?: string[];
  specs: RunSpec[];
}

export interface MetricsPoint {
  t: number;
  cpu: number;
  mem: number;
}
