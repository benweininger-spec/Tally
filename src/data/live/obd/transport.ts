/**
 * OBD transport boundary. The ELM327 driver (ObdManager) talks ONLY to this
 * interface — never to a specific Bluetooth library — so a BLE backend (OBDLink
 * MX+, Veepeak BLE) can be swapped in behind the same contract without touching
 * any PID/parse logic. This mirrors the project's DataSource/Signal philosophy
 * one layer down. Pure types only (no imports).
 *
 * Most cheap ELM327 clones are Bluetooth Classic (SPP/RFCOMM) → ClassicSppTransport.
 */

export type TransportStatus = 'disconnected' | 'connecting' | 'connected';

export interface ObdTransport {
  readonly status: TransportStatus;
  /** Open the link (pair/connect). Rejects on failure. */
  connect(): Promise<void>;
  /** Close the link. Always safe to call. */
  disconnect(): Promise<void>;
  /** Send a command; the transport appends the ELM327 CR ('\r') terminator. */
  write(cmd: string): Promise<void>;
  /**
   * Subscribe to inbound frames, each already split on the ELM327 line/prompt
   * delimiter. Returns an unsubscribe fn.
   */
  onFrame(cb: (frame: string) => void): () => void;
  /** Notified when the link drops unexpectedly. Returns an unsubscribe fn. */
  onDisconnect(cb: () => void): () => void;
}

/** A bonded device the user can pick as the OBD adapter. */
export interface ObdDevice {
  name: string;
  address: string;
}
