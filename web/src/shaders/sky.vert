// Pinned to the far plane and drawn last, so the sky is only shaded where nothing else is.
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w; }
