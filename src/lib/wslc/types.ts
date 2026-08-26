export type HostGate = "checking" | "missing" | "ready" | "lab";

export type ViewId =
  | "dashboard"
  | "containers"
  | "terminal"
  | "logs"
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

export interface PullJob {
  id: string;
  reference: string;
  status: string;
  currentBytes: number;
  totalBytes: number;
  startedAt: number;
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
  specs: RunSpec[];
}

export interface MetricsPoint {
  t: number;
  cpu: number;
  mem: number;
}
