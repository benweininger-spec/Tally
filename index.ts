import { registerRootComponent } from 'expo';
import App from './App';
import { registerKeepAliveTask } from './modules/js-keepalive';

// the never-ending headless task that keeps JS timers running while another app is in
// front (OBD polling, MPG logging, auto-connect) — started by LiveDataSource
registerKeepAliveTask();

registerRootComponent(App);
