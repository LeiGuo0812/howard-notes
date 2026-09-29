#Conda

[请问大神们，pip install 和conda install有什么区别吗？ - 知乎](https://www.zhihu.com/question/395145313)

- conda 安装会严格审查版本冲突，但不会检测 pip 安装的包
- pip 会检测 conda 安装的包，但冲突审查不严格

```ad-note
因此能用 conda 安装的包尽量用 conda 安装，其余 conda 上没有的再用 pip

可以使用 mamba 软件，速度快非常多 （注意下载 Mambaforge，Miniforge并不被官方推荐，同时会有许多库缺失问题）

安装顺序上，先使用 mamba/conda 安装，再安装只有 pip 中有的库
```

能够使用 mamba/conda 安装的库：
- numpy 
- pandas 
- scipy 
- matplotlib 
- seaborn 
- statsmodels 
- plotly
- spyder
- mne
- nibabel
- nilearn
- dipy
- pip
- vtk
- networkx

需要使用 pip 安装的库：
- brainspace
- surfplot
- abagen
- neuroCombat
- templateflow

目前只能本地安装的库：
- neuromaps
- enigmatoolbox

注意，需要同时安装 connectome workbench 才能使用 neuromaps 的全部功能，尤其是 transforms 中的函数！