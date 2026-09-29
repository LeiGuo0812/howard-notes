[# Ubuntu 22.04 安装 NVIDIA 驱动并使用 PyTorch 和 PyG](https://zhuanlan.zhihu.com/p/634250809)
[Window11 使用WSL2 Ubuntu RTX 5070 GPU 踩过的坑-腾讯云开发者社区-腾讯云](https://cloud.tencent.com/developer/article/2640952)

1. 检查 `nvcc` 是“找不到”还是“版本报错”

在 WSL 终端输入：  
`nvcc --version`

情况 A：提示 `command not found` (命令找不到)

这是因为系统不知道 `nvcc` 在哪里，需要手动配置环境变量。 [[1](https://blog.csdn.net/Sakuya__/article/details/141254961), [2](https://comate.baidu.com/zh/page/02200vemaj7)]

1. 打开并编辑环境配置文件：
    
    bash
    
    ```
    nano ~/.bashrc
    ```
    
    Use code with caution.
    
2. 将以下两行代码粘贴到文件的最末尾：
    
    bash
    
    ```
    export PATH=/usr/local/cuda/bin:$PATH
    export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
    ```
    
    Use code with caution.
    
3. 按 `Ctrl + O` 保存，按 `Enter` 确认，再按 `Ctrl + X` 退出。
4. 刷新环境变量：
    
    bash
    
    ```
    source ~/.bashrc
    ```
    
    Use code with caution.
    
5. 再次运行 `nvcc --version` 验证