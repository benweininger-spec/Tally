/**
 * Bluetooth Classic (SPP/RFCOMM) transport for ELM327 clones, on top of
 * `react-native-bluetooth-classic` (v1.73.0-rc.x). Android only — Classic SPP on
 * iOS needs MFi, which generic clones don't have; this dashboard targets Android 13.
 *
 * IMPORTANT: the BT library is `require`d LAZILY (inside connect), so simply
 * importing this file — or the LiveDataSource — never pulls the native module into
 * the bundle until the user actually connects OBD. Pre-pair the dongle in Android
 * Settings and connect by MAC to avoid the scan + location permission entirely.
 *
 * Permissions (Android 12+) are declared by plugins/withBluetoothClassic.js and
 * requested at runtime in requestBluetoothPermissions() below.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import type { ObdDevice, ObdTransport, TransportStatus } from './transport';

// Loaded lazily so the module is only resolved when OBD is actually used.
type RNBC = any;
let rnbc: RNBC | null = null;
function bt(): RNBC {
  if (!rnbc) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    rnbc = require('react-native-bluetooth-classic').default;
  }
  return rnbc;
}

/** Request the runtime BT permissions needed on Android 12+ (API 31+). */
export async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return true;
  const res = await PermissionsAndroid.requestMultiple([
    'android.permission.BLUETOOTH_CONNECT' as any,
    'android.permission.BLUETOOTH_SCAN' as any,
  ]);
  return Object.values(res).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

const OBD_NAME = /OBD|ELM|VLINK|VIECAR|VEEPEAK|OBDII|SCAN|VGATE/i;

/** All bonded devices, with likely OBD adapters sorted first so the picker is easy.
 *  (Clone names are inconsistent, so we never hide devices — just rank them.) */
export async function listBondedObdDevices(): Promise<ObdDevice[]> {
  const bonded = await bt().getBondedDevices();
  return (bonded as any[])
    .map((d) => ({ name: d.name ?? '', address: d.address ?? d.id }))
    .sort((a, b) => Number(OBD_NAME.test(b.name)) - Number(OBD_NAME.test(a.name)));
}

export class ClassicSppTransport implements ObdTransport {
  status: TransportStatus = 'disconnected';
  private device: any = null;
  private connectedAddress: string | null = null;
  private dataSub: { remove: () => void } | null = null;
  private discSub: { remove: () => void } | null = null;
  private frameCbs = new Set<(f: string) => void>();
  private discCbs = new Set<() => void>();

  /** @param address bonded MAC of the dongle (preferred), else first OBD-named device. */
  constructor(private readonly address?: string) {}

  async connect(): Promise<void> {
    if (this.status === 'connected') return;
    this.status = 'connecting';
    try {
      const ok = await requestBluetoothPermissions();
      if (!ok) throw new Error('Bluetooth permission denied');

      let address = this.address;
      if (!address) {
        const devs = await listBondedObdDevices();
        if (!devs.length) throw new Error('No bonded OBD adapter found — pair it in Android Settings first');
        address = devs[0].address;
      }
      this.connectedAddress = address;

      // Delimit on the ELM327 '>' prompt so each onDataReceived frame is a COMPLETE
      // response (all lines since the last prompt, e.g. "SEARCHING...\r41 0C 1A F8").
      // We append '\r' on write; responses never contain '>', so this is safe and
      // lets ObdManager resolve a command on a single frame.
      this.device = await bt().connectToDevice(address, {
        delimiter: '>',
        charset: 'ascii',
        CONNECTOR_TYPE: 'rfcomm',
      });

      this.dataSub = this.device.onDataReceived((ev: any) => {
        const data: string = ev?.data ?? '';
        if (data) this.frameCbs.forEach((cb) => cb(data));
      });
      // onDeviceDisconnected is a MODULE-LEVEL event: it fires for EVERY bonded
      // device (payload is BluetoothDeviceEvent → evt.device.address). We must only
      // react to OUR dongle — otherwise the phone's media Bluetooth (Tier B)
      // disconnecting would spuriously kill OBD. If the event has no address, don't
      // blindly tear down: verify our own link is actually gone first.
      this.discSub = bt().onDeviceDisconnected((evt: any) => {
        const addr = evt?.device?.address ?? evt?.device?.id;
        if (addr) {
          if (addr === this.connectedAddress) this.handleDrop();
          return;
        }
        Promise.resolve(this.device?.isConnected?.())
          .then((up) => {
            if (up === false) this.handleDrop();
          })
          .catch(() => {
            /* can't tell → leave it; poll timeouts will age readings out gracefully */
          });
      });

      this.status = 'connected';
    } catch (e) {
      this.status = 'disconnected';
      await this.cleanup();
      throw e;
    }
  }

  private handleDrop() {
    if (this.status === 'disconnected') return;
    this.status = 'disconnected';
    this.discCbs.forEach((cb) => cb());
    void this.cleanup();
  }

  private async cleanup() {
    this.dataSub?.remove();
    this.discSub?.remove();
    this.dataSub = null;
    this.discSub = null;
    if (this.device) {
      try {
        await this.device.disconnect();
      } catch {
        /* ignore */
      }
      this.device = null;
    }
    this.connectedAddress = null;
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    await this.cleanup();
  }

  async write(cmd: string): Promise<void> {
    if (!this.device) throw new Error('OBD not connected');
    await this.device.write(cmd + '\r');
  }

  onFrame(cb: (frame: string) => void): () => void {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }

  onDisconnect(cb: () => void): () => void {
    this.discCbs.add(cb);
    return () => this.discCbs.delete(cb);
  }
}
