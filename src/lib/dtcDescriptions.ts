/**
 * Plain-English trouble-code descriptions for the ENGINE face. PURE — no imports.
 *
 * Generic P0/P2 meanings are the SAE J2012 standard definitions (the 2016 Tacoma
 * 2TR-FE reports these). P1xxx codes are manufacturer-specific; the ones here are
 * common Toyota definitions, labelled "Toyota". Anything not in the table falls back
 * to a family hint from its prefix. Short by design — a glance, not a manual.
 */

const DTC: Readonly<Record<string, string>> = {
  // ---- fuel & air metering ----
  P0011: 'Intake cam timing over-advanced (bank 1)',
  P0012: 'Intake cam timing over-retarded (bank 1)',
  P0016: 'Crank / cam position correlation (bank 1)',
  P0031: 'O2 / A-F sensor heater circuit low (B1 S1)',
  P0032: 'O2 / A-F sensor heater circuit high (B1 S1)',
  P0037: 'O2 sensor heater circuit low (B1 S2)',
  P0038: 'O2 sensor heater circuit high (B1 S2)',
  P0100: 'Mass airflow (MAF) circuit',
  P0101: 'Mass airflow (MAF) range / performance',
  P0102: 'Mass airflow (MAF) circuit low',
  P0103: 'Mass airflow (MAF) circuit high',
  P0106: 'Manifold pressure (MAP) range / performance',
  P0107: 'Manifold pressure (MAP) circuit low',
  P0108: 'Manifold pressure (MAP) circuit high',
  P0110: 'Intake air temp sensor circuit',
  P0112: 'Intake air temp sensor low',
  P0113: 'Intake air temp sensor high',
  P0115: 'Coolant temp sensor circuit',
  P0116: 'Coolant temp sensor range / performance',
  P0117: 'Coolant temp sensor low',
  P0118: 'Coolant temp sensor high',
  P0120: 'Throttle position sensor circuit',
  P0121: 'Throttle position sensor range / performance',
  P0122: 'Throttle position sensor low',
  P0123: 'Throttle position sensor high',
  P0125: 'Coolant too cold for closed-loop fueling',
  P0128: 'Thermostat — coolant below regulating temp',
  P0130: 'O2 sensor circuit (B1 S1)',
  P0133: 'O2 sensor slow response (B1 S1)',
  P0135: 'O2 sensor heater circuit (B1 S1)',
  P0136: 'O2 sensor circuit (B1 S2)',
  P0137: 'O2 sensor low voltage (B1 S2)',
  P0138: 'O2 sensor high voltage (B1 S2)',
  P0141: 'O2 sensor heater circuit (B1 S2)',
  P0155: 'O2 sensor heater circuit (B2 S1)',
  P0171: 'System too lean (bank 1)',
  P0172: 'System too rich (bank 1)',
  P0174: 'System too lean (bank 2)',
  P0175: 'System too rich (bank 2)',
  P0220: 'Throttle / pedal position sensor B circuit',
  P0222: 'Throttle / pedal position sensor B low',
  P0223: 'Throttle / pedal position sensor B high',
  // ---- ignition / misfire ----
  P0300: 'Random / multiple cylinder misfire',
  P0301: 'Cylinder 1 misfire',
  P0302: 'Cylinder 2 misfire',
  P0303: 'Cylinder 3 misfire',
  P0304: 'Cylinder 4 misfire',
  P0305: 'Cylinder 5 misfire',
  P0306: 'Cylinder 6 misfire',
  P0325: 'Knock sensor circuit (bank 1)',
  P0327: 'Knock sensor circuit low (bank 1)',
  P0328: 'Knock sensor circuit high (bank 1)',
  P0335: 'Crankshaft position sensor circuit',
  P0340: 'Camshaft position sensor circuit (bank 1)',
  P0351: 'Ignition coil A circuit',
  P0352: 'Ignition coil B circuit',
  P0353: 'Ignition coil C circuit',
  P0354: 'Ignition coil D circuit',
  // ---- emissions controls ----
  P0401: 'EGR flow insufficient',
  P0420: 'Catalyst efficiency below threshold (bank 1)',
  P0430: 'Catalyst efficiency below threshold (bank 2)',
  P0440: 'EVAP system malfunction',
  P0441: 'EVAP incorrect purge flow',
  P0442: 'EVAP small leak detected',
  P0446: 'EVAP vent control circuit',
  P0451: 'EVAP pressure sensor range / performance',
  P0455: 'EVAP large leak (check the gas cap)',
  P0456: 'EVAP very small leak',
  // ---- speed / idle / computer ----
  P0500: 'Vehicle speed sensor',
  P0505: 'Idle control system',
  P0560: 'System voltage',
  P0606: 'ECM processor fault',
  // ---- transmission ----
  P0705: 'Transmission range sensor circuit',
  P0711: 'Trans fluid temp sensor range / performance',
  P0712: 'Trans fluid temp sensor low',
  P0713: 'Trans fluid temp sensor high',
  P0715: 'Transmission input speed sensor',
  P0741: 'Torque converter clutch stuck off',
  P0750: 'Shift solenoid A',
  // ---- generic P2 (A/F sensor family the 2TR-FE uses) ----
  P2195: 'A/F sensor stuck lean (B1 S1)',
  P2196: 'A/F sensor stuck rich (B1 S1)',
  P2238: 'A/F sensor positive circuit low (B1 S1)',
  P2239: 'A/F sensor positive circuit high (B1 S1)',
  P2252: 'A/F sensor negative circuit low (B1 S1)',
  P2253: 'A/F sensor negative circuit high (B1 S1)',
  P2419: 'EVAP switching valve circuit low',
  // ---- Toyota manufacturer-specific (older but common) ----
  P1130: 'Toyota: A/F sensor range / performance (B1 S1)',
  P1133: 'Toyota: A/F sensor response (B1 S1)',
  P1135: 'Toyota: A/F sensor heater circuit (B1 S1)',
  P1346: 'Toyota: VVT sensor range / performance',
  P1349: 'Toyota: VVT system malfunction',
  P1600: 'Toyota: ECM battery backup circuit',
  P1604: 'Toyota: startability malfunction',
  P1656: 'Toyota: oil control valve (VVT) circuit',
};

/** Family hints by prefix, most specific first. */
const FAMILIES: readonly [string, string][] = [
  ['P0A', 'Hybrid system'],
  ['P00', 'Fuel / air metering & aux emissions'],
  ['P01', 'Fuel / air metering'],
  ['P02', 'Fuel / air metering (injectors)'],
  ['P03', 'Ignition system or misfire'],
  ['P04', 'Auxiliary emissions controls'],
  ['P05', 'Speed, idle control or aux inputs'],
  ['P06', 'Computer & output circuits'],
  ['P07', 'Transmission'],
  ['P08', 'Transmission'],
  ['P09', 'Transmission'],
  ['P1', 'Manufacturer-specific (Toyota)'],
  ['P2', 'Powertrain (fuel / air / emissions)'],
  ['P3', 'Powertrain (ignition / misc)'],
  ['B', 'Body'],
  ['C', 'Chassis'],
  ['U', 'Network / communication'],
];

const CODE_RE = /^[PCBU][0-3][0-9A-F]{3}$/;

/** Short description for a code, e.g. "P0420" → "Catalyst efficiency below threshold (bank 1)". */
export function describeDtc(code: string): string {
  const c = code.trim().toUpperCase();
  const exact = DTC[c];
  if (exact) return exact;
  if (!CODE_RE.test(c)) return 'Unrecognised code';
  const fam = FAMILIES.find(([p]) => c.startsWith(p));
  return fam ? `${fam[1]} — see service manual` : 'See service manual';
}

export const DTC_DESCRIPTION_COUNT = Object.keys(DTC).length;
