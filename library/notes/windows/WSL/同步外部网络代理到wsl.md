---
date created: Tuesday, December 10th 2024, 10:26:08 am
date modified: Tuesday, December 10th 2024, 10:27:07 am
---
[wsl: 检测到 localhost 代理配置，但未镜像到 WSL。NAT 模式下的 WSL 不支持 localhost 代理。 · Issue #10753 · microsoft/WSL](https://github.com/microsoft/WSL/issues/10753)

在 `.wslconfig` 中进行如下修改：

```json
[wsl2]
networkingMode=mirrored
dnsTunneling=true
firewall=true
autoProxy=true

[experimental]
# requires dnsTunneling but are also OPTIONAL
bestEffortDnsParsing=true
useWindowsDnsCache=true
```
