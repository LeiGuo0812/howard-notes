#R语言 #信号处理 #fNIRS 

想用R绘制小波相干图，要先获取WTC的各种数据。
```matlab
[wcoh,~,F,coi] = wcoherence(x,y,fs,'numscales',16);

%将数据输出到csv

csvwrite('wcoh.csv',wcoh)
csvwrite('F.csv',F)
csvwrite('coi.csv',coi)
```
使用R读取数据，进行作图
```r
# WTC plot ----

#读取数据
wco = read.csv('wcoh.csv', header = F)
freq = read.csv('F.csv', header = F)
ci = read.csv('coi.csv', header = F)
#复制采样率
fs = 11.6279
#复制block开始时间索引
block_starts = c(1,350,2078,2426,4167)/fs

#获取periods
period = 1/(freq[,1] %>% as.vector())
#获取时间
seconds = 1:ncol(wco)/fs

wco %>% 
  mutate(period = period) %>% 
  relocate(period) %>% 
	#转换为长数据
  gather('seconds','wtc',-1) %>% 
  mutate(seconds = str_remove_all(seconds,'V') %>% 
           as.numeric(),
         seconds = seconds / fs) %>% 
	#为美观，只保留periods小于100s的数据
  dplyr::filter(period <= 100) %>% 
  ggplot(aes(x = seconds, y = period)) + 
  geom_tile(aes(fill = wtc)) + 
	#绘制ci
  geom_line(data = ci %>% 
              mutate(seconds = 1:nrow(.)/fs,
                     V1 = 1/V1) %>% 
              dplyr::filter(V1 <= 100 & V1 >= 0.5),
            aes(x = seconds, y = V1),
            color = 'White', 
            linetype = 2) + 
	#绘制block开始指示线
  geom_vline(xintercept = c(block_starts[2], 
                            block_starts[3], 
                            block_starts[4], 
                            block_starts[5]),
             linetype = c(1,1,3,3),
             color = 'white') +
	#翻转y轴、log2转换、去除空白、设置断点
  scale_y_continuous(trans = trans_reverser('log2'),
                     expand = c(0,0),
                     breaks = c(0.5,1,2,4,8,16,32,64)) + 
  scale_x_continuous(expand = c(0,0),
                     breaks = c(50,100,150,200,250,300,350)) + 
  labs(x = 'Seconds (s)',
       y = 'Periods (s)')-> wtc_plot

#展示
wtc_plot

#保存
ggsave('wtc_plot.pdf',wtc_plot,width = 7, height = 5)
```
![image.png](https://cdn.nlark.com/yuque/0/2021/png/1210419/1637858100993-20dba8f2-b7d8-4ed9-aa82-7ea164cbba82.png#clientId=uc8ae70b2-33ad-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=665&id=uc87275bf&margin=%5Bobject%20Object%5D&name=image.png&originHeight=1330&originWidth=1864&originalType=binary&ratio=1&rotation=0&showTitle=false&size=324357&status=done&style=shadow&taskId=ue73f0d26-baff-49bf-9ccb-3c1a74b64a9&title=&width=932)
