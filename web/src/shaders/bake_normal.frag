// Normals in the bake camera's space (x right, y up, z toward camera), alpha-tested like the colour pass.
uniform sampler2D map; varying vec3 vN; varying vec2 vUv;
void main(){
  #ifdef HAS_MAP
  if (texture2D(map, vUv).a < 0.5) discard;
  #endif
  gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0);
}
