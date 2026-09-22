attribute float cavity; varying vec3 vW; varying vec3 vN; varying float vCav;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vCav = cavity;
  gl_Position = projectionMatrix * viewMatrix * w;
}
