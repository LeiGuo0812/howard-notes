[CUDA Toolkit Archive \| NVIDIA Developer](https://developer.nvidia.com/cuda-toolkit-archive)
https://developer.nvidia.com/cudnn-archive

于 2022-07-18 14:17 :36 首次发布

安装CUDA
------

### 驱动适配

首先要查看服务器中显卡驱动支持的最大[cuda版本](https://so.csdn.net/so/search?q=cuda%E7%89%88%E6%9C%AC&spm=1001.2101.3001.7020)。  
在服务器中输入：`nvidia-smi`，得到如下版本信息。  
![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/4e47cc2fb0b7abc92b14b67604e881c9.png)
  
第一行可以看到，最大支持cuda 11.6。

### 安装包下载

在[cuda官网](https://developer.nvidia.cn/cuda-toolkit-archive)选择合适的版本  
![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/9c9261dd7759ca809bb058a400cda4cd.png)
  
根据如图选择配置。  
![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/f8b36c14ce94dc4e3ad25342080604ee.png)
  
安装成功会出现安装路径。  
![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/04f42502e1454c24eb8a00fc9f4e78a6.png)

### 配置环境变量

打开配置文件

```sh
sudo micro ~/.bashrc
```

在配置文件末尾加上（注意这里的`/usr/local/cuda-11.5`路径和上面安装截图里面的路径一直）

```sh
export PATH=//usr/local/cuda-11.5/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda-11.5/lib64:$LD_LIBRARY_PATH
```

source一下配置文件

```sh
source /etc/profile
```

检查是否安装完成  
使用`nvcc -V`检查CUDA是否安装成功，出现一下提示代表安装成功。  
![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/5247414079deef5eda64ac732604259a.png)
  
编译并执行CUDA样例程序，出现pass代表CUDA和GPU运行正常。

```sh
cd /usr/local/cuda-11.5/samples/1_Utilities/deviceQuery
sudo make
./deviceQuery 
```

![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/34e7c3535901a358946d4c23b239dcfd.png)

安装cuDNN
-------

到 [官网](https://developer.nvidia.com/rdp/cudnn-archive#a-collapse805-111)下载与CUDA匹配的  
![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/b7df412c6fb3a2ae04b8afd3b0afe0ef.png)
  
我是在本地下载好了后，上传到服务器首目录下，然后解压。  
![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/0ba7597823602fb5043a011c4d18ccc7.png)
  
解压cuDNN文件，并进入解压出来的文件，拷贝文件到`/usr/local/cuda-11.5`中

```sh
tar -xvf cudnn-linux-x86_64-8.4.0.27_cuda11.6-archive.tar.xz
cd cudnn-linux-x86_64-8.4.0.27_cuda11.6-archive
sudo cp lib/* /usr/local/cuda-11.5/lib64/
sudo cp include/* /usr/local/cuda-11.5/include/
sudo chmod a+r /usr/local/cuda-11.5/lib64/*
sudo chmod a+r /usr/local/cuda-11.5/include/*
```

查看cuDNN版本，`cat /usr/local/cuda/include/cudnn_version.h | grep CUDNN_MAJOR -A 2`  
![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/e15d738f4bd24ef27f8d5892349e107f.png)