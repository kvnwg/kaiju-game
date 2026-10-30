"""Cuts the preview video together from the shots tools/trailer.mjs filmed.

    python3 tools/trailer-edit.py <frames dir> <cover.png> <out.mp4> <width> <height>

CrazyGames' rules shape the edit: 15-20 s, silent, the static cover as the first frame, no black
screens, logo cards, promo text or black bars, and no fast-forward (never faster than real time).
So the energy comes from the cutting: hits on the cut, speed-ramped slow motion (frames blended
between the 60-a-second originals), whip pans, zoom punches, white impact flashes, an RGB-split
glitch, camera shake, and one grade over everything. Frames go straight into ffmpeg (H.264).
"""
import math
import os
import random
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

SRC_FPS = 60
FPS = 30

# The edit. dur: seconds on screen; start: first source frame; speed: (time, speed) points
# (seconds into the clip, share of real time, linearly between); into: how this clip arrives;
# shake / punch: moments (seconds into the clip) for a jolt or a quick zoom kick; push: a slow
# push-in over the whole clip.
EDL = [
    dict(cover=True, dur=0.45),
    dict(cover=True, dur=0.35, zoom=(1.0, 1.32)),
    dict(shot='hatch', start=20, dur=1.25, into='whip'),
    dict(shot='prowl', start=10, dur=1.25, into='zoom', shake=[0.35]),
    dict(shot='brute', start=12, dur=1.6, speed=[(0, 1), (0.25, 1), (0.45, 0.35), (1.0, 0.35), (1.3, 1)], into='flash', shake=[0.3], punch=[0.3]),
    dict(shot='titan', start=10, dur=1.9, speed=[(0, 1), (0.8, 1), (1.0, 0.5), (1.5, 0.5), (1.9, 1)], into='whip', shake=[0.9]),
    dict(shot='towerfall', start=28, dur=2.1, speed=[(0, 0.8), (0.4, 0.55), (2.1, 0.55)], into='flash', shake=[0.9, 1.5]),
    dict(shot='laser', start=10, dur=1.5, into='glitch', shake=[0.2, 0.9]),
    dict(shot='boss', start=50, dur=1.6, speed=[(0, 0.7), (1.6, 0.55)], into='zoom', shake=[0.5], punch=[0.5]),
    dict(shot='meteor', start=98, dur=1.4, speed=[(0, 0.6), (1.4, 0.55)], into='whip', shake=[0.5, 0.9, 1.2], punch=[0.9]),
    dict(shot='finale', start=14, dur=1.6, speed=[(0, 0.8), (1.6, 0.6)], into='flash', shake=[0.2], push=0.12),
    dict(shot='breath', start=28, dur=2.8, speed=[(0, 1), (0.4, 1), (0.6, 0.5), (2.8, 0.5)], into='zoom', shake=[0.3, 0.9, 1.6], punch=[0.35], push=0.1),
]


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


class Clip:
    def __init__(self, spec, frames_dir, cover, size):
        self.s = spec
        self.size = size
        self.cover = cover
        self.files = None
        if not spec.get('cover'):
            d = os.path.join(frames_dir, spec['shot'])
            self.files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith('.jpg'))
        self.cache = {}
        self.n = int(round(spec['dur'] * FPS))

    def source_time(self, t):
        """Seconds of game time into the shot at t seconds of screen time (integrating the speed)."""
        pts = self.s.get('speed') or [(0, 1), (99, 1)]
        def speed(x):
            for (a, va), (b, vb) in zip(pts, pts[1:]):
                if x <= b:
                    return va + (vb - va) * (x - a) / max(1e-6, b - a)
            return pts[-1][1]
        steps = max(1, int(t * 240))
        dx = t / steps
        return sum(speed((i + 0.5) * dx) for i in range(steps)) * dx

    def load(self, i):
        i = max(0, min(len(self.files) - 1, i))
        if i not in self.cache:
            im = Image.open(self.files[i]).convert('RGB')
            if im.size != self.size:
                im = im.resize(self.size, Image.LANCZOS)
            self.cache[i] = np.asarray(im, dtype=np.float32)
            if len(self.cache) > 12:
                self.cache.pop(next(iter(self.cache)))
        return self.cache[i]

    def frame(self, k):
        t = k / FPS
        if self.s.get('cover'):
            img = self.cover
            z = self.s.get('zoom')
            if z:
                p = (k + 1) / self.n
                img = zoom(img, z[0] + (z[1] - z[0]) * p ** 2.2)
                if p > 0.4:
                    img = motion_blur(img, int(18 * (p - 0.4) / 0.6), radial=True)
            return img
        f = self.s['start'] + self.source_time(t) * SRC_FPS
        a = int(math.floor(f))
        w = f - a
        img = self.load(a) if w < 0.08 else self.load(a) * (1 - w) + self.load(a + 1) * w
        if self.s.get('push'):
            img = zoom(img, 1 + self.s['push'] * ease(t / self.s['dur']))
        # Moments: a quick zoom kick and a decaying shake.
        for m in self.s.get('punch', []):
            dt = t - m
            if 0 <= dt < 0.3:
                img = zoom(img, 1 + 0.07 * math.sin(math.pi * dt / 0.3))
        sx = sy = 0.0
        for m in self.s.get('shake', []):
            dt = t - m
            if 0 <= dt < 0.35:
                amp = (1 - dt / 0.35) ** 2 * self.size[0] * 0.012
                rnd = random.Random(int(m * 1000) + k)
                sx += rnd.uniform(-amp, amp)
                sy += rnd.uniform(-amp, amp)
        if sx or sy:
            img = shift(zoom(img, 1.03), sx, sy)
        return img


def zoom(img, s):
    if abs(s - 1) < 1e-3:
        return img
    h, w = img.shape[:2]
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    cw, ch = w / s, h / s
    box = ((w - cw) / 2, (h - ch) / 2, (w + cw) / 2, (h + ch) / 2)
    return np.asarray(im.resize((w, h), Image.BICUBIC, box=box), dtype=np.float32)


def shift(img, dx, dy):
    """Move the picture, repeating the edge pixels into the gap (no wrap-around)."""
    dx, dy = int(round(dx)), int(round(dy))
    h, w = img.shape[:2]
    dx = max(-w + 1, min(w - 1, dx))
    dy = max(-h + 1, min(h - 1, dy))
    xs = np.clip(np.arange(w) - dx, 0, w - 1)
    ys = np.clip(np.arange(h) - dy, 0, h - 1)
    return img[ys][:, xs]


def motion_blur(img, length, radial=False, direction=1):
    """Smear along x (a whip pan) or out from the centre (radial: a push-in)."""
    if length < 2:
        return img
    if radial:
        acc = img.copy()
        for i in range(1, 6):
            acc += zoom(img, 1 + i * length / 600)
        return acc / 6
    acc = np.zeros_like(img)
    n = 8
    for i in range(n):
        acc += shift(img, direction * length * i / n, 0)
    return acc / n


def rgb_split(img, amount):
    out = img.copy()
    out[:, :, 0] = shift(img[:, :, 0:1], amount, 0)[:, :, 0]
    out[:, :, 2] = shift(img[:, :, 2:3], -amount, 0)[:, :, 0]
    return out


def glitch(img, k, strength):
    out = rgb_split(img, int(strength * 18))
    rnd = random.Random(k * 7 + 3)
    h = img.shape[0]
    for _ in range(int(6 * strength)):
        y0 = rnd.randrange(0, h - 20)
        hh = rnd.randrange(8, 60)
        out[y0:y0 + hh] = np.roll(out[y0:y0 + hh], rnd.randrange(-60, 60), axis=1)
    return out


def grade(img, vig):
    """One look over every shot: a touch more colour and contrast, gently darker corners."""
    lum = img @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    img = lum[..., None] + (img - lum[..., None]) * 1.14
    img = (img - 128) * 1.05 + 130
    return img * vig[..., None]


def render(frames_dir, cover_path, out, W, H):
    size = (W, H)
    cover = np.asarray(Image.open(cover_path).convert('RGB').resize(size, Image.LANCZOS), dtype=np.float32)
    clips = [Clip(s, frames_dir, cover, size) for s in EDL]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    vig = (1 - 0.16 * np.clip((d - 0.55) / 0.9, 0, 1) ** 1.5).astype(np.float32)
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-maxrate', '16M', '-bufsize', '32M', '-pix_fmt', 'yuv420p',
                           '-movflags', '+faststart', '-an', out], stdin=subprocess.PIPE)
    total = 0
    for ci, clip in enumerate(clips):
        nxt = clips[ci + 1] if ci + 1 < len(clips) else None
        for k in range(clip.n):
            img = clip.frame(k)
            into = clip.s.get('into')
            # How this clip arrives.
            if into == 'flash' and k < 4:
                img = img + (255 - img) * [0.9, 0.6, 0.3, 0.1][k]
            elif into == 'zoom' and k < 7:
                img = zoom(img, 1 + 0.18 * (1 - ease(k / 7)))
                if k < 3:
                    img = motion_blur(img, 14 - k * 4, radial=True)
            elif into == 'whip' and k < 4:
                img = shift(motion_blur(img, 120 - k * 30, direction=-1), -(W * 0.22) * (1 - k / 4) ** 2, 0)
            elif into == 'glitch' and k < 4:
                img = glitch(img, k + total, 1 - k / 4)
            # How it leaves, ahead of a whip or glitch in the next one.
            if nxt and k >= clip.n - 3:
                j = k - (clip.n - 3)
                if nxt.s.get('into') == 'whip':
                    img = shift(motion_blur(img, 40 + j * 40), (W * 0.18) * ((j + 1) / 3) ** 2, 0)
                elif nxt.s.get('into') == 'glitch' and j == 2:
                    img = glitch(img, total + k, 0.6)
            # The cover keeps its own colours: the video opens on exactly the cover.
            if not clip.s.get('cover'):
                img = grade(img, vig)
            ff.stdin.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())
            total += 1
    ff.stdin.close()
    ff.wait()
    print(f'{out}: {total} frames, {total / FPS:.2f} s, {os.path.getsize(out) / 1e6:.1f} MB')


if __name__ == '__main__':
    frames_dir, cover_path, out, W, H = sys.argv[1:6]
    render(frames_dir, cover_path, out, int(W), int(H))
