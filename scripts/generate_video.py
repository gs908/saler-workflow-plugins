#!/usr/bin/env python3
"""
音频 + 自定义字幕 txt → 滚动歌词 MP4
"""

import argparse
import json
import re
import subprocess
import sys
import io
from pathlib import Path

# Windows 强制 stdout/stderr 使用 UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ─── 字幕解析 ────────────────────────────────────────────────

def parse_txt(path):
    content = Path(path).read_text(encoding='utf-8-sig')
    pattern = re.compile(
        r'\[(\d{2}:\d{2})-(\d{2}:\d{2})\]\s*【([^】]*)】\s*\n(.*?)(?=\n\[|\Z)',
        re.DOTALL
    )
    def to_sec(t):
        m, s = t.split(':')
        return int(m) * 60 + int(s)

    result = []
    for match in pattern.finditer(content):
        start  = to_sec(match.group(1))
        end    = to_sec(match.group(2))
        speaker = match.group(3).strip()
        text   = match.group(4).strip()
        if not text:
            continue
        if end <= start:
            end = start + 1
        result.append((start, end, text, speaker))
    return result

# ─── 背景（白色系渐变） ───────────────────────────────────────

def make_background(cfg, width, height):
    bg = cfg.get('background', {})
    if bg.get('type') == 'image' and bg.get('imagePath'):
        img = Image.open(bg['imagePath']).convert('RGB')
        iw, ih = img.size
        scale = max(width / iw, height / ih)
        img = img.resize((int(iw * scale), int(ih * scale)), Image.LANCZOS)
        left = (img.width - width) // 2
        top  = (img.height - height) // 2
        img  = img.crop((left, top, left + width, top + height))
        if bg.get('blur', True):
            img = img.filter(ImageFilter.GaussianBlur(radius=bg.get('blurRadius', 20)))
        alpha   = int(bg.get('dimAlpha', 0.4) * 255)
        overlay = Image.new('RGBA', (width, height), (0, 0, 0, alpha))
        img     = img.convert('RGBA')
        img.alpha_composite(overlay)
        return img
    else:
        # 白色系渐变：#f8faff → #eef4ff，从左上到右下
        color1 = parse_color(bg.get('colorFrom', '#f8faff'))
        color2 = parse_color(bg.get('colorTo',   '#eef4ff'))
        base   = Image.new('RGBA', (width, height))
        draw   = ImageDraw.Draw(base)
        for x in range(width):
            t = x / width
            r = int(color1[0] + (color2[0] - color1[0]) * t)
            g = int(color1[1] + (color2[1] - color1[1]) * t)
            b = int(color1[2] + (color2[2] - color1[2]) * t)
            draw.line([(x, 0), (x, height)], fill=(r, g, b, 255))
        return base

# ─── 水印标题（模糊大字，居中）─────────────────────────────────

def draw_watermark(img, title, font_path, width, height):
    if not title:
        return img
    font    = load_font_bold(font_path, 18)
    overlay = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    d       = ImageDraw.Draw(overlay)
    # 左上角，内边距 20px
    d.text((20, 16), title, font=font, fill=(30, 41, 59, 220))
    img = img.copy()
    img.alpha_composite(overlay)
    return img

# ─── 颜色 ────────────────────────────────────────────────────

def parse_color(s):
    s = s.strip()
    if s.startswith('rgba'):
        nums = re.findall(r'[\d.]+', s)
        return (int(nums[0]), int(nums[1]), int(nums[2]), int(float(nums[3]) * 255))
    if s.startswith('rgb('):
        nums = re.findall(r'\d+', s)
        return (int(nums[0]), int(nums[1]), int(nums[2]), 255)
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)

# ─── 字体 ────────────────────────────────────────────────────

def load_font(font_path, size):
    if font_path:
        try:
            return ImageFont.truetype(font_path, size)
        except Exception:
            pass
    # Windows 字体
    for name in ['msyh.ttc', 'simhei.ttf', 'simsun.ttc']:
        p = f'C:/Windows/Fonts/{name}'
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    # Linux 字体 (Noto Sans CJK)
    linux_fonts = [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/arphic/ukai.ttc',  # AR PL UKai
        '/usr/share/fonts/truetype/arphic/uming.ttc', # AR PL UMing
    ]
    for p in linux_fonts:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def load_font_bold(font_path, size):
    # Windows 粗体变体
    for name in ['msyhbd.ttc', 'simhei.ttf', 'msyh.ttc']:
        p = f'C:/Windows/Fonts/{name}'
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    # Linux 字体 (Noto Sans CJK Bold)
    linux_fonts = [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc',
    ]
    for p in linux_fonts:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return load_font(font_path, size)

# ─── 换行 ────────────────────────────────────────────────────

def wrap_text(draw, text, font, max_width):
    lines, current = [], ''
    for char in text:
        test = current + char
        if draw.textbbox((0, 0), test, font=font)[2] > max_width and current:
            lines.append(current)
            current = char
        else:
            current = test
    if current:
        lines.append(current)
    return lines

# ─── slot 高度 ───────────────────────────────────────────────

def calc_slot_height(font_ctx, spacing):
    dummy = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
    bbox  = dummy.textbbox((0, 0), '测试Ag', font=font_ctx)
    return (bbox[3] - bbox[1]) + spacing

# ─── 帧渲染 ──────────────────────────────────────────────────

def render_frame(bg_base, subtitles, current_idx, cfg,
                 font_cur, font_ctx, font_speaker, scroll_offset=0):
    width   = cfg['video']['width']
    height  = cfg['video']['height']
    layout  = cfg.get('layout', {})
    colors  = cfg.get('colors', {})
    spacing = layout.get('lineSpacing', 20)
    max_w   = int(width * 0.80)

    img  = bg_base.copy()
    draw = ImageDraw.Draw(img)

    lines_above = layout.get('linesAbove', 2)
    lines_below = layout.get('linesBelow', 2)

    start_idx = max(0, current_idx - lines_above)
    end_idx   = min(len(subtitles), current_idx + lines_below + 1)
    indices   = list(range(start_idx, end_idx))

    def measure(idx):
        is_cur  = (idx == current_idx)
        font    = font_cur if is_cur else font_ctx
        text    = subtitles[idx][2]
        wrapped = wrap_text(draw, text, font, max_w)
        h = sum(draw.textbbox((0,0), l, font=font)[3] - draw.textbbox((0,0), l, font=font)[1]
                for l in wrapped) + max(0, len(wrapped) - 1) * 6
        if is_cur:
            # 加说话人行高
            sh = draw.textbbox((0,0), 'A', font=font_speaker)[3] + 6
            h += sh
        return font, wrapped, h

    items        = [(idx, *measure(idx)) for idx in indices]
    item_heights = [h for _, _, _, h in items]
    cur_pos      = next(i for i, (idx, *_) in enumerate(items) if idx == current_idx)
    cur_h        = item_heights[cur_pos]

    start_y = height // 2 - cur_h // 2
    for i in range(cur_pos - 1, -1, -1):
        start_y -= (item_heights[i] + spacing)
    start_y += scroll_offset

    color_cur     = parse_color(colors.get('current',  '#2563eb'))
    color_context = parse_color(colors.get('near',     'rgb(100, 116, 139)'))
    color_far     = parse_color(colors.get('far',      'rgb(148, 163, 184)'))
    color_speaker = parse_color(colors.get('speaker',  '#2563eb'))

    y = start_y
    for i, (idx, font, wrapped, h) in enumerate(items):
        dist   = abs(idx - current_idx)
        is_cur = (idx == current_idx)

        if is_cur:
            color = color_cur
            # 说话人小字
            speaker_text = subtitles[idx][3]
            if speaker_text:
                sbbox = draw.textbbox((0, 0), speaker_text, font=font_speaker)
                sw    = sbbox[2] - sbbox[0]
                sh    = sbbox[3] - sbbox[1]
                draw.text(((width - sw) // 2, y), speaker_text,
                          font=font_speaker, fill=color_speaker)
                y += sh + 6
        else:
            color = color_context if dist == 1 else color_far

        for line in wrapped:
            bbox = draw.textbbox((0, 0), line, font=font)
            lw   = bbox[2] - bbox[0]
            lh   = bbox[3] - bbox[1]
            x    = (width - lw) // 2
            if is_cur:
                for ox, oy in [(-1,0),(1,0),(0,-1),(0,1)]:
                    draw.text((x+ox, y+oy), line, font=font, fill=(255,255,255,180))
            draw.text((x, y), line, font=font, fill=color)
            y += lh + 6
        y += spacing - 6

    return img.convert('RGB')

# ─── 当前字幕索引 ─────────────────────────────────────────────

def get_current_idx(subtitles, t):
    for i, (start, end, *_) in enumerate(subtitles):
        if start <= t <= end:
            return i
    for i, (start, end, *_) in enumerate(subtitles):
        if t < start:
            return max(0, i - 1)
    return len(subtitles) - 1

# ─── 音频时长 ─────────────────────────────────────────────────

def get_audio_duration(audio_path, ffmpeg_path='ffmpeg'):
    probe = ffmpeg_path.replace('ffmpeg', 'ffprobe')
    for exe in [probe, 'ffprobe']:
        try:
            r = subprocess.run(
                [exe, '-v', 'error', '-show_entries', 'format=duration',
                 '-of', 'default=noprint_wrappers=1:nokey=1', audio_path],
                capture_output=True, text=True, timeout=30
            )
            if r.returncode == 0:
                return float(r.stdout.strip())
        except Exception:
            continue
    raise RuntimeError('无法获取音频时长，请确认 ffprobe 已安装')

# ─── 主流程 ──────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--audio',  required=True)
    parser.add_argument('--txt',    required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--title',  default='')
    args = parser.parse_args()

    cfg       = json.loads(Path(args.config).read_text(encoding='utf-8'))
    subtitles = parse_txt(args.txt)
    if not subtitles:
        print('ERROR: 字幕解析为空', file=sys.stderr)
        sys.exit(1)

    video_cfg   = cfg.get('video', {})
    width       = video_cfg.get('width',  1280)
    height      = video_cfg.get('height',  720)
    fps         = video_cfg.get('fps',      30)
    font_path   = cfg.get('font', {}).get('path', '')
    ffmpeg_path = cfg.get('ffmpegPath', 'ffmpeg')
    spacing     = cfg.get('layout', {}).get('lineSpacing', 20)

    font_cur     = load_font(font_path, cfg.get('font', {}).get('sizeCurrent', 42))
    font_ctx     = load_font(font_path, cfg.get('font', {}).get('sizeContext',  24))
    font_speaker = load_font(font_path, cfg.get('font', {}).get('sizeSpeaker',  20))

    duration     = get_audio_duration(args.audio, ffmpeg_path)
    total_frames = int(duration * fps)
    print(f'[INFO] 字幕行数: {len(subtitles)}, 时长: {duration:.1f}s, 总帧数: {total_frames}')
    sys.stdout.flush()

    bg_raw  = make_background(cfg, width, height)
    bg_base = draw_watermark(bg_raw, args.title, font_path, width, height)

    slot_height  = calc_slot_height(font_ctx, spacing)
    change_times = [subtitles[i+1][0] for i in range(len(subtitles) - 1)]
    TRANSITION_HALF = 0.15

    frame_cache: dict[int, bytes] = {}
    def get_static_bytes(idx: int) -> bytes:
        if idx not in frame_cache:
            frame_cache[idx] = render_frame(
                bg_base, subtitles, idx, cfg,
                font_cur, font_ctx, font_speaker, scroll_offset=0
            ).tobytes()
        return frame_cache[idx]

    ffmpeg_cmd = [
        ffmpeg_path, '-y',
        '-f', 'rawvideo', '-vcodec', 'rawvideo',
        '-s', f'{width}x{height}', '-pix_fmt', 'rgb24', '-r', str(fps),
        '-i', 'pipe:0',
        '-i', args.audio,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-pix_fmt', 'yuv420p',
        args.output,
    ]
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

    report_interval = fps * 5
    rendered_count  = 0

    for frame_i in range(total_frames):
        t   = frame_i / fps
        idx = get_current_idx(subtitles, t)

        in_transition = False
        for ct in change_times:
            if ct - TRANSITION_HALF <= t < ct:
                progress = (t - (ct - TRANSITION_HALF)) / TRANSITION_HALF
                offset   = -int(progress * slot_height)
                frame    = render_frame(bg_base, subtitles, idx, cfg,
                                        font_cur, font_ctx, font_speaker,
                                        scroll_offset=offset)
                proc.stdin.write(frame.tobytes())
                rendered_count += 1
                in_transition = True
                break

        if not in_transition:
            proc.stdin.write(get_static_bytes(idx))

        if frame_i % report_interval == 0:
            print(f'[进度] {t:.1f}s / {duration:.1f}s ({frame_i/total_frames*100:.1f}%)')
            sys.stdout.flush()

    proc.stdin.close()
    proc.wait()

    print(f'[完成] 实际渲染帧: {len(frame_cache) + rendered_count} / {total_frames}，输出: {args.output}')
    sys.stdout.flush()

    if proc.returncode != 0:
        print('ERROR: FFmpeg 失败', file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
