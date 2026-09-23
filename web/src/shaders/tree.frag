// Tree impostor: baked colour and normals, lit by the sun and faded into haze. Preceded by sky_common.glsl.
uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform vec2 uAtlas;
uniform vec3 ambGround; uniform float fogDensity;
varying vec2 vUv0; varying vec2 vUv1; varying float vMix; varying float vY; varying vec3 vW; varying vec3 vRight; varying vec3 vToCam; varying float vShade;
void main(){
  vec4 a = mix(texture2D(tAlbedo, vUv0), texture2D(tAlbedo, vUv1), vMix);
  vec3 alb = a.rgb / max(a.a, 0.05) * (0.8 + 0.4 * vShade);
  // Bark is the only part redder than it is green (the foliage is the other way round).
  float bark = smoothstep(0.85, 1.05, alb.r / max(alb.g, 1e-3));
  // Boost coverage in the smaller mip levels so distant trees don't thin out, but not the
  // bare trunk: thickened, it turns into a warm speck under each far tree along the shore.
  vec2 tx = vUv0 * uAtlas;
  float lod = 0.5 * log2(max(max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx))), 1e-8));
  if (a.a * (1.0 + max(lod, 0.0) * 0.35 * (1.0 - bark)) < 0.5) discard;
  // Coastal conifers read as dark blue-green, not bright green: desaturate, cool and darken.
  float lum = dot(alb, vec3(0.3, 0.59, 0.11));
  alb = mix(vec3(lum), alb, 0.62) * vec3(0.80, 0.90, 1.0);
  // Weathered trunks in a stand read as dark grey-brown, not red-brown.
  alb = mix(alb, vec3(lum) * vec3(0.78, 0.76, 0.74), bark * 0.75);
  vec3 nb = mix(texture2D(tNormal, vUv0).xyz, texture2D(tNormal, vUv1).xyz, vMix) * 2.0 - 1.0;
  vec3 N = normalize(nb.x * vRight + vec3(0.0, nb.y, 0.0) + nb.z * vToCam);
  // The trunk stands in the shade of its own crown and its neighbours: little direct sun.
  float diff = max(dot(N, sunDir), 0.0) * (1.0 - 0.6 * bark);
  // Darker low in the crown, and the bare lower trunk sits in the forest floor's shade.
  float ao = mix(0.28, 1.0, smoothstep(0.03, 0.6, vY));
  vec3 amb = mix(ambGround, ambSky, N.y * 0.5 + 0.5) * ao;
  vec3 col = alb * (sunCol * diff * (0.55 + 0.45 * ao) + amb);
  vec3 V = vW - cameraPosition; float dist = length(V); vec3 vd = V / dist;
  float fogAmt = 1.0 - exp(-dist * fogDensity * 1.35 * (exp(-max(vW.y, 0.0) * 0.0005) * 0.8 + 0.2));
  col = mix(col, hazeColor(normalize(vec3(vd.x, max(vd.y, -0.05), vd.z))), fogAmt);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
