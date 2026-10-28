# Fills index.template's slots and writes index.html.
# Needs captures/ (from capture.mjs, with captures/boxes.json) and assets/hero-inline.svg.
import html, json, os, re, subprocess

here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'index.template')).read()
svg = open(os.path.join(here, 'assets/hero-inline.svg')).read()
svg = re.sub(r'<!--.*?-->\s*', '', svg, flags=re.S).replace('<svg ', '<svg id="lockup" ', 1)
boxes = json.load(open(os.path.join(here, 'captures/boxes.json')))

END = 30.5
LOCKUP_START = 27.5

# Highlight rings drawn over the captures, around real elements.
def ring(id_, b, pad=8):
    return (f'<div id="{id_}" class="ring" style="left:{b["x"] - pad:.0f}px;top:{b["y"] - pad:.0f}px;'
            f'width:{b["width"] + 2 * pad:.0f}px;height:{b["height"] + 2 * pad:.0f}px"></div>')
rings = ''.join([ring('r-tags', boxes['tags']), ring('r-presets', boxes['presetCards'], 10), ring('r-files', boxes['attachments'], 6)])

# The instruction "being typed": a cover in the field's own colour over the real text.
# Its colour is sampled from the capture itself (2×), just under the field.
def pixel(png, x, y):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', png, '-vf', f'crop=1:1:{int(x * 2)}:{int(y * 2)}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    return '#%02x%02x%02x' % tuple(raw[:3])
ins = boxes['instruction']
bg = pixel(os.path.join(here, 'captures/compose-ask.png'), ins['x'] + ins['width'] - 4, ins['y'] + ins['height'] + 3)
typing_css = (f'#typing {{ left:{ins["x"]:.0f}px; top:{ins["y"]:.0f}px; width:{ins["width"]:.0f}px; '
              f'height:{ins["height"]:.0f}px; background:{bg}; }}')

themes = sorted(f for f in os.listdir(os.path.join(here, 'captures')) if f.startswith('theme-'))
themes_html = ''.join(f'<div class="th" style="background-image:url(captures/{f})"></div>' for f in themes)

words = lambda s: ''.join(f'<span>{html.escape(w)}</span>' for w in s.split())
ask = words('Archive every newsletter from this week and tell me what needs me today.')
answer = '<span class="ok">✓</span>' + words('14 newsletters archived. Two things need you: the $249 chargeback and Claire’s quote request.')

LABELS = 9
out = (src.replace('__LOCKUP__', svg).replace('__RINGS__', rings).replace('__THEMES__', themes_html)
          .replace('__ASK__', ask).replace('__ANSWER__', answer)
          .replace('__BOXES__', json.dumps(boxes)).replace('__RULER__', '<span><b></b></span>' * LABELS)
          .replace('__LOCKUP_DUR__', f'{END - LOCKUP_START:g}').replace('__END__', f'{END:g}')
          .replace('</style>', typing_css + '\n</style>', 1))
open(os.path.join(here, 'index.html'), 'w').write(out)
