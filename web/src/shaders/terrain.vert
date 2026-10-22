// One terrain patch: an instance of the shared grid of PATCH x PATCH cells, placed by aPatch (the
// first column and row in the terrain texture, and the step between the samples it uses).
// Height, normal and cavity come from tTerrain. Skirt vertices (position.z = 1) hang below the
// patch edge to hide cracks against a neighbour drawn at another level of detail.
uniform highp sampler2D tTerrain; // r = height, g = normal x, b = normal z, a = cavity
uniform vec3 uGrid; // x, z of the first sample, metres between samples
uniform ivec2 uLast; // last column and row
attribute vec3 aPatch;
varying vec3 vW; varying vec3 vN; varying float vCav;
void main(){
  ivec2 cr = min(ivec2(aPatch.xy + position.xy * aPatch.z), uLast);
  vec4 t = texelFetch(tTerrain, cr, 0);
  vW = vec3(uGrid.x + float(cr.x) * uGrid.z, t.r - position.z * aPatch.z * uGrid.z * 2.0, uGrid.y + float(cr.y) * uGrid.z);
  vN = vec3(t.g, sqrt(max(1.0 - t.g * t.g - t.b * t.b, 0.0)), t.b); vCav = t.a;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}
