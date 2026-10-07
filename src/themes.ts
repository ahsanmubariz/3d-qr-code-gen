import * as THREE from 'three';

export type Scheme = 'core-blue' | 'hitech-violet' | 'legacy-purple' | 'soft-purple';
export type Season = Scheme | 'spring' | 'summer' | 'autumn';
export const SCHEMES: Scheme[] = ['core-blue', 'hitech-violet', 'legacy-purple', 'soft-purple'];
export const SEASONS: Season[] = SCHEMES;

export interface Theme {
  primary: string;
  name: string;
  qrDark: string;
  leaves: string[];
  grass: string[];
  moss: string;
  petals: string[];
  light: string[];
  bark: string;
}

export const THEMES: Record<string, Theme> = {
  // REQ-01 (Core Blue): Primary brand color #202887
  'core-blue': {
    primary: '#202887',
    name: 'Core Blue',
    qrDark: '#202887',
    leaves: ['#202887', '#2e389e', '#161d6e', '#3c47be'],
    grass: ['#2b3487', '#3c48a8', '#1f266c'],
    moss: '#242b70',
    petals: ['#3E3EF4', '#5555f6'],
    light: ['#f3f4fa', '#eaeef8', '#f7f8fd'],
    bark: '#1a1e45',
  },
  // REQ-02 (Hi-tech Violet): Primary accent color #3E3EF4
  'hitech-violet': {
    primary: '#3E3EF4',
    name: 'Hi-tech Violet',
    qrDark: '#3E3EF4',
    leaves: ['#3E3EF4', '#5757f7', '#2727db', '#7070fa'],
    grass: ['#4242e0', '#5656f0', '#3232c4'],
    moss: '#3838b0',
    petals: ['#7070fa', '#9292fc'],
    light: ['#f2f3fd', '#e9ecfb', '#f8f9fe'],
    bark: '#21204a',
  },
  // REQ-03 (Legacy Purple): Secondary accent color #D861FF
  'legacy-purple': {
    primary: '#D861FF',
    name: 'Legacy Purple',
    qrDark: '#B832E5',
    leaves: ['#D861FF', '#e17eff', '#c045ea', '#eb99ff'],
    grass: ['#b351d5', '#c769e6', '#993ab8'],
    moss: '#9642b3',
    petals: ['#e17eff', '#f0b5ff'],
    light: ['#fbf4fd', '#f7e9fc', '#fdf9fe'],
    bark: '#3b2047',
  },
  // REQ-04 (Soft Purple): Surface accent color #D8D8FC
  'soft-purple': {
    primary: '#D8D8FC',
    name: 'Soft Purple',
    qrDark: '#504DA8',
    leaves: ['#6663BF', '#7A77CE', '#5451B0', '#8F8DE0'],
    grass: ['#8686db', '#9a9ae5', '#7171c7'],
    moss: '#7777be',
    petals: ['#D8D8FC', '#ebebfd'],
    light: ['#f6f6fc', '#efeffa', '#fafafd'],
    bark: '#323048',
  },
};

// Aliases for backward compatibility
THEMES['spring'] = THEMES['core-blue'];
THEMES['summer'] = THEMES['hitech-violet'];
THEMES['autumn'] = THEMES['legacy-purple'];

/** Builds a leaf palette around a custom brand colour. */
export function customLeaves(hex: string): string[] {
  const base = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const variant = (dh: number, ds: number, dl: number) =>
    '#' +
    new THREE.Color()
      .setHSL((hsl.h + dh + 1) % 1, THREE.MathUtils.clamp(hsl.s + ds, 0, 1), THREE.MathUtils.clamp(hsl.l + dl, 0.05, 0.92))
      .getHexString();
  return [variant(0, 0, 0), variant(0.01, -0.05, 0.08), variant(-0.01, 0.05, -0.08), variant(0.02, -0.1, 0.15)];
}

export function isValidColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** Relative luminance of a linear-space colour (WCAG formula). */
export function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
