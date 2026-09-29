---
date created: Tuesday, November 28th 2023, 10:39:45 am
date modified: Wednesday, November 29th 2023, 11:40:29 am
---
#Python #编程

参考阅读：
[详解Python多线程、多进程](http://mp.weixin.qq.com/s?__biz=MzA4MjEyNTA5Mw==&mid=2652601370&idx=1&sn=bfb71a27140c5a2320f0e5fec77fb502&chksm=84655450b312dd464e01f914d0052f21afba1c8cdbc0538ae1e19196e21613e345431e688b89&mpshare=1&scene=24&srcid=112992gQDBjiFXkE1b9W0OQW&sharer_shareinfo=0ee4590513b9440a56a67460afe79d4a&sharer_shareinfo_first=0ee4590513b9440a56a67460afe79d4a#rd)

并行运算分为几种：

- 基于线程：I/O 密集型任务
- 基于进程：CPU 密集型任务
- 异步编程：I/O 密集型和高延迟任务

# 不同并行运算的概念和特点
## 基于线程（Threading）

- **概念**：线程是操作系统能够进行运算调度的最小单位。它被包含在进程之中，是进程中的实际运作单位。一个进程中可以包含一个或多个线程。
- **资源共享**：线程之间共享内存空间和资源。这使得线程间通信更简单，但同时也需要注意避免线程安全问题。
- **用途**：适合于I/O密集型任务，比如网络通信、文件读写等。

## 基于进程（Multiprocessing）

- **概念**：进程是资源分配的最小单位。每个进程都有自己独立的内存空间。
- **资源共享**：进程之间不共享内存，通信需要通过Inter-process communication（IPC）机制，如管道、套接字等。
- **用途**：适合于CPU密集型任务，比如复杂的计算。

## 异步编程（Asynchronous Programming）

- **概念**：异步编程是一种编程范式，允许程序在等待某些操作完成时继续执行其他任务。
- **资源共享**：通常在单个线程内执行，不涉及传统意义上的多线程或多进程，并且可以有效地利用I/O等待时间。
- **用途**：适用于 I/O 密集型和高延迟任务，比如网络请求、数据库操作。

# 并行运算在 python 中的实现

### concurrent.futures模块
- **ThreadPoolExecutor**：实现基于线程的并发。适用于 I/O 密集型任务。
- **ProcessPoolExecutor**：实现基于进程的并并发。适用于CPU密集型任务。

**示例：**

```python
from concurrent.futures import ThreadPoolExecutor

def task(n):
    return n + 1

# 使用with语句创建ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=5) as executor:
    # 使用submit提交单个任务
    future = executor.submit(task, 5)
    # 获取任务结果
    print(future.result())

    # 使用map并行处理多个任务
    results = executor.map(task, range(5))
    for result in results:
        print(result)

```

ProcessPoolExecutor 同理

#### 多参数输入

在使用 `map` 方法时，如果函数需要输入多个参数，则需要 **每个参数制作一个列表，并按顺序依次放入 `map` 函数即可**

```python
def do_something(param1, param2):
    # 这里是函数的逻辑
    return result

# 假设有两组参数
param1_values = [1, 2, 3, 4, 5]  # 第一组参数
param2_values = [10, 20, 30, 40, 50]  # 第二组参数

from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=5) as executor:
    results = executor.map(do_something, param1_values, param2_values)

    for result in results:
        print(result)
```

这样，执行时的参数为 (1, 10), (2,20), (3,30) ......


如果参数组合更加复杂，例如，需要从两个列表中的每个元素对创建一个参数对，可以使用 `itertools.product` 来生成所有可能的参数组合：

```python
import itertools
from concurrent.futures import ThreadPoolExecutor

# 生成所有可能的参数组合
param_combinations = list(itertools.product(param1_values, param2_values))

with ThreadPoolExecutor(max_workers=5) as executor:
    # 解包参数组合
    results = executor.map(lambda p: do_something(*p), param_combinations)

    for result in results:
        print(result)
```

## asyncio 模块

`asyncio` 是 Python 中用于编写异步代码的标准库。允许编写单线程的并发代码来执行多个 I/O 密集型任务。

### 1. `async` 和 `await`

- `async` 关键字用于定义一个异步函数（也称为协程）。
- `await` 关键字用于在异步函数中暂停执行，等待异步操作完成。

### 2. 运行异步函数

- 使用 `asyncio.run()` 函数来运行最高层级的入口点协程。这个函数会运行事件循环，直到给定的协程完成。

### 3. 任务（Tasks）

- 异步任务是对协程的进一步封装，允许在协程启动后控制其执行。使用 `asyncio.create_task()` 来创建任务。
- 任务在被创建后会自动加入事件循环并执行。

### 4. 事件循环

- 事件循环是 `asyncio` 的核心，负责管理和分发事件，如I/O操作、系统事件等。
- 在Python 3.7及以上版本，通常不需要显式创建或管理事件循环，因为 `asyncio.run()` 和相关API已经为你处理好。

### 5. 异步I/O操作

- `asyncio` 提供了多种异步I/O操作的支持，比如异步网络请求和异步文件读写。

### 示例代码

```python
import asyncio

async def count():
    print("One")
    await asyncio.sleep(1)
    print("Two")

async def main():
    await asyncio.gather(count(), count(), count())

asyncio.run(main())

```

在这个例子中：

- `count` 是一个异步函数，它打印一条消息，等待1秒钟，然后打印另一条消息。
- `asyncio.gather` 同时运行多个协程，并等待它们全部完成。
- `asyncio.run` 运行最高层级的协程。

### 注意事项

- 使用 `async`/`await` 时，只有异步函数才能使用 `await`，同步函数不能在异步函数中使用 `await`。
- 确保使用 `asyncio` 提供的异步版本的库进行I/O操作，以避免阻塞事件循环。
- 异步编程模型与传统的多线程、多进程模型有显著区别，需要一定的学习和适应。

`asyncio` 使得处理并发任务更加高效，尤其适合于I/O密集型应用。正确使用时，它可以显著提高应用程序的响应速度和效率。