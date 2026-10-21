/**
 * Tier A — network state for the header's WI-FI / LTE indicators, via expo-network.
 * Event-driven (addNetworkStateListener) with one initial read, so it costs nothing
 * per frame. Android reports the ACTIVE network only: with Wi-Fi up, a SIM that's also
 * attached reads as "LTE off". Good enough for "am I online, and how".
 *
 * Native only — reached solely through LiveDataSource.
 */
import * as Network from 'expo-network';

export interface ConnectivitySnapshot {
  wifi: boolean;
  lte: boolean;
}

export class ConnectivityProvider {
  private snap: ConnectivitySnapshot = { wifi: false, lte: false };
  private sub: { remove: () => void } | null = null;

  start(): void {
    const apply = (s: { type?: Network.NetworkStateType; isConnected?: boolean }) => {
      const up = !!s.isConnected;
      this.snap = {
        wifi: up && s.type === Network.NetworkStateType.WIFI,
        lte: up && s.type === Network.NetworkStateType.CELLULAR,
      };
    };
    Network.getNetworkStateAsync().then(apply).catch(() => {});
    try {
      this.sub = Network.addNetworkStateListener(apply);
    } catch {
      // listener unavailable in this native build — the initial read still lands
    }
  }

  stop(): void {
    this.sub?.remove();
    this.sub = null;
  }

  getSnapshot(): ConnectivitySnapshot {
    return this.snap;
  }
}
