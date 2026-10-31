#!/usr/bin/env python3
"""Render og-image.png (1200×630): Michael + Hero-Slogan links, Wachstum-Punktwolke rechts."""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "og-image.png"

BG = (246, 244, 239)
TEXT = (29, 36, 33)
ACCENT = (26, 95, 89)
MUTED = (87, 94, 87)
FRONT = (30, 107, 100)
BACK = (201, 221, 216)

W, H = 1200, 630


def imul(a: int, b: int) -> int:
    return ((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF)) & 0xFFFFFFFF


def rnd_gen(seed: int):
    seed &= 0xFFFFFFFF

    def rnd() -> float:
        nonlocal seed
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(seed ^ (seed >> 15), 1 | seed)
        t = (t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rnd


def col_h(ix: int) -> float:
    return 0.2 + 1.32 * ((ix + 1) / 7) ** 1.5


def build_stage3(n: int = 3800):
    """Endstufe der Site-Punktwolke: Säulen + Wachstumskurve/Pfeil (Seed 11 wie punktwolke.src.js)."""
    rnd = rnd_gen(11)
    base = -0.85
    perm = list(range(n))
    for i in range(n - 1, 0, -1):
        k = int(rnd() * (i + 1))
        perm[i], perm[k] = perm[k], perm[i]

    gx, gz, lz, lx = 1.2, 0.75, 7, 11
    len_a, len_b = 2 * gx, 2 * gz
    total = lz * len_a + lx * len_b

    def grid(u: float, y: float):
        d = u * total
        if d < lz * len_a:
            li = int(d / len_a)
            x = -gx + (d - li * len_a)
            z = -gz + li * (2 * gz / (lz - 1))
        else:
            d -= lz * len_a
            lj = min(lx - 1, int(d / len_b))
            z = -gz + (d - lj * len_b)
            x = -gx + lj * (2 * gx / (lx - 1))
        return x, y, z

    cols, cum = [], 0.0
    for ix in range(7):
        cum += col_h(ix) + 0.5
        cols.append({"x": -1 + ix * 0.333, "z": 0.0, "h": col_h(ix), "c": cum})

    pts = []
    for k in range(n):
        j = perm[k]
        q = (j + 0.5) / n
        if q < 0.16:
            x, y, z = grid(q / 0.16, base)
        elif q < 0.9:
            r = rnd() * cum
            c = cols[0]
            for m in cols:
                if m["c"] >= r:
                    c = m
                    break
            hw, u = 0.1, rnd()
            if u < 0.62:
                cn = int(rnd() * 4)
                x = c["x"] + (hw if cn & 1 else -hw)
                z = c["z"] + (hw if cn & 2 else -hw)
                y = rnd() * c["h"]
            elif u < 0.93:
                pp = rnd() * 4
                sd = int(pp)
                f = (pp - sd) * 2 - 1
                y = c["h"]
                if sd == 0:
                    x, z = c["x"] + f * hw, c["z"] - hw
                elif sd == 1:
                    x, z = c["x"] + hw, c["z"] + f * hw
                elif sd == 2:
                    x, z = c["x"] - f * hw, c["z"] + hw
                else:
                    x, z = c["x"] - hw, c["z"] + f * hw
            else:
                s2 = int(rnd() * 4)
                f2 = (rnd() * 2 - 1) * hw
                y = rnd() * c["h"]
                if s2 < 2:
                    x, z = c["x"] + f2, c["z"] + (hw if s2 else -hw)
                else:
                    x, z = c["x"] + (hw if s2 == 2 else -hw), c["z"] + f2
            y = base + y
        else:
            tt = (q - 0.9) / 0.1

            def top(xv: float) -> float:
                fi = (xv + 1) / 0.333
                return base + 0.2 + 1.32 * (max(0, fi + 1) / 7) ** 1.5 + 0.22

            if tt < 0.88:
                cx = -1.12 + tt / 0.88 * 2.2
                cy = top(cx)
            else:
                b = (tt - 0.88) / 0.12
                ex, ey = 1.08, top(1.08)
                wing = b * 2 if b < 0.5 else (b - 0.5) * 2
                cx = ex - wing * 0.13 * (1 if b < 0.5 else 0.35)
                cy = ey - wing * 0.13 * (0.35 if b < 0.5 else 1)
            x, y, z = cx, cy, 0.12
        pts.append((x, y, z, rnd()))
    return pts


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def main() -> None:
    card = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(card)

    # System-Inter (Fallback) – entspricht der Site-Schrift
    inter = "/usr/share/fonts/truetype/macos"
    f_name = font(f"{inter}/Inter-SemiBold.ttf", 28)
    f_slogan = font(f"{inter}/Inter-Bold.ttf", 58)
    f_quiet = font(f"{inter}/Inter-Medium.ttf", 36)

    x0, y = 72, 145
    draw.text((x0, y), "Michael", font=f_name, fill=TEXT)
    y = draw.textbbox((x0, y), "Michael", font=f_name)[3] + 28
    for text, fnt, fill, gap in [
        ("IT als", f_slogan, TEXT, 6),
        ("Wettbewerbsvorteil,", f_slogan, ACCENT, 18),
        ("nicht als Kostenstelle.", f_quiet, MUTED, 0),
    ]:
        draw.text((x0, y), text, font=fnt, fill=fill)
        y = draw.textbbox((x0, y), text, font=fnt)[3] + gap

    # Projektion wie im Vertex-Shader (Morph = 3)
    ax, ay = 0.34, -0.36
    cx, sx = math.cos(ax), math.sin(ax)
    cy, sy = math.cos(ay), math.sin(ay)
    art_x0, art_y0, art_w, art_h = 620, 40, 540, 550
    u_d, u_r = 5.0, min(art_w, art_h) * 0.46
    u_cx, u_cy = art_x0 + art_w * 0.48, art_y0 + art_h * 0.54

    projected = []
    for x, y, z, s in build_stage3():
        px = cy * x + (sx * sy) * y + (-cx * sy) * z
        py = cx * y + sx * z
        pz = sy * x + (-sx * cy) * y + (cx * cy) * z
        scale = u_d / (u_d - pz)
        scr_x = u_cx + px * u_r * scale
        scr_y = u_cy + (-py) * u_r * scale
        df = max(0.0, min(1.0, (pz + 1.2) / 2.4))
        pt = 3.2 * scale * (0.75 + 0.5 * s)
        projected.append((scr_x, scr_y, df, pt, pz))
    projected.sort(key=lambda t: t[4])

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for scr_x, scr_y, df, pt, _ in projected:
        t = 0.3 + 0.7 * df
        r = int(BACK[0] + (FRONT[0] - BACK[0]) * t)
        g = int(BACK[1] + (FRONT[1] - BACK[1]) * t)
        b = int(BACK[2] + (FRONT[2] - BACK[2]) * t)
        a = int((0.25 + 0.75 * df) * 210)
        rad = max(1.2, pt * 0.55)
        for k, aa in ((1.0, a), (0.65, a // 2)):
            rr = rad * k
            ld.ellipse([scr_x - rr, scr_y - rr, scr_x + rr, scr_y + rr], fill=(r, g, b, aa))

    card = Image.alpha_composite(card.convert("RGBA"), layer).convert("RGB")
    card.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({W}x{H})")


if __name__ == "__main__":
    main()
