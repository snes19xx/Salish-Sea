// Terrain: forest canopy, rock, alpine, snow and shore by height and slope, with relief finer than
// the grid, lit by the sun and faded into haze. Preceded by sky_common.glsl and noise.glsl.
uniform vec3 ambGround; uniform float fogDensity; uniform float uClip; uniform vec4 uHole; uniform float uDetail; uniform float uRelief;
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
// The gullies are noise stretched along x (for slopes facing east or west) and along z (north or
// south), blended by which way the slope faces. Turning one noise to each pixel's slope instead
// swung the pattern around the world origin, kilometres away, and drew rings on bumpy ground.
float relief(vec2 p, vec2 down){
  float gx = 1.0 - abs(vnoise(vec2(p.x / 320.0, p.y / 34.0)) * 2.0 - 1.0);
  float gz = 1.0 - abs(vnoise(vec2(p.y / 320.0, p.x / 34.0) + 7.3) * 2.0 - 1.0);
  float gully = gx * down.x * down.x + gz * down.y * down.y;
  return ridged(p / 75.0) * 20.6 + gully * gully * 12.0; // 3 octaves, rescaled to the old 4-octave range
}
// Close-up rock and pebbles: photo textures (Poly Haven, CC0) projected along x, y and z and
// blended by the normal, so steep faces don't smear. Planes with no weight are skipped; the
// gradients come from outside the branches so mipmapping still works.
uniform sampler2D tRock, tRockN, tPeb, tPebN;
uniform vec3 uRockMean, uPebMean; // each texture's average colour (linear), to scale them alike
uniform float uRockLum, uPebLum; // brightness the shore rock and the pebbles are scaled to
vec3 triW(vec3 n){ vec3 w = max(pow(abs(n), vec3(6.0)) - 0.004, 0.0); return w / (w.x + w.y + w.z); }
// Colour and normal (whiteout blend: Ben Golus, "Normal Mapping for a Triplanar Shader").
void tri(sampler2D tc, sampler2D tn, vec3 p, vec3 dx, vec3 dy, vec3 n, vec3 w, out vec3 col, out vec3 nrm){
  col = vec3(0.0); nrm = vec3(0.0);
  if (w.x > 0.0) {
    vec3 t = textureGrad(tn, p.zy, dx.zy, dy.zy).xyz * 2.0 - 1.0;
    col += textureGrad(tc, p.zy, dx.zy, dy.zy).rgb * w.x; nrm += vec3(t.xy + n.zy, abs(t.z) * n.x).zyx * w.x;
  }
  if (w.y > 0.0) {
    vec3 t = textureGrad(tn, p.xz, dx.xz, dy.xz).xyz * 2.0 - 1.0;
    col += textureGrad(tc, p.xz, dx.xz, dy.xz).rgb * w.y; nrm += vec3(t.xy + n.xz, abs(t.z) * n.y).xzy * w.y;
  }
  if (w.z > 0.0) {
    vec3 t = textureGrad(tn, p.xy, dx.xy, dy.xy).xyz * 2.0 - 1.0;
    col += textureGrad(tc, p.xy, dx.xy, dy.xy).rgb * w.z; nrm += vec3(t.xy + n.xy, abs(t.z) * n.z) * w.z;
  }
}
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  // Ground covered by one pixel (metres, in plan view). Patterns smaller than about twice this
  // can't be drawn and turn into crawling noise, so each one fades out by it.
  vec3 dWx = dFdx(vW), dWy = dFdy(vW);
  float fp = max(length(dWx.xz), length(dWy.xz));
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
  float rug = smoothstep(0.06, 0.40, 1.0 - n0.y) * (0.35 + 0.65 * smoothstep(250.0, 1100.0, h)) * (0.35 + 0.65 * near) * detail * uRelief;
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
  // Rocky shore: bare rock from the water up to a ragged edge 2-11 m up, where the forest starts;
  // beaches only on gentle ground. Near the water a pale band of barnacles and pebbles, and dark
  // wet rock at the waterline.
  float bandTop = 2.5 + 8.0 * n2 + 3.0 * (n3 - 0.5);
  float shore = 1.0 - smoothstep(bandTop - 1.5, bandTop, h);
  float beach = smoothstep(0.55, 0.7, n1) * (1.0 - smoothstep(0.10, 0.25, slope));
  float barn = (1.0 - smoothstep(0.6 + 0.9 * n4, 1.2 + 0.9 * n4, h)) * step(0.0, h);
  float rockW = max(rockAmt, shore * (1.0 - beach)) * (1.0 - snowAmt);
  float pebW = shore * max(beach, barn);
  // The textures, faded into their average colour by 1.8 km (and off in the reflection).
  float texNear = (1.0 - smoothstep(500.0, 1800.0, dist)) * detail;
  vec3 tw = triW(n0);
  // Every texture is scaled to the same brightness (shore rock 0.085, pebbles 0.12 by default) and
  // made greyer: the coast's granite reads mid-grey, and lighter rock turned the reflection white.
  float rockK = uRockLum / lum(uRockMean), pebK = uPebLum / lum(uPebMean);
  vec3 rockTex = uRockMean * rockK, rockTN = n, pebTex = uPebMean * pebK, pebTN = n;
  if (texNear > 0.001 && rockW > 0.001) {
    vec3 c1, m1, c2, m2;
    tri(tRock, tRockN, vW / 4.5, dWx / 4.5, dWy / 4.5, n, tw, c1, m1);
    tri(tRock, tRockN, vW / 17.0 + 0.37, dWx / 17.0, dWy / 17.0, n, tw, c2, m2);
    rockTex = mix(rockTex, (c1 * 0.55 + c2 * 0.45) * rockK, texNear);
    rockTN = normalize(m1 + m2);
  }
  if (texNear > 0.001 && pebW > 0.001) {
    vec3 c1, m1;
    tri(tPeb, tPebN, vW / 2.2, dWx / 2.2, dWy / 2.2, n, tw, c1, m1);
    pebTex = mix(pebTex, c1 * pebK, texNear);
    pebTN = normalize(m1);
  }
  rockTex = mix(vec3(lum(rockTex)), rockTex, 0.3); pebTex = mix(vec3(lum(pebTex)), pebTex, 0.6);
  // Low cliffs are the shore's granite, as dark as the shore band; from 100 to 500 m up they fade
  // back to the mountains' own rock tone (far and near alike, so the texture fade shows no ring).
  rock *= mix(uRockLum / lum(rock), 1.0, smoothstep(100.0, 500.0, h));
  rock = mix(rock, rockTex * (lum(rock) / uRockLum), texNear);
  vec3 shoreRock = rockTex * (0.8 + 0.4 * n3);
  vec3 pebble = mix(pebTex, pebTex * vec3(1.4, 1.38, 1.3), barn); // barnacles: paler
  vec3 c = mix(forest, alpine, alpineAmt);
  c = mix(c, rock, rockAmt);
  c = mix(c, snow, snowAmt);
  c = mix(c, mix(shoreRock, pebble, max(beach, barn)), shore);
  c *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.5, h)); // wet
  if (h < 0.0) c = mix(sand * 0.75, vec3(0.11, 0.10, 0.085), smoothstep(0.0, -25.0, h));
  // Light the canopy with the crown normals, and let the gaps between crowns sit in shade.
  float forestW = (1.0 - alpineAmt) * (1.0 - rockAmt) * (1.0 - snowAmt) * (1.0 - shore) * step(0.0, h);
  vec3 nl = normalize(mix(n, crownN, forestW));
  // Rock and pebbles get their textures' bumps.
  vec3 texN = normalize(mix(rockTN, pebTN, pebW / max(rockW + pebW, 1e-4)));
  nl = normalize(mix(nl, texN, texNear * clamp(rockW + pebW, 0.0, 1.0) * (1.0 - forestW)));
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
