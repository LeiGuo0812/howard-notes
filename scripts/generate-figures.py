"""Reproduce the two article figures. Usage: python scripts/generate-figures.py <assets-dir>"""
from pathlib import Path
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.colors import LinearSegmentedColormap

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
x = np.arange(12)
c, f = x.reshape(3, 4, order='C'), x.reshape(3, 4, order='F')
assert np.array_equal(c, x.reshape(3, -1))
assert f.tolist() == [[0, 3, 6, 9], [1, 4, 7, 10], [2, 5, 8, 11]]
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'figure.facecolor': '#f3f7f3'})
cmap = LinearSegmentedColormap.from_list('notes', ['#edf3ed', '#bed8c8'])
fig, axes = plt.subplots(1, 2, figsize=(6, 2.5556))
for ax, values, title in zip(axes, [c, f], ['C order', 'F order']):
    ax.imshow(values, cmap=cmap, vmin=0, vmax=11)
    for (row, col), value in np.ndenumerate(values):
        ax.text(col, row, str(value), ha='center', va='center', color='#254f40', fontsize=13)
    ax.set(xticks=[], yticks=[], title=title)
    ax.set_xticks(np.arange(-.5, 4, 1), minor=True)
    ax.set_yticks(np.arange(-.5, 3, 1), minor=True)
    ax.grid(which='minor', color='#f3f7f3', linewidth=4)
    ax.tick_params(which='minor', bottom=False, left=False)
    for spine in ax.spines.values(): spine.set_visible(False)
fig.tight_layout(pad=1.4)
fig.savefig(out/'reshape-orders.png', dpi=180)
plt.close(fig)

candidates = ['Microsoft YaHei', 'SimHei', 'Noto Sans CJK SC', 'WenQuanYi Zen Hei', 'WenQuanYi Micro Hei']
installed = {font.name for font in font_manager.fontManager.ttflist}
font_name = next((name for name in candidates if name in installed), None)
if font_name is None: raise RuntimeError('Install a Chinese font to generate the font sample.')
plt.rcParams.update({'font.family':'sans-serif', 'font.sans-serif':[font_name, 'DejaVu Sans'], 'axes.unicode_minus':False})
fig, ax = plt.subplots(figsize=(6, 3.6))
ax.plot([-2,-1,0,1,2], [-4,-2,0,2,4], marker='o', color='#286352', linewidth=2)
ax.set(title='中文与负刻度检查', xlabel='输入', ylabel='输出')
ax.grid(alpha=.2)
fig.tight_layout()
fig.savefig(out/'font-check.png', dpi=180)
plt.close(fig)
print(f'Figures saved; NumPy {np.__version__}, Matplotlib {matplotlib.__version__}, font {font_name}')
