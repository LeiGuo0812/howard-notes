---
date created: Saturday, December 21st 2024, 11:11:52 am
date modified: Saturday, December 21st 2024, 11:16:33 am
---
[fatal: unable to access ' https://github.com/xxx ': OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to github.com:443 [duplicate]]( https://stackoverflow.com/questions/49345357/fatal-unable-to-access-https-github-com-xxx-openssl-ssl-connect-ssl-error )

在开了梯子以后，运行 git push 会出现错误：`OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to github.com:443`

原因是电脑上的梯子没有同步到 git 中去

进入系统设置，网络代理部分，查看代理 ip 和端口

```bash
# check proxy now
git config --global http.proxy 
# set proxy with ip and port
git config --global http.proxy proxyaddress:port
# check again
git config --global http.proxy 
# unset current proxy
git config --global --unset http.proxy 
```

设置完成后，应该就可以成功推送了