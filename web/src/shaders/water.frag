// Water: waves, planar reflection, depth colour, shore foam and the boat's Kelvin wake.
// Preceded by sky_common.glsl and noise.glsl.
uniform sampler2D tRefl; uniform sampler2D tHeight; uniform vec4 hB; uniform vec2 hN; uniform vec2 uWindDir;
uniform sampler2D tHeightL; uniform vec4 lB; uniform vec2 lN; // the 2 m lidar window, if any (lN = 0)uniform float uWaveAmp; uniform vec4 uBoat; uniform float uBoatScale; uniform float fogDensity; uniform float uTime; uniform vec3 ambGround;
uniform vec4 uTrack[96]; uniform float uTrackS[96]; uniform float uWakeClock; uniform vec4 uWakeBoat; uniform float uWakeV;
uniform vec4 uChunk[12];
// One Kelvin wave system at (x behind, y beside) for direction tan t: slope (d/dx, d/dy) of a
// wave of unit slope amplitude, given K0 = g / v^2. The phase gradient is the wave vector.
vec2 kelvinSlope(float x, float y, float t, float K0, out float k){
  float c = sqrt(1.0 + t * t);
  float phase = K0 * (x + y * t) * c;
  k = K0 * c * c;
  return -sin(phase) * vec2(1.0, t) / c;
}
varying vec3 vW; varying vec4 vM;
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// Each wave fades out as one pixel grows from a tenth to 30% of its wavelength (fp = metres
// of water per pixel); beyond that it can only alias into moire rings. The slope it would have
// added is collected in 'lost' and turned into a broader sun glint instead.
// m scales the wave's amplitude (wind patches); pw is p with the crests bent so they don't run in straight lines.
// A wave that has fully faded is skipped (most of them, far out), costing only the comparison.
#define WAVE(len, amp, ang, m) { float k = 6.2831853 / len; vec2 dd = rot(uWindDir, ang); float ph = dot(dd, pw) * k - uTime * sqrt(9.81 * k); float f = 1.0 - smoothstep(len * 0.1, len * 0.3, fp); g += dd * (amp * m * cos(ph) * f); lost += amp * m * (1.0 - f); }
vec3 waterNormal(vec2 p, float fp, out float rough){
  vec2 g = vec2(0.0); float lost = 0.0;
  vec2 pw = p + (vec2(vnoise(p * 0.011), vnoise(p * 0.011 + 31.7)) - 0.5) * 16.0;
  float m1 = 0.45 + 1.1 * vnoise(p * 0.0045 + uTime * 0.012), m2 = 0.45 + 1.1 * vnoise(p * 0.0045 + 57.3 - uTime * 0.01);
  WAVE(34.0, 0.060, 0.0, m1) WAVE(19.0, 0.070, 0.42, m2) WAVE(11.5, 0.065, -0.55, m1) WAVE(6.7, 0.065, 0.95, m2)
  WAVE(4.1, 0.060, -0.28, m1) WAVE(2.3, 0.055, 1.25, m2) WAVE(1.35, 0.050, -1.05, m1) WAVE(0.8, 0.045, 0.6, m2)
  float fr = 1.0 - smoothstep(0.06, 0.2, fp);
  if (fr > 0.0) {
    vec2 q = p * 1.9 + uTime * vec2(0.35, 0.22);
    float e = 0.12, c0 = vnoise(q);
    g += vec2(vnoise(q + vec2(e, 0.0)) - c0, vnoise(q + vec2(0.0, e)) - c0) / e * 0.035 * fr;
  }
  g *= uWaveAmp;
  #ifdef LAKE
  g *= 0.5; // small sheltered lakes: half the sea's waves
  #endif
  rough = min(lost / 0.47, 1.0) * min(uWaveAmp, 1.0); // 0.47 = sum of the wave amplitudes
  return normalize(vec3(-g.x, 1.0, -g.y));
}
void main(){
  float fp = max(length(dFdx(vW.xz)), length(dFdy(vW.xz)));
  vec3 Vv = cameraPosition - vW; float dist = length(Vv); vec3 V = Vv / dist;
  float rough;
  vec3 n = waterNormal(vW.xz, fp, rough);
  // Boat wake (boat/wake.ts): find this pixel's place relative to the boat's track (x
  // metres back along it, y to the side), then add the two Kelvin wave systems there.
  float wakeFoam = 0.0;
  vec2 fromBoat = vW.xz - uWakeBoat.xy;
  #ifndef LAKE
  if (dot(fromBoat, fromBoat) < 400.0 * 400.0) {
    float best = 1e12, wx = 0.0, wy = 0.0, wAge = 0.0, wStr = 0.0, trail = 0.0;
    vec2 wFwd = vec2(0.0, -1.0);
    // The segments come in 12 chunks of 8, each with a bounding circle. The nearest chunk
    // edge plus its radius bounds the distance to the nearest segment; a chunk further than
    // that (and too far for the foam trail) can't change the result, so it is skipped.
    float ub = 1e6, trailR = 6.0 * uBoatScale;
    for (int c = 0; c < 12; c++) {
      vec4 b = uChunk[c];
      if (b.w > 0.0) ub = min(ub, length(vW.xz - b.xy) + b.z);
    }
    for (int c = 0; c < 12; c++) {
      vec4 b = uChunk[c];
      if (b.w <= 0.0 || length(vW.xz - b.xy) - b.z > max(min(ub, sqrt(best)), trailR)) continue;
      for (int k = 0; k < 8; k++) {
        int j = c * 8 + k, i = j - 1; // ring buffer: segment from point i to point j
        if (i < 0) i = 95;
        vec4 s = uTrack[j]; float sS = uTrackS[j];
        vec4 p0 = uTrack[i]; float p0S = uTrackS[i];
        vec2 seg = s.xy - p0.xy; float sl = dot(seg, seg);
        // Skip empty slots and the buffer's seam (newest -> oldest), which isn't a real segment.
        if (s.w <= 0.0 || p0.w <= 0.0 || sS <= p0S || sl > 4.0 * uWakeBoat.z * uWakeBoat.z + 4.0) continue;
        float t = clamp(dot(vW.xz - p0.xy, seg) / sl, 0.0, 1.0);
        vec2 off = vW.xz - (p0.xy + seg * t);
        float d2 = dot(off, off);
        float age = uWakeClock - mix(p0.z, s.z, t);
        if (d2 < best) {
          best = d2;
          vec2 f = seg / sqrt(sl);
          wFwd = f;
          wx = uWakeBoat.w - mix(p0S, sS, t);
          wy = dot(off, vec2(-f.y, f.x));
          wAge = age; wStr = mix(p0.w, s.w, t);
        }
        // Turbulent water behind the hull: a narrow trail that spreads and fades over ~10 s.
        float w = (1.1 + 0.10 * age) * uBoatScale;
        trail = max(trail, min(s.w, 1.6) * exp(-d2 / (w * w)) * exp(-age / 8.0) * smoothstep(0.0, 0.3, age));
      }
    }
    vec2 grad = vec2(0.0); float steep = 0.0;
    float ratio = abs(wy) / max(wx, 1e-3);
    if (wx > 0.5 && ratio < 0.3535) {
      float K0 = 9.81 / (uWakeV * uWakeV);
      float lam = 6.2831853 / K0;                           // transverse wavelength
      float disc = sqrt(max(wx * wx - 8.0 * wy * wy, 0.0));
      float ay = max(abs(wy), 1e-3) * sign(wy + 1e-6);
      float tT = (-wx + disc) / (4.0 * ay), tD = (-wx - disc) / (4.0 * ay);
      // Envelope: fades with distance and age, swells toward the cusps at the wedge edges and
      // softens right at the edge. Short waves are dropped where a pixel (or the hull) is too big.
      float env = wStr * exp(-wAge / 40.0) * smoothstep(0.0, 1.5 * lam, wx) / sqrt(1.0 + wx / (3.0 * lam));
      float cusp = 1.0 + 1.2 * smoothstep(0.24, 0.35, ratio);
      float edge = 1.0 - smoothstep(0.335, 0.3535, ratio);
      float kT, kD;
      vec2 sT = kelvinSlope(wx, wy, tT, K0, kT);
      vec2 sD = kelvinSlope(wx, wy, tD, K0, kD);
      float hull = 6.0 * uBoatScale;
      float fT = 1.0 - smoothstep(0.3, 0.7, kT * fp);
      float fD = (1.0 - smoothstep(0.3, 0.7, kD * fp)) * exp(-kD * kD * hull * hull * 0.02);
      vec2 local = (0.08 * sT * fT + 0.11 * sD * fD) * env * cusp * edge;
      // local.x is along "behind", local.y to the side: back to world.
      grad = local.x * (-wFwd) + local.y * vec2(-wFwd.y, wFwd.x);
      steep = length(grad);
      n = normalize(n + vec3(-grad.x, 0.0, -grad.y));
    }
    float streak = vnoise(vW.xz * 0.9 + uTime * 0.2) * 0.55 + vnoise(vW.xz * 2.7 - uTime * 0.3) * 0.45;
    // A broken white trail behind the stern, plus a few whitecaps on the steepest wake crests
    // near the boat. Noise decides where the foam breaks through.
    float trailFoam = smoothstep(0.25, 0.65, trail * 1.2 * smoothstep(0.2, 0.75, streak));
    float crestFoam = smoothstep(0.07, 0.12, steep) * smoothstep(0.6, 0.85, streak) * exp(-length(fromBoat) / 50.0);
    wakeFoam = min(trailFoam * 0.75 + crestFoam * 0.5, 0.8);
  }
  #endif
  #ifdef LAKE
  float depth = 6.0; // no lake bathymetry: a uniform dark body, no shore foam
  #else
  vec2 tuv = ((vW.xz - hB.xy) / hB.z + 0.5) / hN;
  float bed = -300.0;
  if (tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) bed = texture2D(tHeight, tuv).r;
  vec2 luv = ((vW.xz - lB.xy) / lB.z + 0.5) / max(lN, vec2(1.0));
  if (lN.x > 0.0 && luv.x > 0.0 && luv.y > 0.0 && luv.x < 1.0 && luv.y < 1.0) bed = texture2D(tHeightL, luv).r;
  float depth = max(-bed, 0.0);
  #endif
  // Reflection: the planar pass, or (Low preset, and lakes, which sit above the mirror plane) the
  // sky's colour in the reflected direction, which costs no extra pass.
  #if defined(LAKE) || defined(SKY_REFL)
  vec3 Rs = reflect(-V, n);
  vec3 refl = skyColor(normalize(vec3(Rs.x, max(Rs.y, 0.02), Rs.z)));
  #else
  vec2 ruv = vM.xy / vM.w + n.xz * (0.05 / (1.0 + dist * 0.0035));
  vec3 refl = texture2D(tRefl, ruv).rgb;
  #endif
  #ifdef TONE_MAPPING
  // three.js r150, which the look was tuned on, tone-mapped every pass, so the reflection came
  // out of its pass already tone-mapped. Newer three only tone-maps on screen; this keeps the look.
  refl = toneMapping(refl);
  #endif
  float ndv = max(dot(n, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 light = sunCol * max(sunDir.y, 0.0) * 0.55 + ambSky;
  // Howe Sound is milky blue-green with glacial silt: little light reaches the bottom, so the
  // seabed shows only in the first metre or two, and the water itself carries colour.
  vec3 body = mix(vec3(0.010, 0.040, 0.064), vec3(0.020, 0.072, 0.084), exp(-depth * 0.02));
  float see = exp(-depth * 0.65) * (0.25 + 0.5 * ndv);
  body = mix(body, vec3(0.30, 0.28, 0.20) * 0.45, see);
  body *= light * 1.45;
  vec3 col = mix(body, refl * vec3(0.86, 0.94, 1.0), F * 0.88);
  vec3 R = reflect(-V, n);
  float sp = max(dot(R, sunDir), 0.0);
  // Where the small waves have faded, the glint widens (same total energy) instead of
  // collapsing to a sharp mirror image of the sun.
  float s1 = mix(900.0, 60.0, rough), s2 = mix(110.0, 20.0, rough);
  col += sunCol * (pow(sp, s1) * 16.0 * (s1 + 2.0) / 902.0 + pow(sp, s2) * 0.45 * (s2 + 2.0) / 112.0)
       * (1.0 - uOvercast) * smoothstep(-0.02, 0.05, sunDir.y);
  float fn = mix(vnoise(vW.xz * 0.45 + vec2(uTime * 0.25, -uTime * 0.18)), 0.5, smoothstep(0.5, 1.4, fp)) * 0.6
           + mix(vnoise(vW.xz * 1.7 - uTime * 0.4), 0.5, smoothstep(0.15, 0.4, fp)) * 0.4;
  float surf = 0.5 + 0.5 * sin(depth * 3.5 - uTime * 1.6 + fn * 3.0);
  // Shore foam: a thin broken line, not a band (calm sound, rocky shore).
  float foam = (1.0 - smoothstep(0.05, 0.3, depth)) * smoothstep(0.55, 0.85, fn * 0.7 + surf * 0.5) * 0.6;
  foam += (1.0 - smoothstep(0.0, 0.1, depth)) * 0.3;
  foam += wakeFoam;
  foam = clamp(foam, 0.0, 1.0) * (1.0 - smoothstep(700.0, 1600.0, dist));
  vec3 foamCol = (sunCol * max(sunDir.y, 0.0) + ambSky * 1.6) * 0.62;
  col = mix(col, foamCol, foam);
  float fogAmt = 1.0 - exp(-dist * fogDensity);
  col = mix(col, hazeColor(normalize(vec3(-V.x, max(-V.y, -0.05), -V.z))), fogAmt);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
