/** Couleurs et retouches de pixels, fonctions pures (testables hors navigateur). */

export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
export const rgbToHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

/**
 * Pipette : couleur médiane d'un petit carré autour du point (le grain de la photo
 * et un pixel isolé — reflet, poussière — ne faussent pas la teinte prélevée).
 */
export function sampleColor(img: Pixels, x: number, y: number, radius = 3) {
  const cx = Math.round(x), cy = Math.round(y);
  const vals: [number[], number[], number[]] = [[], [], []];
  for (let j = cy - radius; j <= cy + radius; j++)
    for (let i = cx - radius; i <= cx + radius; i++) {
      if (i < 0 || j < 0 || i >= img.width || j >= img.height) continue;
      const k = (j * img.width + i) * 4;
      vals[0].push(img.data[k]!);
      vals[1].push(img.data[k + 1]!);
      vals[2].push(img.data[k + 2]!);
    }
  if (!vals[0].length) return null;
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1]!;
  return rgbToHex(med(vals[0]), med(vals[1]), med(vals[2]));
}

/**
 * Correction automatique de lumière (reprise de l'ancienne version en ligne) : niveaux
 * par canal — balance des blancs et exposition — puis léger contraste. Les pixels
 * transparents (détourage) sont ignorés dans le calcul et conservés tels quels.
 */
export function autoEnhance(img: Pixels, strength = 0.85): Pixels {
  const { data } = img;
  const out = new Uint8ClampedArray(data);
  const lo: number[] = [], hi: number[] = [];
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 0) { hist[data[i + c]!]!++; total++; }
    let acc = 0, l = 0, h = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= total * 0.01) { l = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc >= total * 0.01) { h = v; break; } }
    lo.push(l);
    hi.push(Math.max(l + 1, h));
  }
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c]!;
      let s = ((v - lo[c]!) / (hi[c]! - lo[c]!)) * 255;
      s = 128 + (s - 128) * 1.06 + 6; // léger contraste + éclaircissement
      out[i + c] = v * (1 - strength) + s * strength;
    }
  }
  return { ...img, data: out };
}
