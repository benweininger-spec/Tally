#!/usr/bin/env node
/**
 * Patch react-native-bluetooth-classic: a connect that HANGS (the vLinker asleep / the head
 * unit sleeping mid-dial) stays in the library's `mConnecting` map forever, and every later
 * connectToDevice() for that address is refused with "Already attempting connection" — the
 * dash then never reconnects until the app restarts (FACT, truck 2026-10-27).
 *
 * The patch (idempotent, run on `npm install` via postinstall):
 *  • a pending connect older than STALE_CONNECT_MS is cancelled (its socket closed, which
 *    unblocks the hung connect) and dropped when a new connect for that address arrives;
 *  • a connector's success / failure only clears the map entry if it is still ITS entry,
 *    so a late failure from the cancelled dial can't erase the new attempt.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules/react-native-bluetooth-classic/android/src/main/java/kjd/reactnative/bluetooth/RNBluetoothClassicModule.java'
);
if (!fs.existsSync(file)) {
  console.log('[patch-rnbc] library not installed — skipped');
  process.exit(0);
}
let s = fs.readFileSync(file, 'utf8');
if (s.includes('TACOMA_STALE_CONNECT_PATCH')) {
  console.log('[patch-rnbc] already applied');
  process.exit(0);
}
const rep = (a, b) => {
  if (!s.includes(a)) throw new Error('[patch-rnbc] anchor not found: ' + a.slice(0, 60));
  s = s.replace(a, b);
};

rep(
  `    private Map<String, ConnectionConnector> mConnecting;`,
  `    private Map<String, ConnectionConnector> mConnecting;

    // TACOMA_STALE_CONNECT_PATCH (scripts/patch-rnbc.js): when each pending connect started
    private final Map<String, Long> mConnectingSince = new ConcurrentHashMap<>(1);
    private static final long STALE_CONNECT_MS = 20000L;

    private static void cancelQuietly(ConnectionConnector c) {
        try {
            java.lang.reflect.Method m = ConnectionConnector.class.getDeclaredMethod("cancel");
            m.setAccessible(true);
            m.invoke(c); // closes the socket → the blocked connect() throws and the thread ends
        } catch (Throwable ignored) {
        }
        try {
            c.interrupt();
        } catch (Throwable ignored) {
        }
    }`
);

rep(
  `    public void connectToDevice(String address, ReadableMap parameters, Promise promise) {
        if (!checkBluetoothAdapter()) {`,
  `    public void connectToDevice(String address, ReadableMap parameters, Promise promise) {
        // TACOMA_STALE_CONNECT_PATCH: a dial that has hung past STALE_CONNECT_MS is dead — drop it
        Long since = mConnectingSince.get(address);
        if (since != null && System.currentTimeMillis() - since > STALE_CONNECT_MS) {
            ConnectionConnector stale = mConnecting.remove(address);
            mConnectingSince.remove(address);
            if (stale != null) {
                Log.w(TAG, "connectToDevice: cancelling a stale pending connect to " + address);
                cancelQuietly(stale);
            }
        }
        if (!checkBluetoothAdapter()) {`
);

// clear the map entry only if it is still this connector's
rep(
  `                    public void success(BluetoothSocket bluetoothSocket) {
                        // Remove from connecting and add to connected
                        mConnecting.remove(address);`,
  `                    public void success(BluetoothSocket bluetoothSocket) {
                        // Remove from connecting and add to connected
                        if (mConnecting.remove(address, connector)) mConnectingSince.remove(address);`
);
rep(
  `                    public void failure(Exception e) {
                        // Remove from connecting and notify of failure
                        mConnecting.remove(address);`,
  `                    public void failure(Exception e) {
                        // Remove from connecting and notify of failure
                        if (mConnecting.remove(address, connector)) mConnectingSince.remove(address);`
);
rep(
  `                mConnecting.put(address, connector);
                connector.start();`,
  `                mConnecting.put(address, connector);
                mConnectingSince.put(address, System.currentTimeMillis());
                connector.start();`
);

fs.writeFileSync(file, s);
console.log('[patch-rnbc] applied');
