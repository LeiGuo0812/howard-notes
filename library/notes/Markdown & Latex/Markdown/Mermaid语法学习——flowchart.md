#Markdown #可视化 #Mermaid
# 1. Mermaid的flowchart 定义
1. 先用flowchart声明图形类型，然后指明图形方向

**flowchart** LR

2. mermaid的语句后面的`;`可加可不加
3. 关于空格：
   1. 顶点和连边之间允许有一个空格
   2. 顶点内容和连边文字在书写时，文字和顶点或连边之间不能有空格
   3. 连边上的文字和顶点之间可以有空格

A[Hard edge] **-->**|Link text| B(Round edge)
<a name="p6lxc"></a>
# 2. 定义节点
**节点ID[节点内容]**

- 中括号及其内容**可以省略，此时ID作为节点内容**
- 节点间的指向关系使用**节点ID定义**
- 节点ID**不能**使用空格等特殊符号
- 节点内容**可以**输入空格等特殊符号
- 如果节点内容里需要放入关键字，可以用**双引号** `""` 引起来
> **flowchart** LR<br />    id1["This is the (text) in the box"]

- 节点内容两边的中括号可以改变，以修改默认的文字框形状

```
flowchart LR
    id1[This is the text in the box]
```

Mermaid 支持10种文本框形状：

1. `[]`：方形 ![image.png|175](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644123574757-5f6b9f48-3d70-49ec-b1c6-99ccd87eb58f.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=24&id=ufbdb0d79&margin=%5Bobject%20Object%5D&name=image.png&originHeight=86&originWidth=387&originalType=binary&ratio=1&rotation=0&showTitle=false&size=6894&status=done&style=none&taskId=ufffa84f6-9aae-4e7e-b638-b5c1423c616&title=&width=106.7106704711914)

2. `()`：圆角矩形  ![image.png|175](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644123640968-f0bd90d5-90c8-462a-9e2e-4c882088f040.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=25&id=u923897d5&margin=%5Bobject%20Object%5D&name=image.png&originHeight=79&originWidth=378&originalType=binary&ratio=1&rotation=0&showTitle=false&size=7517&status=done&style=none&taskId=ued129e5d-3607-41e8-a7fa-dd354b954d1&title=&width=119.86515808105469)
3. `([])`：体育场形 ![image.png|175](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644123688460-3771de44-2dc5-4639-9e85-a6874d7f5fd8.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=27&id=ue7b3f09d&margin=%5Bobject%20Object%5D&name=image.png&originHeight=82&originWidth=393&originalType=binary&ratio=1&rotation=0&showTitle=false&size=8283&status=done&style=none&taskId=u7959804f-dc6a-4e36-8392-9cd59df2317&title=&width=130.95504760742188)
4. `[[]]`：子程序形 ![image.png|200](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644123788065-a676e73c-ca91-4c3e-8206-755a7e344132.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=23&id=u1e65c071&margin=%5Bobject%20Object%5D&name=image.png&originHeight=86&originWidth=412&originalType=binary&ratio=1&rotation=0&showTitle=false&size=6470&status=done&style=none&taskId=u4931dc23-90be-4054-857a-ae3b13e7d40&title=&width=112.19662475585938)
5. `[()]`：圆柱形 ![image.png|75](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124504152-4045b830-6889-4650-811d-3f0fe927ad06.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=45&id=ub1b06124&margin=%5Bobject%20Object%5D&name=image.png&originHeight=139&originWidth=169&originalType=binary&ratio=1&rotation=0&showTitle=false&size=7583&status=done&style=none&taskId=uff91f6cc-2b44-4bdc-9049-3b929101866&title=&width=54.14606475830078)
6. `(())`：圆形 ![image.png|100](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124541109-dc1a112d-78e4-4652-8d25-630661470c2d.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=83&id=u13df8740&margin=%5Bobject%20Object%5D&name=image.png&originHeight=399&originWidth=407&originalType=binary&ratio=1&rotation=0&showTitle=false&size=20714&status=done&style=none&taskId=u7b4340bd-ea5b-457e-90bf-52281b839fa&title=&width=84.505615234375)
7. `>]`：旗帜形（目前不支持反向）![image.png|200](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124628931-5dd7aba4-22ee-4081-b7ab-5d238329fb0d.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=28&id=ufefc790f&margin=%5Bobject%20Object%5D&name=image.png&originHeight=88&originWidth=419&originalType=binary&ratio=1&rotation=0&showTitle=false&size=7345&status=done&style=none&taskId=ue61080b7-109d-4183-9087-cdd0f05e18b&title=&width=130.97752380371094)
8. `{}`：菱形 ![image.png|125](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124661347-a60b3396-576f-4509-83f4-abfcf3242870.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=74&id=u971bd356&margin=%5Bobject%20Object%5D&name=image.png&originHeight=458&originWidth=456&originalType=binary&ratio=1&rotation=0&showTitle=false&size=19246&status=done&style=none&taskId=u0c240298-c3f6-43f0-bb61-97357394286&title=&width=73.93258666992188)
9. `{{}}`：六边形 ![image.png|250](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124704439-7e04caff-3931-46d0-a12b-74660cbcbc66.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=30&id=u91da5620&margin=%5Bobject%20Object%5D&name=image.png&originHeight=91&originWidth=410&originalType=binary&ratio=1&rotation=0&showTitle=false&size=7453&status=done&style=none&taskId=u79013979-f116-4d18-9d6d-d650c55cf11&title=&width=137.12359619140625)
10. 梯形类：
   1. `[//]`：平行四边形 ![image.png|250](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124776277-db3c1375-b7da-4a8a-a8a2-0fd48a41901c.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=22&id=uaf711c13&margin=%5Bobject%20Object%5D&name=image.png&originHeight=85&originWidth=427&originalType=binary&ratio=1&rotation=0&showTitle=false&size=7786&status=done&style=none&taskId=ucf11829d-a40a-40af-b3c2-2a50b5fd764&title=&width=111.29212951660156)
   2. `[\\]`：反平行四边形 ![image.png|225](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124814860-edc424b4-d78a-4fbb-8456-c5fab873d83d.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=25&id=u36b3b809&margin=%5Bobject%20Object%5D&name=image.png&originHeight=87&originWidth=402&originalType=binary&ratio=1&rotation=0&showTitle=false&size=8008&status=done&style=none&taskId=u2aa52b2f-932e-45c1-a6c4-de7cae60b63&title=&width=113.80618286132812)
   3. `[/\]`：梯形 ![image.png|150](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124857970-1c5e3518-ea85-4f5f-a29f-161c0de91693.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=26&id=u1d635d8a&margin=%5Bobject%20Object%5D&name=image.png&originHeight=81&originWidth=225&originalType=binary&ratio=1&rotation=0&showTitle=false&size=4443&status=done&style=none&taskId=ue670b2b9-de8d-47e4-99b5-5d0b3392a93&title=&width=73.34831237792969)
   4. `[\/]`:反梯形 ![image.png|150](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644124879800-7655d61a-38a8-4dae-a236-2417e5c2370e.png#clientId=u8a9745f1-004b-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=25&id=u299eeb9d&margin=%5Bobject%20Object%5D&name=image.png&originHeight=80&originWidth=261&originalType=binary&ratio=1&rotation=0&showTitle=false&size=5387&status=done&style=none&taskId=ub80b69b8-bd7c-4379-bfa1-f247fbb5ff8&title=&width=81.7584228515625)

# 3. 定义连边
<a name="U7gKS"></a>
## 3.1 连边的种类和长度
| **Length** | **1** | **2** | **3** |
| --- | --- | --- | --- |
| Normal | --- | ---- | ----- |
| Normal with arrow | --> | ---> | ----> |
| Thick | === | ==== | ===== |
| Thick with arrow | ==> | ===> | ====> |
| Dotted | -.- | -..- | -...- |
| Dotted with arrow | -.-> | -..-> | -...-> |

其他特殊种类：

**flowchart** LR
A **--o** B
B **--x** C

![image.png|275](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644127897324-89f10955-64c4-40ad-97ec-8b560baf2fc4.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=53&id=u547b85dc&margin=%5Bobject%20Object%5D&name=image.png&originHeight=98&originWidth=389&originalType=binary&ratio=1&rotation=0&showTitle=false&size=3370&status=done&style=none&taskId=u7a84be74-d99b-462c-9d68-5c292e27a4a&title=&width=209.79775730514007)

在连边的两边加上箭头，即可实现双箭头

**flowchart** LR
A **o--o** B
B **<-->** C
C **x--x** D

![image.png|325](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644128025756-e4749b87-c050-455a-b381-ccc4303691a2.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=56&id=u06d1a34b&margin=%5Bobject%20Object%5D&name=image.png&originHeight=103&originWidth=542&originalType=binary&ratio=1&rotation=0&showTitle=false&size=4905&status=done&style=none&taskId=u7a2b5b51-4cfc-4a41-966b-69311ef28b6&title=&width=292.31461300613347)
<a name="NMKCy"></a>
## 3.2 连边上的文字

1. 普通连边：

**flowchart** LR

A **--** This is the text! **---** B

或者使用

**flowchart** LR
A---**|This is the text|** B

> **注意！如果要指定连边长度：**
> A-- This is the text! ---B 模式下只有文字**右边**短线的长度起作用
> A---|This is the text|B 模式则是**左边**的短线起作用
> 
> 连边上的文字不影响连边的箭头
> **flowchart** LR
> A -- text --> B
> 或者
> **flowchart** LR
>  A -->|text|B

2. 点线：

**flowchart** LR
A **-.** text **.->** B
或
**flowchart** LR
A **-.** **->**|text|  B

3. 粗线

**flowchart** LR
A \=\= text \=\=> B
或
**flowchart** LR
A **\=\=>** |text| B

线段长度同理

<a name="XBG29"></a>
## 3.3线段长度控制的例子
**flowchart** TD
A[Start] **-->** B{Is it?}**;**
B **--** Yes **-->** C[OK]**;**
C **-->** D[Rethink]**;**
D **-->** B;
B **--** No **----**> E[End]**;**

![image.png](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644128648910-13b2d854-9bbf-41a3-9987-a565d447cc32.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=517&id=u56354adc&margin=%5Bobject%20Object%5D&name=image.png&originHeight=959&originWidth=311&originalType=binary&ratio=1&rotation=0&showTitle=false&size=24055&status=done&style=none&taskId=u65708d40-b5d2-4c96-972b-5fe7f5ab303&title=&width=167.73034067326108)
<a name="WhjW3"></a>
# 4. 流程图布局
<a name="bM5OF"></a>
## 4.1 连边的连接
**flowchart** LR
A **--** text **-->** B **--** text2 **-->** C
![image.png](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644128741512-4c61764e-57f3-41e4-986b-58e0bfe7c7d7.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=51&id=uc2cff6bf&margin=%5Bobject%20Object%5D&name=image.png&originHeight=95&originWidth=500&originalType=binary&ratio=1&rotation=0&showTitle=false&size=6551&status=done&style=none&taskId=u06b1e154-258e-4f67-b3bb-47d0c7e30fd&title=&width=269.6629271274294)

使用`&`来组合多个节点，简化代码
**flowchart** LR
a **-->** b **&** c **-->** d

![image.png|325](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644128844378-c759762b-aa15-4b69-8ae3-9d83bcc4e4da.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=150&id=u0cce32fb&margin=%5Bobject%20Object%5D&name=image.png&originHeight=278&originWidth=377&originalType=binary&ratio=1&rotation=0&showTitle=false&size=9124&status=done&style=none&taskId=u76ede402-e291-4e58-bd80-2aa5451ee5e&title=&width=203.32584705408175)

**flowchart** TB
A **&** B **-->** C **&** D

![image.png](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644128867777-2f076eca-344b-4667-aba4-2c2cc5cf5711.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=147&id=u331155a3&margin=%5Bobject%20Object%5D&name=image.png&originHeight=273&originWidth=280&originalType=binary&ratio=1&rotation=0&showTitle=false&size=8695&status=done&style=none&taskId=uf9cb7a0e-f4cb-4dfa-bc8a-b2c3b0aec96&title=&width=151.01123919136046)
<a name="uRKXp"></a>
# 5.子图
<a name="RGOmq"></a>
## 5.1 子图的基础语法
```
subgraph ID[title]
		direction LR
    A --> B
end
```

1. 子图可以用 ID[title] 定义子图的ID和标题， [title]可以省略，此时ID作为标题
2. 子图可以用`direction`关键字定义子图的方向
3. 子图需要用`end`结束
4. 子图之间、子图和节点之间也可以用连边连接

**flowchart** TB
c1 **-->** a2
**subgraph** one
a1 **-->** a2
**end**
**subgraph** two
b1 **-->** b2
**end**
**subgraph** three
c1 **-->** c2
**end**

![image.png|500](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644129708921-a67629de-be65-4bbe-af85-6e2e29b15ecc.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=271&id=u68dfb5cf&margin=%5Bobject%20Object%5D&name=image.png&originHeight=502&originWidth=920&originalType=binary&ratio=1&rotation=0&showTitle=false&size=22404&status=done&style=none&taskId=u4ebc2580-7920-43f0-a454-64fe05f90f2&title=&width=496.1797859144701)


**flowchart** TB
c1 **-->** a2
**subgraph** one
a1 **-->** a2
**end**
**subgraph** two
b1 **-->** b2
**end**
**subgraph** three
c1 **-->** c2
**end**
one **-->** two
three **-->** two
two **-->** c2

![image.png|475](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644129742267-38bb90e1-fd6b-478d-bf1b-db8a46e788d5.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=366&id=ua9f4ecb7&margin=%5Bobject%20Object%5D&name=image.png&originHeight=678&originWidth=535&originalType=binary&ratio=1&rotation=0&showTitle=false&size=22957&status=done&style=none&taskId=u7f5080b9-eec3-40f6-88c3-6d719b73594&title=&width=288.5393320263494)

<a name="xWcH4"></a>
# 6.图的交互

- 在图形的下方可以定义节点的点击事件，以起到交互效果
- 点击可以触发打开链接或使用回调函数，以节点ID作为参数
- 回调函数是**在其他函数中作为参数**的函数。具体介绍可参考

[https://www.bilibili.com/video/BV1vL411t78b?from=search&seid=14612999908557990555&spm_id_from=333.337.0.0](https://www.bilibili.com/video/BV1vL411t78b?from=search&seid=14612999908557990555&spm_id_from=333.337.0.0)
```
click nodeId callback
click nodeId call callback()
```
注意：

- nodeId 是节点的ID
- callback 是在显示图形的页面上定义的 javascript 函数的名称，该函数将以 nodeId 作为参数被调用。

重点掌握如何关联一个链接

**flowchart** LR;
A **-->** B;
B **-->** C;
C **-->** D;
D **-->** E; 
click A "[http://www.github.com](http://www.github.com/)" \_blank
click B "http://www.github.com" "Open this in a new tab" \_blank
click C href "http://www.github.com" \_blank
click D href "http://www.github.com" "Open this in a new tab" \_blank

![image.png](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644130994598-f4793694-caed-47ab-85b7-630b0fa3ffd0.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=58&id=ud660abfc&margin=%5Bobject%20Object%5D&name=image.png&originHeight=107&originWidth=679&originalType=binary&ratio=1&rotation=0&showTitle=false&size=4414&status=done&style=none&taskId=ud1fd68fa-78cc-46e7-8ef8-e7d436d769c&title=&width=366.20225503904913)

<a name="SYRDE"></a>
# 7.注释
在mermaid中，使用`%%`作为注释符号，所有在注释符号后的字符串均不运行<br />注释一般同行，另起一行需要再添加`%%`

# 8.自定义节点样式
<a name="N0Dw3"></a>
## 8.1 逐个定义
**flowchart** LR
id1(Start) **-->** id2(Stop)
style id1 fill:#f9f,stroke:#333,stroke-width:4px
style id2 fill:#bbf,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

![image.png](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644131119860-5bfd2c83-87b7-4729-af25-3daba7ad5226.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=57&id=u8696d2b5&margin=%5Bobject%20Object%5D&name=image.png&originHeight=105&originWidth=326&originalType=binary&ratio=1&rotation=0&showTitle=false&size=5848&status=done&style=none&taskId=ud7fc383d-2134-43ff-9868-91a3348d2e1&title=&width=175.82022848708397)

1. 使用 `style nodeID`语句定义节点样式
2. 关键字：
   1. `fill`：填充颜色
   2. `stroke`：边框颜色
   3. `stroke-width`：边框粗细
   4. `color`：字体颜色
   5. `stroke-dasharray`：虚线边框的线和空隙的长度（2个数字）

<a name="JlaQ6"></a>
## 8.2预设样式后定义
```
    classDef className fill:#f9f,stroke:#333,stroke-width:4px;
```
使用`classDef`语句定义一个名为 `className`的样式

```
    class nodeId1 className;
```
对节点 nodeID1 应用 className 样式

也可以对多个节点应用同一个样式
```
    class nodeId1,nodeId2 className;
```
<a name="fs7Sz"></a>
## 8.3 使用`:::`定义样式

**flowchart** LR
A **:::** someclass **-->** B
classDef someclass fill:#f96;
![image.png|100](https://cdn.nlark.com/yuque/0/2022/png/1210419/1644131558533-24b2b667-4a21-4cf1-ab35-07fcd22c7b1d.png#clientId=u077bb806-ba0e-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=54&id=ue4befd34&margin=%5Bobject%20Object%5D&name=image.png&originHeight=100&originWidth=242&originalType=binary&ratio=1&rotation=0&showTitle=false&size=2051&status=done&style=none&taskId=uaeb13f16-0e6a-45ee-b21b-293d037fc45&title=&width=130.51685672967582)<br />`:::`应该放到整个nodeID[text]之后

<a name="EY3I1"></a>
## 8.4 定义默认样式

```
 classDef default fill:#f9f,stroke:#333,stroke-width:4px;
```
将样式的名字定义为`default`，即可将样式应用于所有节点


<a name="xD1MF"></a>
# 9. 对fontawesome的支持

**flowchart** TD
B["fa:fa-twitter for peace"]
B **-->** C[fa:fa-ban forbidden]
B **-->** D(fa:fa-spinner);
B **-->** E(A fa:fa-camera-retro perhaps?);

使用`fa:#icon class name#`来定义fontawesome
