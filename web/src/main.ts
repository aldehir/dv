import './styles/reset.css';
import './styles/victor-mono.css';
import './theme/theme.css';
import './styles/app.css';
import { createClient, readTokenFromDocument } from './api/client';
import { createLoader } from './api/loader';
import { createBus } from './core/bus';
import { createLazyOverlay } from './core/component';
import { createRouter } from './core/router';
import { createInitialState, createStore } from './core/store';
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

const shell = createShell({
  ...deps,
  toolbar: createToolbar(deps).el,
  sidebar: createFileTree(deps).el,
  status: createStatusBar({ store }).el,
});

const help = createLazyOverlay(shell.overlays, () =>
  import('./ui/help').then((module) => module.createHelp(deps)),
);

createThemeController(deps).start();
createKeybinds(deps);
createRouter(deps);
createLoader({ ...deps, client }).start();

bus.on('help:toggle', help.toggle);
bus.on('overlay:dismiss', help.close);

document.getElementById('app')?.replaceChildren(shell.el);
