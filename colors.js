// Rampas de cores: PT / Campo Trabalhista (Vermelho) vs. PL / Campo Conservador (Azul)
export const DEM_C = ['#f6b4b4', '#ee8484', '#e35656', '#d72f30', '#ad1d1e', '#7a1112'];
export const REP_C = ['#b8c9f8', '#8aa6f2', '#5d82e8', '#3b5bdb', '#2742b0', '#192c7a'];
export const OTHER_HEX = '#7a8599';

export function bandIndex(marginPct) {
  const a = Math.abs(marginPct);
  if (a < 5) return 0;
  if (a < 10) return 1;
  if (a < 20) return 2;
  if (a < 30) return 3;
  if (a < 40) return 4;
  return 5;
}

export function marginColorHex(r, d) {
  const tot = r + d;
  if (!tot) return '#555';
  const m = ((r - d) / tot) * 100;
  const idx = bandIndex(m);
  return m >= 0 ? REP_C[idx] : DEM_C[idx];
}

function parseHex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(rgb) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(rgb[0]) + c(rgb[1]) + c(rgb[2]);
}
const NEUTRAL = [0x2a, 0x33, 0x46];
const REP_PEAK = parseHex(REP_C[4]);
const DEM_PEAK = parseHex(DEM_C[4]);

export function leadColorHex(r, d, maxLead) {
  const lead = r - d;
  if (!lead || !maxLead) return toHex(NEUTRAL);
  const t = Math.min(1, Math.pow(Math.abs(lead) / maxLead, 0.5));
  const target = lead > 0 ? REP_PEAK : DEM_PEAK;
  return toHex([
    NEUTRAL[0] + (target[0] - NEUTRAL[0]) * t,
    NEUTRAL[1] + (target[1] - NEUTRAL[1]) * t,
    NEUTRAL[2] + (target[2] - NEUTRAL[2]) * t,
  ]);
}

const SHIFT_MID = [0x8e, 0x5e, 0xa2];
const SHIFT_CAP = 0.20;
export function shiftColorHex(shift) {
  const s = Math.max(-1, Math.min(1, shift / SHIFT_CAP));
  if (s >= 0) {
    const t = Math.pow(s, 0.75);
    return toHex([
      SHIFT_MID[0] + (REP_PEAK[0] - SHIFT_MID[0]) * t,
      SHIFT_MID[1] + (REP_PEAK[1] - SHIFT_MID[1]) * t,
      SHIFT_MID[2] + (REP_PEAK[2] - SHIFT_MID[2]) * t,
    ]);
  }
  const t = Math.pow(-s, 0.75);
  return toHex([
    SHIFT_MID[0] + (DEM_PEAK[0] - SHIFT_MID[0]) * t,
    SHIFT_MID[1] + (DEM_PEAK[1] - SHIFT_MID[1]) * t,
    SHIFT_MID[2] + (DEM_PEAK[2] - SHIFT_MID[2]) * t,
  ]);
}

// Helpers adicionais para testes unitários
export function computeMargin(dem, rep, oth = 0) {
  const tot = (dem || 0) + (rep || 0) + (oth || 0);
  if (!tot) return 0;
  return ((dem || 0) - (rep || 0)) / tot;
}
export function marginColor(dem, rep, oth = 0) {
  return marginColorHex(rep, dem);
}
export function voteLeadColor(dem, rep, maxLead = 100000) {
  return leadColorHex(rep, dem, maxLead);
}
export const PT_RED = '#d72f30';
export const PL_BLUE = '#3b5bdb';
export const OTH_AMBER = '#f2c14e';
