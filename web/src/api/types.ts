export type SpecKind =
  | 'worktree'
  | 'staged'
  | 'commit'
  | 'two-dot'
  | 'three-dot'
  | 'merge-base';

export interface Spec {
  kind: SpecKind;
  left: string;
  right: string;
  mergeBase?: string;
  argv: string[];
}

export type Flavor = 'latte' | 'frappe' | 'macchiato' | 'mocha';
export type ThemePref = Flavor | 'auto';
export type ViewMode = 'split' | 'unified';

export interface Defaults {
  theme: ThemePref;
  view: ViewMode;
  wrap: boolean;
}

export interface Session {
  repoRoot: string;
  head: string;
  spec: Spec;
  argv: string[];
  defaults: Defaults;
  comments: boolean;
}

export type FileStatus =
  | 'added'
  | 'copied'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'typechange'
  | 'unmerged'
  | 'untracked';

export interface Mode {
  old: string;
  new: string;
}

export interface FileEntry {
  id: string;
  path: string;
  prevPath?: string;
  status: FileStatus;
  score?: number;
  additions: number;
  deletions: number;
  binary: boolean;
  tooLarge: boolean;
  submodule: boolean;
  symlink: boolean;
  mode: Mode;
  oldSha: string;
  newSha: string;
}

export interface Totals {
  files: number;
  additions: number;
  deletions: number;
}

export interface Manifest {
  files: FileEntry[];
  totals: Totals;
}

export interface FilePayload {
  id: string;
  path: string;
  prevPath?: string;
  status: FileStatus;
  patch: string;
  oldLines: string[] | null;
  newLines: string[] | null;
  binary: boolean;
  tooLarge: boolean;
  oldSha: string;
  newSha: string;
  oldSize: number;
  newSize: number;
  mode: Mode;
  submodule: boolean;
  symlink: boolean;
}

export type AnnotationSide = 'additions' | 'deletions';
export type CommentStatus = 'open' | 'resolved' | 'wontfix';

export interface Author {
  name: string;
  email?: string;
}

export interface RepoRef {
  root: string;
  head: string;
}

export interface Anchor {
  path: string;
  prevPath: string | null;
  side: AnnotationSide;
  startLine: number;
  endLine: number;
  blobSha: string;
  lang?: string;
  quote: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface MovedFrom {
  startLine: number;
  endLine: number;
}

export interface ResolvedAnchor {
  stale: boolean;
  movedFrom: MovedFrom | null;
  rule?: string;
}

export interface Reply {
  id: string;
  author: Author;
  createdAt: string;
  body: string;
}

export interface Comment {
  id: string;
  status: CommentStatus;
  author: Author;
  createdAt: string;
  updatedAt: string;
  body: string;
  anchor: Anchor;
  resolvedAnchor?: ResolvedAnchor;
  replies: Reply[];
}

export interface CommentsDoc {
  version: number;
  generator: string;
  repo: RepoRef;
  spec: Spec;
  updatedAt: string;
  comments: Comment[];
}

export interface CommentsResponse {
  doc: CommentsDoc;
  etag: string;
}

export interface NewCommentRequest {
  anchor: {
    path: string;
    side: AnnotationSide;
    startLine: number;
    endLine: number;
  };
  body: string;
}

export interface PatchCommentRequest {
  body?: string;
  status?: CommentStatus;
}
