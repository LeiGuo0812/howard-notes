#linux #编程

# 快速拷贝

利用 `tar` 命令

```bash
tar cvf – /home/src_dir | tar xvf – -C /opt
```

第一个目录为需要复制的目录或文件，第二个目录为要复制到的目标文件夹。如果不想在控制台输出 log，取消参数中的 `v` 即可

效果 good！

# 快速删除

利用 `rsync` 命令

## 删除目录
```bash
# 先创建一个空目录
touch /data/blank

# 利用空文件删除目标目录
rsync –delete-before -d /data/blank/ /var/spool/clientmqueue/

```
注意目录后的 `/`

## 删除大文件
```bash
# 先创建一个空文件
touch /data/blank.txt

# 利用空文件删除大文件
rsync -a –delete-before –progress –stats /root/blank.txt /root/nohup.out
```

初步测试无效...