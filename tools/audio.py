#!/usr/bin/env python3
"""Preparation, encodage et mesure du theme audio.

Le theme pese 2,1 Mo, ce qui est enorme pour une musique de fond jouee a
25 % du volume. Ce outil repond a trois questions, dans cet ordre:

  analyse   le fichier est-il vraiment stereo ? porte-t-il du silence en
            bordure ? a-t-il du contenu au-dela de sa Nyquist ?
  ladder    pour chaque couple (frequence, debit), quelle taille et quelle
            qualite -- mesurees, pas estimees.
  build     produit le fichier retenu avec les reglages retenus.
  levels    a quel niveau sortira reellement chaque fichier, une fois
            multiplie par MUSIC_VOLUME et EFFECT_VOLUME.

Point de methode important : le rééchantillonnage est delegue a afconvert,
pas fait ici. Un decimateur lineaire maison replie le contenu au-dessus de la
nouvelle Nyquist dans les basses (aliasing), ce qui est plus audible que
toute perte de codec. afconvert applique un vrai filtre anti-repli.

De meme, la mesure isole la perte du codec : la reference est le WAV prepare
puis converti a la meme frequence par afconvert en PCM (sans perte), et le
candidat est le meme WAV encode. On compare donc bien le codec, rien d'autre.

Aucune dependance externe: sous-ensemble de la bibliotheque standard, plus
afconvert qui est livre avec macOS.
"""

import array
import cmath
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave

PCM_SUBFORMAT = 0x0001
SILENCE = 300          # ~ -41 dBFS, inaudible sous une musique de fond


# --- lecture WAV tolérante --------------------------------------------------


def read_wav(path):
    """Lit un WAV 16 bits. Gere WAVE_FORMAT_EXTENSIBLE (0xFFFE), que le
    module `wave` de la bibliotheque standard refuse alors qu'afconvert le
    produit regulierement."""
    with open(path, "rb") as handle:
        data = handle.read()

    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("%s n'est pas un RIFF/WAVE" % path)

    fmt = None
    raw = None
    offset = 12
    while offset + 8 <= len(data):
        chunk = data[offset:offset + 4]
        size = int.from_bytes(data[offset + 4:offset + 8], "little")
        body = data[offset + 8:offset + 8 + size]
        if chunk == b"fmt ":
            tag = int.from_bytes(body[0:2], "little")
            channels = int.from_bytes(body[2:4], "little")
            rate = int.from_bytes(body[4:8], "little")
            bits = int.from_bytes(body[14:16], "little")
            if tag == 0xFFFE:
                # wValidBitsPerSample (18), dwChannelMask (20), puis le GUID du
                # sous-format a l'offset 24.
                if int.from_bytes(body[24:26], "little") != PCM_SUBFORMAT:
                    raise ValueError("%s: sous-format non gere" % path)
            fmt = (channels, rate, bits)
        elif chunk == b"data":
            raw = body
        offset += 8 + size + (size & 1)     # les chunks sont alignes sur 2

    if fmt is None or raw is None:
        raise ValueError("%s: chunks fmt ou data manquant" % path)

    channels, rate, bits = fmt
    if bits != 16:
        raise ValueError("%s: seul le 16 bits est gere, recu %d" % (path, bits))

    samples = array.array("h")
    samples.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if sys.byteorder == "big":
        samples.byteswap()
    return samples[0::channels], rate, channels


def write_wav(path, samples, rate):
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(samples.tobytes())


def afconvert(args):
    result = subprocess.run(["afconvert"] + args, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError("afconvert %s -> %s"
                           % (" ".join(args), result.stderr.decode().strip()))
    return result


# --- 1. analyse -------------------------------------------------------------


def fft(values):
    n = len(values)
    if n == 1:
        return values
    even = fft(values[0::2])
    odd = fft(values[1::2])
    factor = cmath.exp(-2j * math.pi / n)
    out = [0j] * n
    for k in range(n // 2):
        t = factor ** k * odd[k]
        out[k] = even[k] + t
        out[k + n // 2] = even[k] - t
    return out


def db(value):
    return 20 * math.log10(value) if value > 0 else -999.0


def rms(values):
    return math.sqrt(sum(float(v) * v for v in values) / len(values)) if values else 0.0


def analyse(path):
    samples, rate, channels = read_wav(path)
    print("fichier : %s" % path)
    print("duree   : %.2f s   %d Hz   %d canaux\n" % (len(samples) / rate, rate, channels))

    print("STEREO REEL ?")
    if channels > 1:
        other = samples[1::2]
        difference = [a - b for a, b in zip(samples, other)]
        level = db(rms(samples))
        delta = db(rms(difference))
        print("   canal gauche          %6.1f dB" % level)
        print("   gauche - droite       %6.1f dB" % delta)
        print("   -> %s" % ("double mono, le stereo est du gaspillage"
                          if delta <= 0 else "stereo reel"))
    else:
        print("   -> deja mono")

    first = 0
    while first < len(samples) and abs(samples[first]) < SILENCE:
        first += 1
    last = len(samples) - 1
    while last > first and abs(samples[last]) < SILENCE:
        last -= 1
    head, tail = first / rate, (len(samples) - 1 - last) / rate
    print("\nSILENCE EN BORDURE")
    print("   tete %.3f s   queue %.3f s   total %.1f %% du fichier"
          % (head, tail, 100 * (head + tail) * rate / len(samples)))

    print("\nBANDE UTILE (24 fenetres de 8192 echantillons, Hann)")
    size = 8192
    window = [0.5 * (1 - math.cos(2 * math.pi * i / size)) for i in range(size)]
    step = max(1, (len(samples) - size) // 24)
    bands = [0.0] * 24
    for index in range(24):
        start = index * step
        chunk = [complex(float(samples[start + i]) * window[i], 0.0) for i in range(size)]
        spectrum = fft(chunk)
        for bin_index in range(size // 2):
            frequency = bin_index * rate / size
            bands[min(int(frequency / 2000), 23)] += abs(spectrum[bin_index]) ** 2
    peak = max(bands) or 1.0
    for band in range(22):
        share = db(math.sqrt(bands[band] / peak))
        print("   %2d-%2d kHz  %6.1f dB  %s"
              % (band * 2, band * 2 + 2, share, "#" * max(0, int((share + 70) / 3))))

    crest = db(max(max(samples), -min(samples)) / 32767.0)
    print("\nNIVEAU")
    print("   crete %.1f dBFS   RMS %.1f dBFS   reserve %.1f dB"
          % (crest, db(rms(samples) / 32767.0), crest - db(rms(samples) / 32767.0)))


# --- 2. preparation ---------------------------------------------------------


def prepare(src_wav, dst_wav):
    """Coupe les silences de bordure et passe en mono. Sans perte, et a la
    frequence d'origine: le rééchantillonnage reste à afconvert."""
    samples, rate, _ = read_wav(src_wav)
    first = 0
    while first < len(samples) and abs(samples[first]) < SILENCE:
        first += 1
    last = len(samples) - 1
    while last > first and abs(samples[last]) < SILENCE:
        last -= 1
    trimmed = samples[first:last + 1]
    write_wav(dst_wav, trimmed, rate)
    return len(trimmed) / rate


# --- 3. mesure --------------------------------------------------------------


def align(reference, decoded, max_lag=4096, probe=4096):
    """Trouve le decalage entre reference et sortie decodee.

    Les codecs introduisent un retard non nul: AAC announce 2112 echantillons
    d'amorce, MP3 576. Sans correction, on mesure un signal contre un autre
    decale, et le bruit de mesure noie completement la perte reelle.

    Recherche en deux passes (pas de 32 puis au pas de 1): exhaustive sur
    4096 lags en pur Python, il serait sinon trop lent.
    """
    def score(lag):
        if lag >= 0:
            a, b = reference[lag:lag + probe], decoded[:probe]
        else:
            a, b = reference[:probe], decoded[-lag:-lag + probe]
        if len(a) < probe or len(b) < probe:
            return -2.0
        numerator = sum(x * y for x, y in zip(a, b))
        denominator = (math.sqrt(sum(float(x) * x for x in a))
                       * math.sqrt(sum(float(y) * y for y in b)))
        return numerator / denominator if denominator else 0.0

    best_lag, best = 0, -2.0
    for lag in range(0, max_lag + 1, 32):
        value = score(lag)
        if value > best:
            best, best_lag = value, lag
    for lag in range(max(0, best_lag - 32), min(max_lag, best_lag + 32) + 1):
        value = score(lag)
        if value > best:
            best, best_lag = value, lag
    return best_lag, best


def measure(reference, decoded, segment=240000):
    """Correlation et rapport signal/bruit apres alignement et ajustement du
    gain au mieux. Sans cet ajustement, un ecart d'amplitude d'un centieme
    suffit a faire tomber le SNR de plusieurs dB, et la comparaison entre
    encodes perd tout son sens."""
    lag, correlation = align(reference, decoded)
    if lag >= 0:
        a, b = reference[lag:lag + segment], decoded[:segment]
    else:
        a, b = reference[:segment], decoded[-lag:-lag + segment]
    if len(a) < segment or len(b) < segment:
        return correlation, 999.0, 1.0, 0

    numerator = sum(x * y for x, y in zip(a, b))
    denominator = sum(float(x) * x for x in a)
    gain = numerator / denominator if denominator else 1.0

    error = 0
    signal = 0.0
    for x, y in zip(a, b):
        residual = x - gain * y
        error += residual * residual
        signal += (gain * y) ** 2
    snr = 10 * math.log10(signal / error) if error > 0 else 999.0
    return correlation, snr, gain, lag


# --- 4. echelle de debit ----------------------------------------------------


RATES = (44100, 32000, 22050)
BITRATES = (128000, 96000, 80000, 64000, 48000)


def ladder(source, codec="aac"):
    work = tempfile.mkdtemp(prefix="mendel-audio-")
    try:
        raw = os.path.join(work, "source.wav")
        afconvert(["-f", "WAVE", "-d", "LEI16@44100", source, raw])

        mono = os.path.join(work, "mono.wav")
        duration = prepare(raw, mono)
        source_size = os.path.getsize(source)
        print("source    %s  (%.2f s, stereo)" % (human(source_size), duration))
        print("prepare   mono, silences coupes, %.2f s, %s de WAV\n"
              % (duration, human(os.path.getsize(mono))))
        print("  %6s  %4s  %8s  %10s  %7s  %s"
              % ("Hz", "kbit", "taille", "correlation", "SNR dB", "gain"))

        results = []
        for rate in RATES:
            reference_wav = os.path.join(work, "ref-%d.wav" % rate)
            afconvert(["-f", "WAVE", "-d", "LEI16@%d" % rate, mono, reference_wav])
            reference, _, _ = read_wav(reference_wav)

            for bitrate in BITRATES:
                candidate = os.path.join(work, "c-%d-%d" % (rate, bitrate))
                try:
                    encode(codec, mono, candidate, rate, bitrate)
                except RuntimeError as error:
                    print("  %6d  %4d  %s" % (rate, bitrate // 1000, error))
                    continue

                back = os.path.join(work, "b-%d-%d.wav" % (rate, bitrate))
                afconvert(["-f", "WAVE", "-d", "LEI16@%d" % rate, candidate, back])
                decoded, _, _ = read_wav(back)
                correlation, snr, gain, lag = measure(reference, decoded)
                size = os.path.getsize(candidate)
                results.append((rate, bitrate, size, correlation, snr))
                print("  %6d  %4d  %8s  %10.4f  %7.1f  %.4f  (retard %d)"
                      % (rate, bitrate // 1000, human(size), correlation, snr, gain, lag))

        print("\nTAILLE ATTENDUE = debit x duree, hors conteneur.")
        print("La frequence d'echantillonnage ne change pas la taille a debit "
              "fixe:\n elle permet seulement de descendre plus bas sans "
              "repli de spectre.\n")
        for rate in RATES:
            for bitrate in BITRATES:
                print("  %5d Hz @ %3d kbit/s  ->  %6s Ko"
                      % (rate, bitrate // 1000,
                         int(bitrate * duration / 8) // 1024))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def human(size):
    return "%.0f Ko" % (size / 1024) if size < 1024 * 1024 else "%.1f Mo" % (size / 1048576.0)


def encode(codec, src, dst, rate, bitrate):
    """Reechantillonne puis encode, en deux etapes.

    afconvert refuse `-s` (frequence) en meme temps qu'un format de donnees
    ('!dat'). Le rééchantillonnage passe donc par un WAV intermediaire, ce qui
    a l'avantage de garder le filtre anti-repli d'afconvert.
    """
    if codec == "aac":
        resampled = dst + ".wav"
        afconvert(["-f", "WAVE", "-d", "LEI16@%d" % rate, src, resampled])
        afconvert(["-f", "m4af", "-d", "aac ", "-b", str(bitrate), resampled, dst])
        os.unlink(resampled)
    elif codec == "mp3":
        if not have_lame():
            raise RuntimeError("lame absent (brew install lame)")
        subprocess.run(["lame", "--quiet", "-m", "m", "-b", str(bitrate),
                        "--resample", str(rate), src, dst], check=True)
    else:
        raise ValueError("codec inconnu: %s" % codec)


def have_lame():
    return subprocess.run(["which", "lame"], capture_output=True).returncode == 0


# --- 5. production du fichier final -----------------------------------------


def build(source, output, codec="aac", rate=32000, bitrate=64000):
    work = tempfile.mkdtemp(prefix="mendel-build-")
    try:
        raw = os.path.join(work, "source.wav")
        afconvert(["-f", "WAVE", "-d", "LEI16@44100", source, raw])
        mono = os.path.join(work, "mono.wav")
        duration = prepare(raw, mono)
        encode(codec, mono, output, rate, bitrate)
        print("%s : %s -> %s, mono %d Hz @ %d kbit/s, %.2f s"
              % (output, human(os.path.getsize(source)), human(os.path.getsize(output)),
                 rate, bitrate // 1000, duration))
    finally:
        shutil.rmtree(work, ignore_errors=True)


# --- CLI --------------------------------------------------------------------

# Reglages retenus pour le theme livre. Justifies par `ladder`: a taille
# egale, 22050 Hz donne 7 dB de SNR de plus que 44100 Hz, parce que le filtre
# anti-repli retire les aigus durs ou le codec gaspillait ses bits.
DEFAULT_RATE = 22050
DEFAULT_BITRATE = 64000
DEFAULT_CODEC = "aac"
DEFAULT_THEME = "audio/quiz_arcade_theme.m4a"


def source_theme():
    """Le theme d'origine appartient a l'app Android, que l'on ne modifie pas.

    Meme convention que extract-data.py: variable d'environnement pour
    pointer ailleurs, chemin du depot natif par defaut. Le .m4a produit est
    versionne ici, pas le .mp3 source de 2,1 Mo.
    """
    repository = os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))
    return os.environ.get("MENDEL_THEME") or os.path.join(
        repository, "mendel-droid", "app", "src", "main", "res", "raw",
        "quiz_arcade_theme.mp3")


# --- 4. niveaux de lecture --------------------------------------------------


def playback_constants(path="js/audio.js"):
    """Lit MUSIC_VOLUME et EFFECT_VOLUME dans le code.

    L'interet est de ne pas recopier les valeurs dans l'outil: la mesure
    decrit alors ce que le navigateur fera reellement, et non ce qu'un
    commentaire promet. Si les deux divergent, la mesure ment, et c'est
    exactement le piege qu'on cherche a eviter.
    """
    with open(path, encoding="utf-8") as handle:
        source = handle.read()

    values = {}
    for name in ("MUSIC_VOLUME", "EFFECT_VOLUME"):
        found = re.search(r"^const\s+%s\s*=\s*([0-9.]+)\s*;" % name, source, re.M)
        if not found:
            raise ValueError("js/audio.js: constante %s introuvable" % name)
        values[name] = float(found.group(1))
    return values["MUSIC_VOLUME"], values["EFFECT_VOLUME"]


def levels_of(samples, rate):
    """Retourne (rms dBFS, pic dBFS, echantillons ecretes)."""
    if not samples:
        return -999.0, -999.0, 0
    level = db(rms(samples) / 32768.0)
    peak = db(max(abs(v) for v in samples) / 32768.0)
    clipped = sum(1 for v in samples if abs(v) >= 32700)
    return level, peak, clipped


def trailing_fade(samples, rate):
    """Longueur du fondu final, en secondes, s'il y en a un.

    Un theme est joue en boucle. Une queue qui s'eteint, sans tete qui monte,
    fait disparaitre le fond pendant plusieurs secondes a chaque tour: on ne
    l'entend pas comme une coupure franche mais comme un son "pas
    regulier", ce qui est exactement le genre deinctrt que l'oreille remarque
    sans pouvoir le nommer.
    """
    if not samples:
        return 0.0
    overall = db(rms(samples) / 32768.0)
    fenetre = int(rate * 0.5)
    if len(samples) < 4 * fenetre:
        return 0.0
    # On remonte tant que la demi-seconde est plus de 8 dB sous le niveau
    # general: c'est un fondu, pas un creux.
    i = len(samples)
    while i >= fenetre:
        bloc = samples[i - fenetre:i]
        if db(rms(bloc) / 32768.0) > overall - 8.0:
            break
        i -= fenetre
    return (len(samples) - i) / rate


def levels(theme=DEFAULT_THEME, sfx_dir="audio"):
    music_volume, effect_volume = playback_constants()
    work = tempfile.mkdtemp(prefix="mendel-levels-")
    try:
        theme_wav = os.path.join(work, "theme.wav")
        afconvert(["-f", "WAVE", "-d", "LEI16@22050", theme, theme_wav])

        print("constantes lues dans js/audio.js :")
        print("   MUSIC_VOLUME    = %.2f  (%+.1f dB)" % (music_volume, db(music_volume)))
        print("   EFFECT_VOLUME   = %.2f  (%+.1f dB)\n" % (effect_volume, db(effect_volume)))

        print("  %-24s %7s %7s   %8s %8s" % ("fichier", "rms", "pic", "rms lu", "pic lu"))
        print("  %s" % ("-" * 62))

        theme_samples, rate, _ = read_wav(theme_wav)
        t_rms, t_peak, t_clip = levels_of(theme_samples, rate)
        print("  %-24s %7.1f %7.1f   %8.1f %8.1f"
              % ("theme", t_rms, t_peak, t_rms + db(music_volume), t_peak + db(music_volume)))

        effects = sorted(name for name in os.listdir(sfx_dir) if name.endswith(".wav"))
        rms_list = []
        clipping = []
        for name in effects:
            samples, effect_rate, _ = read_wav(os.path.join(sfx_dir, name))
            e_rms, e_peak, e_clip = levels_of(samples, effect_rate)
            rms_list.append(e_rms)
            if e_clip:
                clipping.append(name)
            if e_peak + db(effect_volume) > -0.1:
                clipping.append(name + " (lecture)")
            print("  %-24s %7.1f %7.1f   %8.1f %8.1f"
                  % (name, e_rms, e_peak, e_rms + db(effect_volume),
                     e_peak + db(effect_volume)))

        moyenne = sum(rms_list) / len(rms_list)
        ecart = moyenne + db(effect_volume) - (t_rms + db(music_volume))
        print("\n  ecart musique / effets : %.1f dB" % ecart)
        if ecart < 8:
            print("    -> trop serre: le fond et l'information se confondent")
        elif ecart > 20:
            print("    -> trop ouvert: la musique devient inaudible au volume normal")
        else:
            print("    -> plage habituelle pour un fond (8 a 20 dB)")

        if clipping:
            print("\n  ATTENTION ecretage : %s" % ", ".join(clipping))
            print("    les fichiers source sont deja a 0 dBFS, la distorsion est")
            print("    inscrite dedans: aucun gain ne la redressera")

        fade = trailing_fade(theme_samples, rate)
        if fade > 1.0:
            print("\n  fond en boucle : fondu final de %.1f s, sans fondu de tete" % fade)
            print("    -> le fond disparait %.0f s toutes les %.0f s"
                  % (fade, len(theme_samples) / rate))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1

    command = argv[1]
    if command == "analyse":
        analyse(argv[2] if len(argv) > 2 else DEFAULT_THEME)
    elif command == "ladder":
        ladder(argv[2] if len(argv) > 2 else source_theme(),
               argv[3] if len(argv) > 3 else DEFAULT_CODEC)
    elif command == "build":
        build(argv[2] if len(argv) > 2 else source_theme(),
              argv[3] if len(argv) > 3 else DEFAULT_THEME,
              argv[4] if len(argv) > 4 else DEFAULT_CODEC,
              int(argv[5]) if len(argv) > 5 else DEFAULT_RATE,
              int(argv[6]) if len(argv) > 6 else DEFAULT_BITRATE)
    elif command == "levels":
        levels(argv[2] if len(argv) > 2 else DEFAULT_THEME,
               argv[3] if len(argv) > 3 else "audio")
    else:
        print("commande inconnue: %s" % command)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
