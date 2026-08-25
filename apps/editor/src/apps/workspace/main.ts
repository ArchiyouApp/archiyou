import '@awesome.me/webawesome/dist/styles/webawesome.css';
import '@awesome.me/webawesome/dist/webawesome.js';
import { applyDesignTokens } from '../../styles/design-tokens.js';
import '../../icons.js';
import './app-shell.js';

// Inject CSS custom properties into :root before first render
applyDesignTokens();
