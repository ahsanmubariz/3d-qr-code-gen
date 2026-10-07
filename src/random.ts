/** Deterministic hash noise in [0, 1). Same inputs → same tree, every time. */
export function makeRng(seedText: string) {
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) % 9973;
  return (a: number, b = 0, c = 0): number => {
    const v = Math.sin(127.1 * a + 311.7 * b + 43.7 * c + 7919 * seed * 0.001) * 43758.5453;
    return v - Math.floor(v);
  };
}

export type Rng = ReturnType<typeof makeRng>;
