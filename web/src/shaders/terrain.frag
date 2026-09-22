// Terrain: forest canopy, rock, alpine, snow and shore by height and slope, with relief finer than
// the grid, lit by the sun and faded into haze. Preceded by sky_common.glsl and noise.glsl.
uniform vec3 ambGround; uniform float fogDensity; uniform float uClip; uniform vec4 uHole; uniform float uDetail;
varying vec3 vW; varying vec3 vN; varying float vCav;
float hashC(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Tree crowns: the nearest jittered point in a grid (one crown per cell). Returns distance to the
// crown centre, the offset to it (for a dome-shaped crown normal) and the crown's hash (for colour).
vec4 crowns(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float best = 9.0; vec2 bo = vec2(0.0); float bh = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    float hh = hashC(i + g);
    vec2 o = g + vec2(hh, hashC(i + g + 19.19)) * 0.8 + 0.1 - f;
    float dd = dot(o, o);
    if (dd < best) { best = dd; bo = o; bh = hh; }
  }
  return vec4(sqrt(best), bo, bh);
}
float ridged(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0)); p = p * 2.07 + 13.7; a *= 0.5; } return s; }
// Relief finer than the 30 m grid, in metres: ridged rock plus gullies running down the slope.
float relief(vec2 p, vec2 down){
  vec2 s = vec2(dot(p, down), dot(p, vec2(-down.y, down.x)));
  float gully = 1.0 - abs(vnoise(vec2(s.x / 320.0, s.y / 34.0)) * 2.0 - 1.0);
  return ridged(p / 75.0) * 20.6 + gully * gully * 12.0; // 3 octaves, rescaled to the old 4-octave range
}
void main(){
  // Ground covered by one pixel (metres, in plan view). Patterns smaller than about twice this
  // can't be drawn and turn into crawling noise, so each one fades out by it.
  float fp = max(length(dFdx(vW.xz)), length(dFdy(vW.xz)));
  if (uClip > 0.5 && vW.y < -0.3) discard;
  if (vW.x > uHole.x && vW.x < uHole.z && vW.z > uHole.y && vW.z < uHole.w) discard;
  vec3 V = vW - cameraPosition; float dist = length(V); vec3 vd = V / dist;
  // Fine detail fades out with distance, and is skipped in the half-resolution reflection pass.
  float detail = uDetail * (1.0 - uClip);
  float near = (1.0 - smoothstep(2500.0, 9000.0, dist)) * detail;
  vec3 n0 = normalize(vN);
  float h = vW.y;
  vec2 p = vW.xz;
  // Rugged relief: bend the normal by the slope of the fine relief, most on steep and high ground.
  float rug = smoothstep(0.06, 0.40, 1.0 - n0.y) * (0.35 + 0.65 * smoothstep(250.0, 1100.0, h)) * (0.35 + 0.65 * near) * detail;
  vec3 n = n0;
  if (rug > 0.01 && h > 2.0) {
    vec2 down = n0.xz / max(length(n0.xz), 1e-4);
    float r0 = relief(p, down);
    vec2 gr = vec2(relief(p + vec2(3.0, 0.0), down) - r0, relief(p + vec2(0.0, 3.0), down) - r0) / 3.0;
    n = normalize(n0 + vec3(-gr.x, 0.0, -gr.y) * rug);
  }
  float slope = 1.0 - n.y;
  float n1 = fbm2(p * 0.0035), n2 = fbm2(p * 0.028);
  float n3 = mix(vnoise(p * 0.22), 0.5, smoothstep(1.2, 3.5, fp)), n4 = mix(vnoise(p * 1.3), 0.5, smoothstep(0.2, 0.6, fp));
  // Forest canopy: thousands of crowns about 6.5 m across with dark gaps between them.
  // Each crown layer fades to the averaged forest tone once a pixel covers too much ground to draw it.
  float near1 = near * (1.0 - smoothstep(0.9, 2.4, fp));
  float near2 = 1.0 - smoothstep(0.55, 1.5, fp);
  vec4 cr = near1 > 0.001 ? crowns(p / 6.5) : vec4(1.0, 0.0, 0.0, 0.5);
  // A second, smaller crown layer breaks up the regular dot pattern.
  float cr2 = near1 * near2 > 0.001 ? crowns(p / 3.9 + 41.7).x : 1.0;
  float crown = max(1.0 - smoothstep(0.30, 0.80, cr.x), 0.7 * near2 * (1.0 - smoothstep(0.25, 0.75, cr2)));
  near = near1;
  float stand = 0.75 + 0.5 * n2; // stand-scale light/dark variation
  vec3 crownCol = cr.w < 0.45 ? vec3(0.020, 0.036, 0.021) : cr.w < 0.8 ? vec3(0.030, 0.047, 0.026) : vec3(0.025, 0.040, 0.031);
  float decid = smoothstep(0.62, 0.8, n1) * (1.0 - smoothstep(120.0, 400.0, h)); // alder and maple low down
  if (fract(cr.w * 7.31) < decid * 0.7) crownCol = vec3(0.055, 0.075, 0.030);
  crownCol *= (0.8 + 0.45 * fract(cr.w * 13.7)) * stand;
  vec3 gapCol = vec3(0.011, 0.017, 0.012);
  vec3 forestFar = mix(gapCol, vec3(0.026, 0.042, 0.024) * stand, 0.62);
  vec3 forest = mix(forestFar, mix(gapCol, crownCol, crown), near);
  vec3 crownN = normalize(n + vec3(-cr.y, 0.0, -cr.z) * 0.7 * crown * near);
  vec3 rock = mix(vec3(0.15, 0.155, 0.16), vec3(0.30, 0.30, 0.29), n2) * (0.75 + 0.4 * n3);
  vec3 sand = vec3(0.44, 0.40, 0.32) * (0.85 + 0.25 * n4);
  vec3 wet = vec3(0.075, 0.068, 0.06) * (0.8 + 0.4 * n3);
  vec3 alpine = vec3(0.17, 0.17, 0.10);
  vec3 snow = vec3(0.86, 0.89, 0.93);
  float alpineAmt = smoothstep(950.0, 1150.0, h + n1 * 140.0);
  float rockAmt = max(smoothstep(0.40, 0.58, slope + (n2 - 0.5) * 0.3), smoothstep(1220.0, 1380.0, h + n1 * 160.0));
  float snowAmt = smoothstep(1280.0, 1420.0, h + n1 * 220.0 - slope * 320.0 - n.z * 120.0);
  float shore = 1.0 - smoothstep(0.6, 3.5 + n2 * 4.0, h);
  vec3 c = mix(forest, alpine, alpineAmt);
  c = mix(c, rock, rockAmt);
  c = mix(c, snow, snowAmt);
  vec3 shoreCol = mix(wet * 1.7, sand, smoothstep(0.5, 0.72, n1) * (1.0 - smoothstep(0.15, 0.4, slope)));
  c = mix(c, shoreCol, shore);
  c = mix(c, wet, (1.0 - smoothstep(0.0, 0.8, h)) * 0.6);
  if (h < 0.0) c = mix(sand * 0.75, vec3(0.11, 0.10, 0.085), smoothstep(0.0, -25.0, h));
  // Light the canopy with the crown normals, and let the gaps between crowns sit in shade.
  float forestW = (1.0 - alpineAmt) * (1.0 - rockAmt) * (1.0 - snowAmt) * (1.0 - shore) * step(0.0, h);
  vec3 nl = normalize(mix(n, crownN, forestW));
  float diff = max(dot(nl, sunDir), 0.0) * mix(1.0, mix(0.6, 1.0, crown), forestW * near);
  float ao = clamp(1.0 - vCav * 0.55, 0.35, 1.25);
  vec3 amb = mix(ambGround, ambSky, nl.y * 0.5 + 0.5) * ao;
  vec3 col = c * (sunCol * diff * mix(1.0, 0.85, smoothstep(0.4, 1.0, vCav)) + amb);
  float fogAmt = 1.0 - exp(-dist * fogDensity * 1.35 * (exp(-max(h, 0.0) * 0.0005) * 0.8 + 0.2));
  col = mix(col, hazeColor(normalize(vec3(vd.x, max(vd.y, -0.05), vd.z))), fogAmt);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
