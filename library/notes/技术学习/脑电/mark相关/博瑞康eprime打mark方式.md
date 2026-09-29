---
date created: Friday, March 15th 2024, 12:29:46 pm
date modified: Monday, May 20th 2024, 4:45:42 pm
---
#EEG #行为学 #设备使用 

# inline 语句

通过构建一个数组，并使用 Serial 的 WriteBytes 方法，来实现 mark，语句如下：

```vb
Dim arrData(0 To 4) As Integer
arrData(0)= &H01
arrData(1)= &HE1
arrData(2)= &H01
arrData(3)= &H00
arrData(4)= hex(e.GetAttrib("mark"))

Serial.WriteBytes arrData
```

注意：
- 应在 Device 中正确设置 Serial 端口
- 如果要打不同的 mark，可以在打之前定义不同的数组，以防止变量冲突报错

使用博瑞康 eprime 打标程序时，所有打标相关控件的 preprelease 都要设置成 0，否则标会在 prerelease 完成的时候打！

# Task event
![202403151238452.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202403151238452.png)

