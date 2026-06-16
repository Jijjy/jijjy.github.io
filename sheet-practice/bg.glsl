#version 300 es
uniform float time;
uniform float rpm;
uniform vec2 resolution;

out vec4 color;

void main()
{
  vec2 p = gl_FragCoord.xy;
  float spacing = resolution.y / 30.0;
  float n = floor(0.5 + p.y * 52.0 / resolution.y);
  float t = 1.0 - step(1.99, mod(p.y, spacing));
  float m = 24.0;
  bool solid = (abs(n - m) <= 9.0) && (abs(n - m) > 0.1);
  if (!solid)
    t *= smoothstep(0.0, 1.0, sin(0.25 * p.x));
  vec3 fg = solid ? vec3(0.2) : vec3(0.1);
  vec3 bg = vec3(0);
  color = vec4(mix(bg, fg, t), 1);
}
