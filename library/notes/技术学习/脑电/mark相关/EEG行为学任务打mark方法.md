#行为学 #EEG 
# 1. E-prime

## 1.1 并口
![E-Pri57e 心仪科技 E-Prime专题(全)_手把手教你做实验_20200416-0514 - E-Prime脑电实验程序_0430 @34-34.42 1629723465989.png](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629723490218-295e2a7d-e512-4355-81a1-e2c984a24351.png#clientId=u9beff12e-faca-4&from=paste&height=540&id=udba71444&originHeight=1080&originWidth=1920&originalType=binary&ratio=1&rotation=0&showTitle=false&size=958654&status=done&style=none&taskId=u905f2f74-c2ff-4874-90ba-fc429ec9809&title=&width=960) 

![E-Pri58e 心仪科技 E-Prime专题(全)_手把手教你做实验_20200416-0514 - E-Prime脑电实验程序_0430 @35-52.57 1629723529813.png](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629723554770-251692c0-1e9e-448b-8356-f89cf586d23f.png#clientId=u9beff12e-faca-4&from=paste&height=540&id=ua8d9fa81&originHeight=1080&originWidth=1920&originalType=binary&ratio=1&rotation=0&showTitle=false&size=593384&status=done&style=none&taskId=uade8490b-d4c1-4807-8199-2847fe8569a&title=&width=960)
<a name="et 2 go"></a>
## 1.2 串口
![E-Pri00e 心仪科技 E-Prime专题(全)_手把手教你做实验_20200416-0514 - E-Prime脑电实验程序_0430 @38-34.85 1629723621324.png](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629723634351-82beeddc-58d6-41a1-a3d9-871064bdf31f.png#clientId=u9beff12e-faca-4&from=paste&height=540&id=ud3d42033&originHeight=1080&originWidth=1920&originalType=binary&ratio=1&rotation=0&showTitle=false&size=1008812&status=done&style=none&taskId=u201b7c06-69d8-4f94-a19f-950db7b998a&title=&width=960)

![E-Pri01e 心仪科技 E-Prime专题(全)_手把手教你做实验_20200416-0514 - E-Prime脑电实验程序_0430 @40-10.65 1629723717651.png](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629723731963-9e24186c-4617-4f42-9fcf-c2c074cf228a.png#clientId=u9beff12e-faca-4&from=paste&height=540&id=uca4ef4e6&originHeight=1080&originWidth=1920&originalType=binary&ratio=1&rotation=0&showTitle=false&size=628008&status=done&style=none&taskId=ufcf93abc-c810-4acf-b8e3-34f540f380d&title=&width=960)


# 2. Matlab
<a name="yOl 3 d"></a>
## 2.1 并口
[trigger.zip](https://www.yuque.com/attachments/yuque/0/2021/zip/1210419/1629984435977-1c413990-c25a-4346-883c-beeae3ae45c1.zip?_lake_card=%7B%22src%22%3A%22https%3A%2F%2Fwww.yuque.com%2Fattachments%2Fyuque%2F0%2F2021%2Fzip%2F1210419%2F1629984435977-1c413990-c25a-4346-883c-beeae3ae45c1.zip%22%2C%22name%22%3A%22trigger.zip%22%2C%22size%22%3A50432%2C%22type%22%3A%22application%2Fx-zip-compressed%22%2C%22ext%22%3A%22zip%22%2C%22source%22%3A%22%22%2C%22status%22%3A%22done%22%2C%22mode%22%3A%22title%22%2C%22download%22%3Atrue%2C%22taskId%22%3A%22uccd918ac-048a-4e78-ba76-606f00585fd%22%2C%22taskType%22%3A%22transfer%22%2C%22id%22%3A%22u0108b9fc%22%2C%22card%22%3A%22file%22%7D)

- 下载 trigger.zip 解压
- 将 trigger 添加到 matlab 路径
- 将 inpoutx 64.dll 复制到 C:\windows\system 32 下
- 需要安装 Microsoft Visual C++ 2005 SP 1 Redistributable (x 64) 使用

[Psychtoolbox脑电打mark - 知乎](https://zhuanlan.zhihu.com/p/242763931)

[EEG实验中Matlab并口数据位发送和接收的实现方法 - 知乎](https://zhuanlan.zhihu.com/p/84134816)

```matlab
%% 端口测试

address = hex2dec('378'); %并口地址
config_io;
global cogent;
if( cogent.io.status ~= 0 )
   error('inp/outp installation failed');
end
outp(address,0);

for i = 1:100
outp(address,i);% mark 值
WaitSecs(0.004);
outp(address,0);
end
```

## 2.2 串口

[Matlab下调用USB串口发送trigger信号\_孺鱼的博客-CSDN博客](https://blog.csdn.net/u013211539/article/details/70933051)

```matlab
%定义一个端口
scom = serial('COM2', 'BaudRate',115200,'Parity','none','DataBits',8,'StopBits',1);
%打开端口
fopen(scom);
%写入字符串、数字均可
fprintf(scom,'mh%s0',num2str(21))
%延迟25ms
WaitSecs(0.025)
%端口清零
fprintf(scom,'mh00')
%关闭端口
fclose(scom)
```

# 3. Python

## 3.1 并口
基于 psychopy 打 mark
```python
from psychopy import parallel
import time

port = parallel.ParallelPort(address="0xC010")
port.setData(3) # sets just pin 2, 3 high
time.sleep(0.001)
port.setData(0) 
```

## 3.2 串口
```matlab
import serial
import time

test = serial.Serial('COM8',baudrate=115200)

test.write(b'mh10') #发送字符串
time.sleep(0.001)
test.write(b'mh00')

test.close()
```