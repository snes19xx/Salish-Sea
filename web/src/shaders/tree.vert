// Tree impostor: one camera-facing quad per tree (an instance), showing the two baked views either
// side of the camera's angle around it.
attribute vec3 iPos; attribute vec3 iSize; attribute vec3 iMisc; // position; height, width factor, species; yaw, shade, threshold
uniform float uViews; uniform float uRows; uniform float uAspect; uniform vec4 uBand; uniform float uSpecies;
varying vec2 vUv0; varying vec2 vUv1; varying float vMix; varying float vY; varying vec3 vW; varying vec3 vRight; varying vec3 vToCam; varying float vShade;
void main(){
  vec2 tc = normalize(cameraPosition.xz - iPos.xz + vec2(1e-4, 0.0));
  vec3 right = vec3(tc.y, 0.0, -tc.x);
  // The two baked views either side of the camera's angle around this tree (offset by the tree's
  // own yaw), blended so the tree turns smoothly instead of flipping between views.
  float fv = (atan(tc.x, tc.y) - iMisc.x) / 6.2831853 * uViews;
  float f0 = mod(floor(fv), uViews);
  vMix = fract(fv);
  // Fade with the ring: the tree shrinks away as the ring's weight drops below its threshold.
  float d = length(cameraPosition.xz - iPos.xz);
  float weight = smoothstep(uBand.x, uBand.y, d) * (1.0 - smoothstep(uBand.z, uBand.w, d));
  float grow = clamp((weight * 1.08 - iMisc.z) / 0.08, 0.0, 1.0);
  vec3 w = iPos + (right * (position.x * iSize.x * uAspect * iSize.y) + vec3(0.0, position.y * iSize.x, 0.0)) * grow;
  float row = uSpecies >= 0.0 ? uSpecies : iSize.z; // the species' row in the atlas
  vUv0 = vec2((f0 + uv.x) / uViews, (row + uv.y) / uRows);
  vUv1 = vec2((mod(f0 + 1.0, uViews) + uv.x) / uViews, (row + uv.y) / uRows);
  vY = uv.y;
  vW = w; vRight = right; vToCam = vec3(tc.x, 0.0, tc.y); vShade = iMisc.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
