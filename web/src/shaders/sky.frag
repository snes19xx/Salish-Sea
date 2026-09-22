// Sky dome: sky colour, sun disc, night sky and clouds. Preceded by sky_common.glsl and noise.glsl.
uniform float uTime; uniform float uStars; uniform mat3 uEq; varying vec3 vW;
float hash31(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
// One layer of stars: a jittered 3D grid of cells around the celestial sphere, one star per kept cell.
vec3 starLayer(vec3 e, float scale, float keep, float size, float boost){
  vec3 c = floor(e * scale);
  float h = hash31(c);
  if (h > keep) return vec3(0.0);
  vec3 j = vec3(hash31(c + 17.17), hash31(c + 31.31), hash31(c + 47.47));
  vec3 s = normalize(c + 0.2 + 0.6 * j) ;
  float r = length(e - s);
  float mag = pow(1.0 - h / keep, 5.0) * boost; // a few bright stars, many faint ones
  vec3 tint = mix(vec3(1.0, 0.80, 0.60), vec3(0.75, 0.85, 1.0), hash31(c + 5.5));
  return mix(vec3(1.0), tint, 0.55) * mag * exp(-r * r / (size * size));
}
// Milky Way from galactic coordinates: a band that widens into the bulge at the centre (in Sagittarius),
// mottled star clouds, and the dark dust rift along the plane.
vec3 milkyWay(vec3 g, out float band){
  float b = asin(clamp(g.z, -1.0, 1.0));
  float l = atan(g.y, g.x);
  float al = abs(l);
  float w = mix(0.08, 0.17, exp(-al * al * 1.5));
  band = exp(-b * b / (w * w));
  float bulge = exp(-l * l / 0.09 - b * b / 0.025);
  vec2 q = vec2(l * 5.0, b * 9.0);
  float cl = fbm2(q + 3.1) * 0.65 + fbm2(q * 3.3 + 7.7) * 0.35;
  float lane = exp(-pow((b - 0.025 - 0.03 * sin(l * 2.3)) / 0.035, 2.0)) * smoothstep(1.9, 0.3, al);
  float dust = lane * smoothstep(0.35, 0.65, fbm2(vec2(l * 7.0, b * 22.0) + 11.0) * 0.6 + 0.4 * fbm2(q * 2.0));
  float lum = (band * (0.25 + 1.1 * cl * cl) + bulge * (1.2 + 1.5 * cl)) * (1.0 - 0.8 * dust);
  vec3 tint = mix(vec3(0.70, 0.78, 1.0), vec3(1.0, 0.82, 0.62), clamp(bulge * 1.8 + 0.15, 0.0, 1.0));
  return tint * lum;
}
void main(){
  vec3 d = normalize(vW - cameraPosition);
  vec3 col = skyColor(d);
  float mu = dot(d, sunDir);
  col += sunCol * smoothstep(0.99955, 0.99975, mu) * 18.0 * (1.0 - uOvercast);
  if (uStars > 0.001 && d.y > -0.03) {
    vec3 e = uEq * vec3(d.x, -d.z, d.y); // world -> east, north, up -> equatorial
    vec3 g = vec3(dot(vec3(-0.0548756, -0.8734371, -0.4838350), e),
                  dot(vec3( 0.4941094, -0.4448296,  0.7469822), e),
                  dot(vec3(-0.8676661, -0.1980764,  0.4559838), e)); // equatorial -> galactic (J2000)
    float band;
    vec3 mw = milkyWay(g, band);
    vec3 stars = starLayer(e, 160.0, 0.012 * (1.0 + 1.5 * band), 0.0014, 2.6)
               + starLayer(e, 420.0, 0.020 * (1.0 + 2.0 * band), 0.0008, 0.9);
    float ext = smoothstep(-0.02, 0.25, d.y); // extinction and haze near the horizon
    col += (mw * 0.05 * uStars + stars) * uStars * ext;
  }
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.07) * 1.1 + uTime * vec2(0.0035, 0.0012);
    float c = fbm2(cp * 1.3) * 0.75 + fbm2(cp * 4.1 + 3.0) * 0.25;
    float cover = mix(0.6, 0.3, uOvercast);
    float cl = smoothstep(cover, cover + 0.22, c) * smoothstep(0.0, 0.14, d.y);
    float lit = pow(max(mu, 0.0), 3.0);
    vec3 cc = ambSky * 1.5 + sunCol * (0.25 + 0.5 * lit) * (1.0 - uOvercast * 0.8);
    cc = mix(cc, cc * 0.6, smoothstep(cover + 0.1, cover + 0.45, c));
    col = mix(col, cc, cl * mix(0.85, 0.95, uOvercast));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
