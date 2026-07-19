import { registerRootComponent } from 'expo';

import App from './App';

// Native keeps the established application entry and navigation controller.
// Metro resolves entry.web.ts on the browser platform instead.
registerRootComponent(App);
