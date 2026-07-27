import './styles/reset.css';
import './styles/inter.css';
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
import { createRail } from './diff/rail';
import { createViewer } from './diff/viewer';
import { createThemeController } from './theme/controller';
import { createControls } from './ui/controls';
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
  controls: createControls(deps).el,
  status: createStatusBar({ store }).el,
});

const root = shell.mount;
const viewer = createViewer({ ...deps, comments, root, loadFile: loader.loadFile });

const help = createLazyOverlay(shell.overlays, () =>
  import('./ui/help').then((module) => module.createHelp(deps)),
);

createThemeController(deps).start();
createKeybinds(deps);
createRouter(deps);
shell.main.appendChild(createRail({ ...deps, comments, viewer }).el);
shell.panel.replaceChildren(createInbox({ ...deps, comments, viewer }).el);

bus.on('help:toggle', help.toggle);
bus.on('overlay:dismiss', () => { help.close(); store.set({ selection: null, composing: null }); });

loader.start();
comments.start();
document.getElementById('app')?.replaceChildren(shell.el);
