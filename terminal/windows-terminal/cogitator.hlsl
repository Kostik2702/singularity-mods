// Cogitator for Windows Terminal: the HLSL twin of terminal/ghostty/cogitator.glsl.
// An amber phosphor display set in a brass housing: on the glass, scanlines, a soft
// phosphor glow and the corners of a curved screen, the housing's shadow; around it, in
// the window's padding, a bevelled brass bezel with a groove, a gilt trim, rivets, a
// cross medallion in each corner and a Mechanicus hazard band on the lower edge.
// Windows Terminal hands `pos` in pixels from the top left and `tex` in 0..1.
// BEZEL must stay below the profile's padding in pixels (the fragment sets 44 x 40 DIPs).

Texture2D shaderTexture;
SamplerState samplerState;

cbuffer PixelShaderSettings {
    float  Time;
    float  Scale;
    float2 Resolution;
    float4 Background;
};

static const float BEZEL = 40.0;
static const float RIVET_EVERY = 150.0;
static const float RIVET_R = 5.0;
static const float SCAN_PERIOD = 3.0;
static const float SCAN_DEPTH = 0.14;
static const float GLOW_RADIUS = 2.0;
static const float GLOW_GAIN = 0.32;
static const float3 GLOW_TINT = float3(1.0, 0.72, 0.30);
static const float VIGNETTE = 0.30;

static const float3 BRASS_DARK = float3(0.13, 0.09, 0.035);
static const float3 BRASS = float3(0.56, 0.42, 0.19);
static const float3 BRASS_LIGHT = float3(0.98, 0.82, 0.48);
static const float3 HAZARD = float3(0.90, 0.66, 0.10);
static const float2 LIGHT = float2(-0.6, 0.8);

// GLSL's mod: never negative, unlike fmod.
float wrap(float x, float y) {
    return x - y * floor(x / y);
}

float hash(float2 p) {
    return frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

float3 glass(float2 uv, float2 fragCoord) {
    float2 px = 1.0 / Resolution;
    float3 base = shaderTexture.Sample(samplerState, uv).rgb;
    float3 glow = float3(0.0, 0.0, 0.0);
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.78539816;
        float2 dir = float2(cos(a), sin(a)) * px * GLOW_RADIUS;
        glow += shaderTexture.Sample(samplerState, uv + dir).rgb;
        glow += shaderTexture.Sample(samplerState, uv + dir * 2.0).rgb * 0.5;
    }
    glow /= 12.0;
    float3 col = base + glow * GLOW_TINT * GLOW_GAIN;
    col *= 1.0 - SCAN_DEPTH * (0.5 + 0.5 * cos(fragCoord.y * 6.2831853 / SCAN_PERIOD));
    float2 d = (uv - 0.5) * float2(1.0, 1.2);
    col *= lerp(1.0 - VIGNETTE, 1.0, smoothstep(0.80, 0.30, length(d)));
    return col;
}

// A domed rivet or boss at `p` (pixels from its centre), radius `r`; `under` shows around it.
float3 dome(float2 p, float r, float3 under) {
    float d = length(p);
    if (d > r + 1.0) return under;
    float2 g = p / r;
    float3 n = normalize(float3(g, sqrt(max(0.0, 1.0 - dot(g, g)))));
    float shade = saturate(dot(n, normalize(float3(LIGHT, 0.9))));
    float3 c = lerp(BRASS_DARK, BRASS_LIGHT, shade);
    c = lerp(c, BRASS_DARK * 0.5, smoothstep(r - 1.2, r, d));
    return lerp(c, under, smoothstep(r, r + 1.0, d));
}

// The housing, drawn with y up (fragCoord here grows upward: flipped by the caller).
float3 bezel(float2 fragCoord, float2 res) {
    float dl = fragCoord.x;
    float dr = res.x - fragCoord.x;
    float db = fragCoord.y;
    float dt = res.y - fragCoord.y;
    float edge = min(min(dl, dr), min(db, dt));
    float2 n = edge == dl ? float2(-1.0, 0.0) : (edge == dr ? float2(1.0, 0.0) : (edge == db ? float2(0.0, -1.0) : float2(0.0, 1.0)));
    float t = saturate(edge / BEZEL);

    float lit = dot(n * cos(t * 3.14159), normalize(LIGHT));
    float3 c = lerp(BRASS_DARK, BRASS, 0.35 + 0.55 * sin(t * 3.14159));
    c += BRASS_LIGHT * 0.30 * max(lit, 0.0) - float3(0.10, 0.10, 0.10) * max(-lit, 0.0);
    c *= 0.90 + 0.10 * hash(floor(fragCoord / 1.5));

    bool lower = edge == db;
    if (lower && t > 0.36 && t < 0.86 && abs(fragCoord.x - res.x * 0.5) < res.x / 6.0) {
        float stripe = step(0.5, frac((fragCoord.x + fragCoord.y) / 18.0));
        c = lerp(float3(0.05, 0.035, 0.02), HAZARD, stripe) * (0.85 + 0.15 * sin(t * 3.14159));
    }

    c = lerp(c, BRASS_DARK * 0.55, 1.0 - smoothstep(0.0, 1.4, abs(edge - BEZEL * 0.30)));
    c = lerp(c, BRASS_LIGHT, 1.0 - smoothstep(0.0, 1.0, abs(edge - (BEZEL - 1.5))));
    c = lerp(c, float3(0.02, 0.015, 0.01), 1.0 - smoothstep(0.0, 1.5, edge));

    float crest = BEZEL * 0.64;
    float along = n.x != 0.0 ? fragCoord.y : fragCoord.x;
    float span = n.x != 0.0 ? res.y : res.x;
    float k = wrap(along - span * 0.5, RIVET_EVERY) - RIVET_EVERY * 0.5;
    bool nearCorner = along < BEZEL * 2.2 || along > span - BEZEL * 2.2;
    bool inHazard = lower && abs(fragCoord.x - res.x * 0.5) < res.x / 6.0 + RIVET_R * 2.0;
    if (!nearCorner && !inHazard) c = dome(float2(k, edge - crest), RIVET_R, c);

    float2 corner = float2(fragCoord.x < res.x * 0.5 ? BEZEL * 0.5 : res.x - BEZEL * 0.5,
                           fragCoord.y < res.y * 0.5 ? BEZEL * 0.5 : res.y - BEZEL * 0.5);
    float2 q = fragCoord - corner;
    float R = BEZEL * 0.46;
    if (length(q) < R + 1.0) {
        c = dome(q, R, c);
        float ring = abs(length(q) - R * 0.80);
        c = lerp(c, BRASS_LIGHT, 1.0 - smoothstep(0.6, 1.6, ring));
        float2 a = abs(q);
        float w = R * 0.16 + a.y * 0.35;
        float w2 = R * 0.16 + a.x * 0.35;
        bool isCross = (a.x < w && a.y < R * 0.62) || (a.y < w2 && a.x < R * 0.62);
        if (isCross) c = lerp(BRASS_DARK * 0.6, float3(0.25, 0.04, 0.03), 0.5);
    }
    return c;
}

float4 main(float4 pos : SV_POSITION, float2 tex : TEXCOORD) : SV_TARGET {
    float2 res = Resolution;
    float2 fragCoord = pos.xy;
    float edge = min(min(fragCoord.x, res.x - fragCoord.x), min(fragCoord.y, res.y - fragCoord.y));
    float3 col;
    if (edge < BEZEL) {
        // pos grows downward: the housing is drawn with y up, its hazard band below.
        col = bezel(float2(fragCoord.x, res.y - fragCoord.y), res);
    } else {
        col = glass(tex, fragCoord);
        col *= lerp(0.45, 1.0, smoothstep(BEZEL, BEZEL + 18.0, edge));
    }
    return float4(col, 1.0);
}
