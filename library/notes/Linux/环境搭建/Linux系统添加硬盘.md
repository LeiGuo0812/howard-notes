#linux #装机

[Linux格式化并重新加载磁盘\_liunx 磁盘重载题\_yhao浩的博客-CSDN博客](https://blog.csdn.net/yhao2014/article/details/44648199)

windows 系统下硬盘文件系统一般是 NTFS 系统，而 linux 下一般是 ext4，将该硬盘直接放入 linux 电脑上是只读模式。需要重新格式化才能使用。

# 查看磁盘信息

使用 `df -Th` 或 `fdisk -l` 查看磁盘在系统中的位置

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/20230305172815.png)

要格式化磁盘，首先要解除挂载 `umount /dev/sdb`

然后格式化，并建立 ext4 文件系统 `mkfs.ext4 /dev/sdb`

成功后使用 `df -Th` 无法查找到磁盘信息，但用 `fdisk -l` 可以发现文件系统已经建立好

将文件挂载到一个位置，可以在根目录下建立 `data` 文件夹，然后将磁盘挂载上去 `mount /dev/sdb 

此时的挂载是临时挂载，为了开机自动挂载，修改配置文件 `nano /etc/fstab`

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/20230305173349.png)



