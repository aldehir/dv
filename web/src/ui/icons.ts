import {
  Check,
  ChevronRight,
  Columns2,
  createElement,
  File,
  FileCode,
  FileImage,
  FileLock,
  FileText,
  Folder,
  FolderOpen,
  GitCompare,
  type IconNode,
  MessageSquareText,
  Palette,
  PanelLeft,
  Rows3,
  Search,
  TextWrap,
  Trash2,
  X,
} from 'lucide';

export type { IconNode };

export const ICONS = {
  chevron: ChevronRight,
  folder: Folder,
  folderOpen: FolderOpen,
  file: File,
  fileCode: FileCode,
  fileText: FileText,
  fileImage: FileImage,
  fileLock: FileLock,
  split: Columns2,
  unified: Rows3,
  wrap: TextWrap,
  comments: MessageSquareText,
  theme: Palette,
  search: Search,
  sidebar: PanelLeft,
  compare: GitCompare,
  check: Check,
  trash: Trash2,
  close: X,
} as const;

export type IconName = keyof typeof ICONS;

const EXTENSION_ICONS: Record<string, IconName> = {
  bmp: 'fileImage',
  c: 'fileCode',
  cc: 'fileCode',
  cpp: 'fileCode',
  cs: 'fileCode',
  css: 'fileCode',
  gif: 'fileImage',
  go: 'fileCode',
  h: 'fileCode',
  hpp: 'fileCode',
  html: 'fileCode',
  ico: 'fileImage',
  java: 'fileCode',
  jpeg: 'fileImage',
  jpg: 'fileImage',
  js: 'fileCode',
  json: 'fileCode',
  jsx: 'fileCode',
  kt: 'fileCode',
  lock: 'fileLock',
  md: 'fileText',
  mjs: 'fileCode',
  mts: 'fileCode',
  php: 'fileCode',
  png: 'fileImage',
  py: 'fileCode',
  rb: 'fileCode',
  rs: 'fileCode',
  scss: 'fileCode',
  sh: 'fileCode',
  sql: 'fileCode',
  svg: 'fileImage',
  swift: 'fileCode',
  toml: 'fileCode',
  ts: 'fileCode',
  tsx: 'fileCode',
  txt: 'fileText',
  webp: 'fileImage',
  yaml: 'fileCode',
  yml: 'fileCode',
  zsh: 'fileCode',
};

/** Renders a lucide glyph sized by the surrounding font via `1em` in CSS. */
export const icon = (name: IconName, className = ''): SVGElement =>
  createElement(ICONS[name], {
    class: className === '' ? 'dv-icon' : `dv-icon ${className}`,
    'aria-hidden': 'true',
    focusable: 'false',
    width: '1em',
    height: '1em',
  });

export const fileIconName = (path: string): IconName => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name.endsWith('.lock') || name === 'bun.lock') return 'fileLock';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'file';
  return EXTENSION_ICONS[name.slice(dot + 1).toLowerCase()] ?? 'file';
};
