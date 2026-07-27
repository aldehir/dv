import './styles/reset.css';
import './styles/victor-mono.css';
import './theme/theme.css';
import './styles/app.css';
import { createClient, readTokenFromDocument } from './api/client';
import { createLoader } from './api/loader';
import { createInbox } from './comments/inbox';
import { createCommentsStore } from './comments/store';
import { createBus } from './core/bus';
import { createLazyOverlay } from './core/component';
import { createRouter } from './core/router';
import { createInitialState, createStore } from './core/store';
import { createViewer } from './diff/viewer';
import { createThemeController } from './theme/controller';
import { createFileTree } from './ui/file-tree';
import { createKeybinds } from './ui/keybinds';
import { createShell } from './ui/shell';
import { createStatusBar } from './ui/status-bar';
import { createToolbar } from './ui/toolbar';

const store = createStore(createInitialState());
const bus = createBus();
const client = createClient({ token: readTokenFromDocument() });
const deps = { store, bus };
const loader = createLoader({ ...deps, client });
const comments = createCommentsStore({ ...deps, client });

const shell = createShell({
  ...deps,
  toolbar: createToolbar(deps).el,
  sidebar: createFileTree(deps).el,
  status: createStatusBar({ store }).el,
});

const root = shell.mount;
const viewer = createViewer({ ...deps, comments, root, loadFile: loader.loadFile });

const help = createLazyOverlay(shell.overlays, () =>
  import('./ui/help').then((module) => module.createHelp(deps)),
);
const composer = createLazyOverlay(shell.overlays, () =>
  import('./comments/composer').then((m) => m.createComposer({ bus, comments, viewer })),
);

createThemeController(deps).start();
createKeybinds(deps);
createRouter(deps);
shell.panel.replaceChildren(createInbox({ ...deps, comments, viewer }).el);

bus.on('help:toggle', help.toggle);
bus.on('comment:compose', (i) => { comments.setCompose(i); composer.open(); });
bus.on('overlay:dismiss', () => { help.close(); composer.close(); });

loader.start();
comments.start();
document.getElementById('app')?.replaceChildren(shell.el);
