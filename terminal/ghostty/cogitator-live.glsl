// Cogitator, alive: a second pass after cogitator.glsl. A soft refresh band rolls down
// the glass every few seconds and the phosphor breathes, as an old cogitator screen
// does; the brass housing stays still. It needs custom-shader-animation = true, so
// Ghostty redraws the window all the time: opt in with `node tools/install.mjs --animated`.

const float BEZEL = 44.0;         // keep equal to cogitator.glsl
const float BAND_PERIOD = 9.0;    // seconds for the band to cross the glass
const float BAND_HEIGHT = 0.10;   // of the window's height
const float BAND_GAIN = 0.07;
const float FLICKER = 0.010;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 res = iResolution.xy;
    vec2 uv = fragCoord / res;
    vec3 col = texture(iChannel0, uv).rgb;
    float edge = min(min(fragCoord.x, res.x - fragCoord.x), min(fragCoord.y, res.y - fragCoord.y));
    if (edge >= BEZEL) {
        // Ghostty's fragCoord grows downward: the band starts at the top and rolls down.
        float pos = fract(iTime / BAND_PERIOD);
        float d = uv.y - pos;
        float band = exp(-(d * d) / (BAND_HEIGHT * BAND_HEIGHT * 0.25));
        col += band * BAND_GAIN * vec3(1.0, 0.74, 0.34);
        col *= 1.0 + FLICKER * sin(iTime * 47.0) * sin(iTime * 3.1);
    }
    fragColor = vec4(col, 1.0);
}
