// Sky colour in a direction, and the haze colour distant land and water fade into. Shared by
// every shader that draws something under the sky.
uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 ambSky; uniform float uOvercast;
vec3 skyColor(vec3 d){
  float sy = sunDir.y;
  float day = smoothstep(-0.14, 0.22, sy);
  float gold = (1.0 - smoothstep(0.02, 0.38, sy)) * smoothstep(-0.16, 0.0, sy);
  vec3 zen = mix(vec3(0.004, 0.007, 0.02), vec3(0.085, 0.21, 0.50), day);
  vec3 hor = mix(vec3(0.015, 0.02, 0.04), vec3(0.50, 0.63, 0.78), day);
  float mu = max(dot(d, sunDir), 0.0);
  vec3 gc = vec3(1.0, 0.45, 0.18);
  hor = mix(hor, gc * (0.55 + 0.9 * pow(mu, 4.0)), gold * (0.3 + 0.6 * pow(mu, 2.0)));
  zen = mix(zen, vec3(0.15, 0.16, 0.30), gold * 0.5);
  float h = max(d.y, 0.0);
  vec3 col = mix(hor, zen, pow(h, 0.45));
  col += vec3(1.0, 0.85, 0.65) * pow(mu, 24.0) * 0.5 * day;
  col += gc * pow(mu, 6.0) * gold * 0.5;
  if (d.y < 0.0) col = mix(hor, hor * 0.55, clamp(-d.y * 3.0, 0.0, 1.0));
  float grey = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, vec3(grey) * vec3(0.95, 0.98, 1.03) * (0.6 + 0.4 * day), uOvercast * 0.85);
  return col;
}
// Haze over distant land and water: the sky colour pushed toward blue, as far ridges on this coast
// go blue with distance. Toward the sun it stays warm; under overcast it greys out.
vec3 hazeColor(vec3 d){
  vec3 c = skyColor(d);
  float mu = max(dot(d, sunDir), 0.0);
  return mix(c * vec3(0.68, 0.84, 1.12), c, clamp(pow(mu, 4.0) * (1.0 - uOvercast) + uOvercast * 0.7, 0.0, 1.0));
}
