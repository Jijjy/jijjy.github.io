#version 300 es
// Attribute-less fullscreen triangle for the background pass (bg.glsl).
void main() {
  vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(p[gl_VertexID], 0.0, 1.0);
}
