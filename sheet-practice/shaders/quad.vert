#version 300 es
// Instanced rectangles in pixel space with an optional sloped left edge.
// corner = unit quad [0,1]^2; rect = (x,y,w,h) px; color = rgba;
// slope = (top-left pull, bottom-left pull) in px — pulls that left corner
// right so the left edge becomes a diagonal. slope=0 leaves a plain rectangle.
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 rect;
layout(location = 2) in vec4 color;
layout(location = 3) in vec2 slope;  // x = top-left pull, y = bottom-left pull

uniform vec2 resolution;  // CSS pixels (top-left origin)
out vec4 vColor;

void main() {
  vec2 px = rect.xy + corner * rect.zw;
  // only the left edge (corner.x == 0) moves; top row uses slope.x, bottom slope.y
  px.x += (1.0 - corner.x) * mix(slope.x, slope.y, corner.y);
  vec2 clip = vec2(px.x / resolution.x * 2.0 - 1.0,
                   1.0 - px.y / resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = color;
}
