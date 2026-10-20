// Barrel for the local MediaBridge module. The app resolves it directly via
// requireNativeModule('MediaBridge') in src/data/live/mediaBridge.ts, so this is
// only here for completeness / direct imports.
import { requireNativeModule } from 'expo';

export default requireNativeModule('MediaBridge');
