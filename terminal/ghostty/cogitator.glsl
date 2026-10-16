// Cogitator: the terminal as an amber phosphor display of the Imperium, set in a brass
// housing. On the glass: scanlines, a soft phosphor glow around bright text, the dark
// corners of a curved screen and the housing's shadow. Around it, in the window's
// padding: a bevelled brass bezel with a dark groove, a gilt inner trim, rivets, a
// medallion with a cross in each corner and a Mechanicus hazard band on one edge.
// No distortion and no time term: text stays where it is drawn, and the shader runs
// only when the screen changes (custom-shader-animation = false).
//
// BEZEL must stay below the window padding in pixels (cogitator.conf sets 34 x 30
// points: 68 x 60 px on a Retina screen). On a screen at 1x, lower BEZEL to ~26.

const float BEZEL = 44.0;          // housing width, physical pixels
const float RIVET_EVERY = 150.0;   // pixels between rivets along an edge
const float RIVET_R = 5.0;
const float SCAN_PERIOD = 3.0;     // physical pixels per scanline
const float SCAN_DEPTH = 0.14;
const float GLOW_RADIUS = 2.0;
const float GLOW_GAIN = 0.32;
const vec3 GLOW_TINT = vec3(1.0, 0.72, 0.30);
const float VIGNETTE = 0.30;

const vec3 BRASS_DARK = vec3(0.13, 0.09, 0.035);
const vec3 BRASS = vec3(0.56, 0.42, 0.19);
const vec3 BRASS_LIGHT = vec3(0.98, 0.82, 0.48);
const vec3 HAZARD = vec3(0.90, 0.66, 0.10);
const vec2 LIGHT = vec2(-0.6, 0.8);  // from the upper left

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 glass(vec2 uv, vec2 fragCoord) {
    vec2 px = 1.0 / iResolution.xy;
    vec3 base = texture(iChannel0, uv).rgb;
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.78539816;
        vec2 dir = vec2(cos(a), sin(a)) * px * GLOW_RADIUS;
        glow += texture(iChannel0, uv + dir).rgb;
        glow += texture(iChannel0, uv + dir * 2.0).rgb * 0.5;
    }
    glow /= 12.0;
    vec3 col = base + glow * GLOW_TINT * GLOW_GAIN;
    col *= 1.0 - SCAN_DEPTH * (0.5 + 0.5 * cos(fragCoord.y * 6.2831853 / SCAN_PERIOD));
    vec2 d = (uv - 0.5) * vec2(1.0, 1.2);
    col *= mix(1.0 - VIGNETTE, 1.0, smoothstep(0.80, 0.30, length(d)));
    return col;
}

// A domed rivet or boss at `p` (pixels from its centre), radius `r`; `under` shows around it.
vec3 dome(vec2 p, float r, vec3 under) {
    float d = length(p);
    if (d > r + 1.0) return under;
    vec2 g = p / r;
    vec3 n = normalize(vec3(g, sqrt(max(0.0, 1.0 - dot(g, g)))));
    float shade = clamp(dot(n, normalize(vec3(LIGHT, 0.9))), 0.0, 1.0);
    vec3 c = mix(BRASS_DARK, BRASS_LIGHT, shade);
    float rim = smoothstep(r - 1.2, r, d);
    c = mix(c, BRASS_DARK * 0.5, rim);
    return mix(c, under, smoothstep(r, r + 1.0, d));
}

vec3 bezel(vec2 fragCoord, vec2 res) {
    float dl = fragCoord.x;
    float dr = res.x - fragCoord.x;
    float db = fragCoord.y;
    float dt = res.y - fragCoord.y;
    float edge = min(min(dl, dr), min(db, dt));
    // Which side this pixel belongs to; corners split on the diagonal (a mitre).
    vec2 n = edge == dl ? vec2(-1.0, 0.0) : edge == dr ? vec2(1.0, 0.0) : edge == db ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
    float t = clamp(edge / BEZEL, 0.0, 1.0);

    // A raised bevel: the outer half faces out, the inner half faces in.
    float lit = dot(n * cos(t * 3.14159), normalize(LIGHT));
    vec3 c = mix(BRASS_DARK, BRASS, 0.35 + 0.55 * sin(t * 3.14159));
    c += BRASS_LIGHT * 0.30 * max(lit, 0.0) - vec3(0.10) * max(-lit, 0.0);
    c *= 0.90 + 0.10 * hash(floor(fragCoord / 1.5));

    // A Mechanicus hazard band in the middle third of the lower edge.
    bool lower = edge == db;
    if (lower && t > 0.36 && t < 0.86 && abs(fragCoord.x - res.x * 0.5) < res.x / 6.0) {
        float stripe = step(0.5, fract((fragCoord.x + fragCoord.y) / 18.0));
        c = mix(vec3(0.05, 0.035, 0.02), HAZARD, stripe) * (0.85 + 0.15 * sin(t * 3.14159));
    }

    // A dark groove, a gilt inner trim and a black outer lip.
    c = mix(c, BRASS_DARK * 0.55, 1.0 - smoothstep(0.0, 1.4, abs(edge - BEZEL * 0.30)));
    c = mix(c, BRASS_LIGHT, 1.0 - smoothstep(0.0, 1.0, abs(edge - (BEZEL - 1.5))));
    c = mix(c, vec3(0.02, 0.015, 0.01), 1.0 - smoothstep(0.0, 1.5, edge));

    // Rivets along the bezel's crest, clear of the corners and the hazard band.
    float crest = BEZEL * 0.64;
    float along = n.x != 0.0 ? fragCoord.y : fragCoord.x;
    float span = n.x != 0.0 ? res.y : res.x;
    float k = mod(along - span * 0.5, RIVET_EVERY) - RIVET_EVERY * 0.5;
    bool nearCorner = along < BEZEL * 2.2 || along > span - BEZEL * 2.2;
    bool inHazard = lower && abs(fragCoord.x - res.x * 0.5) < res.x / 6.0 + RIVET_R * 2.0;
    if (!nearCorner && !inHazard) c = dome(vec2(k, edge - crest), RIVET_R, c);

    // A medallion in each corner: a brass boss with a gilt ring and a cross pattée.
    vec2 corner = vec2(fragCoord.x < res.x * 0.5 ? BEZEL * 0.5 : res.x - BEZEL * 0.5,
                       fragCoord.y < res.y * 0.5 ? BEZEL * 0.5 : res.y - BEZEL * 0.5);
    vec2 q = fragCoord - corner;
    float R = BEZEL * 0.46;
    if (length(q) < R + 1.0) {
        c = dome(q, R, c);
        float ring = abs(length(q) - R * 0.80);
        c = mix(c, BRASS_LIGHT, 1.0 - smoothstep(0.6, 1.6, ring));
        vec2 a = abs(q);
        float w = R * 0.16 + a.y * 0.35;   // arms flare toward their ends
        float w2 = R * 0.16 + a.x * 0.35;
        bool isCross = (a.x < w && a.y < R * 0.62) || (a.y < w2 && a.x < R * 0.62);
        if (isCross) c = mix(BRASS_DARK * 0.6, vec3(0.25, 0.04, 0.03), 0.5);
    }
    return c;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 res = iResolution.xy;
    vec2 uv = fragCoord / res;
    float edge = min(min(fragCoord.x, res.x - fragCoord.x), min(fragCoord.y, res.y - fragCoord.y));
    vec3 col;
    if (edge < BEZEL) {
        col = bezel(fragCoord, res);
    } else {
        col = glass(uv, fragCoord);
        // The housing's shadow falls on the glass.
        col *= mix(0.45, 1.0, smoothstep(BEZEL, BEZEL + 18.0, edge));
    }
    fragColor = vec4(col, 1.0);
}
