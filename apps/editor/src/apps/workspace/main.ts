import '@awesome.me/webawesome/dist/styles/webawesome.css';
import '@awesome.me/webawesome/dist/webawesome.js';
import { applyDesignTokens } from '../../styles/design-tokens.js';
import { reportUncaughtErrors } from '../../services/signals.js';
import '../../icons.js';
import './app-shell.js';

// Inject CSS custom properties into :root before first render
applyDesignTokens();

// Crashes of the app itself reach the team (services/signals.ts), from a configurator page
// as much as from the editor.
reportUncaughtErrors(window.location.pathname.startsWith('/configurators/') ? 'configurator' : 'editor');
