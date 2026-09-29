---
date created: Thursday, March 30th 2023, 11:38:00 pm
date modified: Saturday, July 20th 2024, 4:53:23 pm
---
# Builder 编程
- 如果使用组件定义键盘，并在后续对键盘进行 .getKeys() 等操作时，在组件中要设置 allowed keys 为 'everything', 否则无法识别输入的按键

- [[Psychopy Coder 和 keyboard 顺序问题]] 

- 在对 keyboard 组件中的值判断时，应使用 `keyvalue in resp.keys` 进行判断，因为 `resp.keys` 是一个 list，可能含有多重值。`resp.keys == keyvalue` 这种判断只在 `resp.keys` 中只储存了一个按键时有效。所以前者更加安全。
- 如果使用了麦克风组件 microphone ，请确保组件的采样率和系统麦克风的采样率一致，否则会初始化组件失败报错
# Psychopy Online 实验注意事项

[Home - PsychoJS API](https://psychopy.github.io/psychojs/index.html)

- 在定义键盘和声音 Sound 组件时，要使用 builder 的组件来定义，python 定义的代码无法正确转换为 JS，例如，键盘的定义在 JS 为 `my_keyboard = new core.Keyboard({psychoJS: psychoJS, clock: new util.Clock(), waitForStart: true});` [Failing to use Keyboard in Pavlovia - Online experiments - PsychoPy](https://discourse.psychopy.org/t/failing-to-use-keyboard-in-pavlovia/13702/2)
- 在 Export html 时，要在实验设置的 online 选项卡中，将实验中的所有资源添加到资源列表中（builder 组件中用到的会自动添加，但 code 里定义的不会自动添加），且 output path 留空，不要写 html，这样才能在 JS 代码中正确生成资源路径 [Resources not loaded (resource list is empty) - Builder - PsychoPy](https://discourse.psychopy.org/t/resources-not-loaded-resource-list-is-empty/27793/6)
- 如果要生成线上实验，python code 中的相对路径不用添加 `./` ，因为资源路径中不会带 `./`，写上会报错。
- 线上实验不能使用 numpy 的随机函数，如果需要实现随机，可以对 List 进行 shuffle (如果不想改变原 list，需要进行 copy)。[Pavlovia: How to implement the range function? - Online experiments - PsychoPy](https://discourse.psychopy.org/t/pavlovia-how-to-implement-the-range-function/18540/5)
- Javascript 中 list 对象没有 `.remove()` 或 `.copy()` 方法，可以通过手动定义变量的方法实现
- PsychoJs 中，声音刺激的 `.setSound()` 方法要求传入一个 sound 对象以修改原对象。可以通过在 JS 代码中创建一个 sound 新对象来实现（可通过生成.js 文件参考写法）

---

线上实验无法使用 Pandas 和 Numpy 库

在线实验注意：需要在此处添加额外资源
![|575](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221120101821.png)


在线实验设置 RGB 需要使用 `$` 和 `[]` 语法
![|575](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221120102445.png)


关于条件文件：
确保只有用到的单元格里有内容，其他地方不要有，尤其注意空格等。


```ad-warning
title: Warning code组件的顺序
在一个routine中，各个组件的定义是有顺序的，从上到下。因此如果要调用code并在code使用组件，需要**先定义再调用**，否则会报错。
```


```ad-warning
title: Warning Before Experiment code
code中的 `Before Experiment` 中如果没有特别要求，不要填写
```


# 随机化 block
[Block randomisation - Builder - PsychoPy](https://discourse.psychopy.org/t/block-randomisation/22974)

添加随机外循环控制 nReps


# 关于图片等组件在循环中变化

如果图片等组件在不同试次中，图片路径有变化，则除了设置路径为 `$path` 以外，还需要把模式设置为 `set every repeat`，这样在程序初始定义图片等组件时，会自动设置默认图片路径，而不需要手动设置。如果设置为 `constant`，则需要在路径中选择一张图片，并使用 coder 组件手动设置每个trial 的图片路径。

# psychopy 中的回车

psychopy 中回车键的表示为 `return`

# Psychopy Coder 和 keyboard 顺序问题

## 1.不做反应是正确答案时，Coder 和 Keyboard 的上下位置关系影响结果

- psychopy 组间中，不做反应为正确答案的写法为 `none`

某些实验中，**如果不做反应是正确答案（如 SST）**，则在**带有 keyboard** 的试次 Routine 中，**加入 Coder 组件**，并在 **End Routine 部分** 通过对 keyboard 的结果（如 corr, rt 等）进行一些操作，应当注意，此时**keyboard 组件和 Coder 组件的相对位置会影响 keyboard 中属性的值（主要是 corr）**

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202308132223603.png)

因为 keyboard 默认不做反应的 corr 是 0，但会在**试次结束**后，**对正确答案进行校正**：

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202308132251555.png)

如果 keyboard component 放到了 Coder 的后面，则先执行 Coder 中 End Routine 中的部分，再进行无反应为正确答案的校正，这时就会导致 **Coder 中获取到的 corr 属性是校正前的值，也就是错误的**。
且会影响到下一个试次，因为下一个试次 Coder 获取到的是上一个试次校正后的结果。

正确的做法是当存在无反应作为正确答案时，应注意将 Coder 放到 Keyboard 组件后面，以防止获取到的 keyboard 属性错误

# ‘SoundPTB’ object has no attribute ‘isFinished’报错问题解决

['SoundPTB' object has no attribute 'isFinished' - Builder - PsychoPy](https://discourse.psychopy.org/t/soundptb-object-has-no-attribute-isfinished/35293)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309201642916.png)

将存在 sound 的任务 psychopy 版本在设置中更换为 2022.2.5 版本

[How do I run experiments written with older versions of PsychoPy®? — PsychoPy v2023.1.2](https://psychopy.org/faqs/versionControl.html)

[Best practices for using multiple PsychoPy versions on one computer - Coding - PsychoPy](https://discourse.psychopy.org/t/best-practices-for-using-multiple-psychopy-versions-on-one-computer/10749)

2023.2.2 已解决该问题

# Psychopy 24 版本以后 sound 组件设置 set every repeat 之后异常播放

24 年以后的版本创建 sound 组间的时候无法设置是否为 constant 还是 set every repeat，实际播放的时候，声音播放速度变快，音质被压缩

如果需要在每个试次中变动播放的文件，则可以使用 23 年的版本，并将播放设置为 constant，播放文件改为变量，如 `$sound`，并在研究开始的时候，将任意一个文件的路径赋值给 `sound`，这样声音播放正常。目前原因不明