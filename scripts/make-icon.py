"""OpenNodes app icon on Apple's 1024 grid: an 824 body with continuous (squircle) corners,
three nodes and two wires. Writes the full icon, a cropped mark (favicon, header) and a
full-bleed square (apple-touch-icon, the OS adds its own mask).

    python3 scripts/make-icon.py <out-dir>

Then copy: icon.svg -> assets/icon.svg; logo-mark.svg -> docs/ and assets/ (and into
assets/logo.svg); touch.svg rendered at 180 px -> docs/apple-touch-icon.png; icon.svg
rendered at 1024 px -> assets/icon-1024.png (e.g. with headless Chrome --screenshot)."""
import math
import sys

OUT = sys.argv[1]


def squircle(x, y, w, h, n=5.0, steps=96):
    """A superellipse |x|^n + |y|^n = 1 fitted to the box: Apple-like continuous corners."""
    cx, cy, a, b = x + w / 2, y + h / 2, w / 2, h / 2
    pts = []
    for i in range(steps * 4):
        t = 2 * math.pi * i / (steps * 4)
        c, s = math.cos(t), math.sin(t)
        px = cx + a * math.copysign(abs(c) ** (2 / n), c)
        py = cy + b * math.copysign(abs(s) ** (2 / n), s)
        pts.append(f"{px:.1f} {py:.1f}")
    return "M" + " L".join(pts) + " Z"


def wire(x0, y0, ymid, x1, y1, r=28):
    """Down, across, down — with rounded turns, like the sketch."""
    d = 1 if x1 > x0 else -1
    return (
        f"M{x0} {y0} V{ymid - r} Q{x0} {ymid} {x0 + d * r} {ymid} "
        f"H{x1 - d * r} Q{x1} {ymid} {x1} {ymid + r} V{y1}"
    )


# Nodes: 200 x 200, symmetric 128 side margins, content centred vertically (112 top/bottom).
A = (228, 212)  # top left
B = (596, 292)  # right, one step lower
C = (412, 612)  # bottom, centred
S = 200


def node(x, y):
    return f'<path d="{squircle(x, y, S, S, n=4.6, steps=48)}" fill="url(#node)" stroke="url(#nodeEdge)" stroke-width="6"/>'


WIRES = (
    f'<path d="{wire(A[0] + S // 2, A[1] + S, 512, 500, C[1])}"/>'
    f'<path d="{wire(B[0] + S // 2, B[1] + S, 552, 524, C[1])}"/>'
)

DEFS = """<defs>
  <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#F4F4F6"/>
    <stop offset="1" stop-color="#CDCDD3"/>
  </linearGradient>
  <linearGradient id="bodyEdge" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.9"/>
    <stop offset="1" stop-color="#9A9AA2" stop-opacity="0.9"/>
  </linearGradient>
  <linearGradient id="node" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3A3A40"/>
    <stop offset="1" stop-color="#1E1E22"/>
  </linearGradient>
  <linearGradient id="nodeEdge" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5C5C66"/>
    <stop offset="1" stop-color="#141417"/>
  </linearGradient>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
    <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/>
  </filter>
</defs>"""

def content(wire_width):
    return (
        f'<g fill="none" stroke="#2A2A2F" stroke-width="{wire_width}" stroke-linecap="round" stroke-linejoin="round">{WIRES}</g>'
        + node(*A)
        + node(*B)
        + node(*C)
    )


CONTENT = content(16)
# Small sizes (favicon, header): thicker wires so they still read at 16-32 px.
SMALL = content(24)

BODY = squircle(100, 100, 824, 824)

full = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<title>OpenNodes</title>
{DEFS}
<path d="{BODY}" fill="url(#body)" filter="url(#shadow)"/>
<path d="{BODY}" fill="none" stroke="url(#bodyEdge)" stroke-width="6"/>
{CONTENT}
</svg>
"""

# The mark: just the body (no shadow margin), for the favicon and the header.
mark = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 96 832 832" width="64" height="64">
<title>OpenNodes</title>
{DEFS}
<path d="{BODY}" fill="url(#body)"/>
<path d="{BODY}" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="12"/>
<path d="{BODY}" fill="none" stroke="url(#bodyEdge)" stroke-width="5"/>
{SMALL}
</svg>
"""

# Full-bleed square for iOS / macOS shortcuts: the system rounds it itself.
square = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824" width="180" height="180">
{DEFS}
<rect x="100" y="100" width="824" height="824" fill="url(#body)"/>
{CONTENT}
</svg>
"""

for name, text in [("icon.svg", full), ("logo-mark.svg", mark), ("touch.svg", square)]:
    with open(f"{OUT}/{name}", "w") as f:
        f.write(text)
print("ok")
