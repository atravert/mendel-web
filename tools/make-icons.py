#!/usr/bin/env python3
"""Fabrique les icones PWA a partir du logo 1024 de l'app iOS.

Le logo source (logo_mendel_1024.png) est un PNG RGBA. Les navigateurs
attendent des icones opaques, et Chrome refuse en plus toute transparence
dans une icone "maskable". On aplatit donc l'alpha sur un fond blanc, puis on
produit separement l'icone maskable (logo reduit a 80% centre sur la couleur
de marque, comme l'exige le "safe zone").

Aucune dependance : PNG decode/encode en pur stdlib (zlib + struct).
Les reductions de taille restent faites par sips (natif macOS).
"""

import os
import struct
import sys
import zlib

BRAND = (0x15, 0x65, 0xC0)      # color_primary de mendel-droid/colors.xml
WHITE = (0xFF, 0xFF, 0xFF)


# --------------------------------------------------------------------------
# Decodage PNG (8 bits, couleur 2 ou 6, non entrelace)
# --------------------------------------------------------------------------

def read_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("pas un PNG: %s" % path)

    idat = bytearray()
    off = 8
    width = height = depth = color = None
    while off < len(data):
        (length,) = struct.unpack(">I", data[off:off + 4])
        kind = data[off + 4:off + 8]
        body = data[off + 8:off + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, _comp, _filt, interlace = struct.unpack(
                ">IIBBBBB", body
            )
            if depth != 8 or interlace != 0 or color not in (2, 6):
                raise ValueError(
                    "PNG non gere: depth=%d color=%d interlace=%d"
                    % (depth, color, interlace)
                )
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        off += 12 + length

    channels = 3 if color == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(stride * height)

    # Retirer les filtres PNG, ligne par ligne.
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ftype == 1:                      # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:                    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:                    # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:                    # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        elif ftype != 0:
            raise ValueError("filtre PNG inconnu: %d" % ftype)
        out[y * stride:(y + 1) * stride] = line
        prev = line

    return width, height, channels, out


# --------------------------------------------------------------------------
# Ecriture PNG (couleur 2, sans alpha)
# --------------------------------------------------------------------------

def write_png(path, width, height, rgb):
    stride = width * 3
    raw = bytearray()
    for y in range(height):
        raw.append(0)                        # filtre None
        raw += rgb[y * stride:(y + 1) * stride]

    def chunk(kind, body):
        return (struct.pack(">I", len(body)) + kind + body
                + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)


# --------------------------------------------------------------------------
# Traitement
# --------------------------------------------------------------------------

def composite_over_white(width, height, channels, buf):
    """Aplatit l'alpha sur fond blanc -> tampon RGB."""
    rgb = bytearray(width * height * 3)
    for i in range(width * height):
        s = i * channels
        d = i * 3
        if channels == 3:
            rgb[d:d + 3] = buf[s:s + 3]
        else:
            a = buf[s + 3]
            if a == 255:
                rgb[d:d + 3] = buf[s:s + 3]
            else:
                inv = 255 - a
                for k in range(3):
                    rgb[d + k] = (buf[s + k] * a + 255 * inv) // 255
    return rgb


def box_downscale(width, height, rgb, tw, th):
    """Reduction par moyenne de blocs, enough pour une icone."""
    out = bytearray(tw * th * 3)
    for y in range(th):
        y0, y1 = y * height // th, max((y + 1) * height // th, y * height // th + 1)
        for x in range(tw):
            x0, x1 = x * width // tw, max((x + 1) * width // tw, x * width // tw + 1)
            n = 0
            acc = [0, 0, 0]
            for sy in range(y0, y1):
                row = sy * width * 3
                for sx in range(x0, x1):
                    p = row + sx * 3
                    acc[0] += rgb[p]
                    acc[1] += rgb[p + 1]
                    acc[2] += rgb[p + 2]
                    n += 1
            d = (y * tw + x) * 3
            out[d] = acc[0] // n
            out[d + 1] = acc[1] // n
            out[d + 2] = acc[2] // n
    return out


def pad_to_brand(size, logo_w, logo_h, logo):
    """Logo centre sur un carre de couleur de marque (icone maskable)."""
    canvas = bytearray()
    for _ in range(size):
        canvas += bytes(BRAND) * size
    off = (size - logo_w) // 2
    for y in range(logo_h):
        src = y * logo_w * 3
        dst = (y + off) * size * 3 + off * 3
        canvas[dst:dst + logo_w * 3] = logo[src:src + logo_w * 3]
    return canvas


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.environ.get("MENDEL_LOGO") or os.path.join(
        os.path.dirname(root), "mendel-ios", "Mendel-iOS", "Assets.xcassets",
        "AppIcon.appiconset", "logo_mendel_1024.png",
    )
    out_dir = os.path.join(root, "icons")
    os.makedirs(out_dir, exist_ok=True)

    width, height, channels, buf = read_png(src)
    print("source: %dx%d, %d canaux" % (width, height, channels))
    rgb = composite_over_white(width, height, channels, buf)

    # Base opaque, plein cadre: les autres tailles en sont derivees par sips.
    base = os.path.join(out_dir, "icon-1024.png")
    write_png(base, width, height, rgb)
    print("ecrit", os.path.relpath(base, root))

    # Maskable: le logo a 80% du canevas, centre, sur fond de marque.
    side = 512
    inner = int(side * 0.8)
    small = box_downscale(width, height, rgb, inner, inner)
    maskable = pad_to_brand(side, inner, inner, small)
    path = os.path.join(out_dir, "icon-maskable-512.png")
    write_png(path, side, side, maskable)
    print("ecrit", os.path.relpath(path, root))


if __name__ == "__main__":
    sys.exit(main())
