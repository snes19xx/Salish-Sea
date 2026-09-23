uniform mat4 uTexMat; varying vec3 vW; varying vec4 vM;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vM = uTexMat * w;
  gl_Position = projectionMatrix * viewMatrix * w;
}
