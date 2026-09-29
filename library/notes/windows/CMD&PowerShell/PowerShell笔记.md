---
date created: Monday, October 30th 2023, 8:40:54 am
date modified: Tuesday, October 31st 2023, 12:51:17 pm
---
#windows #Powershell #编程
# PowerShell 中的字符串

- 符串可以用双引号括起来，也可以用单引号括起来，两者之间的区别在于**双引号内的字符串支持变量插值（例如 `"$variable"`）**，而单引号内的字符串会被视为纯字符串，不支持变量插值。

- `+` 运算符：是字符串拼接的运算符，用于将两个字符串连接起来。
	- `+` 运算符可以和字符串格式化结合使用：`1..10 | ForEach-Object { New-Item -Path ("./" + "{0:D2}" -f $_) -ItemType Directory -Force }`  
	- 其中 `()` 确保字符串拼接操作的优先级

# PowerShell 中的 for 循环

## for
PowerShell 中，使用 for 关键词进行循环的语法为：

```powershell
for ($i = 初始值; 循环条件; $i = $i + 步长) {
    # 循环体内的代码
}

```

在使用 for 循环时，首先需要对循环变量赋一个初始值，并设置循环运行的条件，最后设置每次循环结束后，循环变量值的变化

### 循环条件

通过对循环变量进行条件判断，来确定是否继续循环，在这里需要使用比较运算符

在 PowerShell 的 `for` 循环中，`-le`、`-ge` 等是比较运算符，用于比较两个值的大小。这些运算符在 `for` 循环的条件部分（循环条件）中常常被使用。

- **`-lt`：** 小于（Less Than）。例如，`$i -lt 10` 表示 `$i` 小于 10。
- **`-le`：** 小于或等于（Less Than or Equal to）。例如，`$i -le 10` 表示 `$i` 小于或等于 10。
- **`-gt`：** 大于（Greater Than）。例如，`$i -gt 10` 表示 `$i` 大于 10。
- **`-ge`：** 大于或等于（Greater Than or Equal to）。例如，`$i -ge 10` 表示 `$i` 大于或等于 10。
- **`-eq`：** 等于（Equal To）。例如，`$i -eq 10` 表示 `$i` 等于 10。
- **`-ne`：** 不等于（Not Equal To）。例如，`$i -ne 10` 表示 `$i` 不等于 10。

此外，还有逻辑运算符，例如 `and` 和 `or`，它们用于将多个比较条件组合起来。例如：

- **`-and`：** 逻辑与（AND）。例如，`$i -gt 0 -and $i -lt 10` 表示 `$i` 大于 0 且小于 10。
- **`-or`：** 逻辑或（OR）。例如，`$i -eq 0 -or $i -eq 10` 表示 `$i` 等于 0 或等于 10。

### 更新循环变量

在括号的第二个逗号后，规定了每次循环结束后，循环变量的更新方式

- `$i++`: 每次加 1
- `$i--`：每次减 1
- `$i = $i + 2`：步长为 2

例如：

**1. 从 1 到 5 输出循环变量的值：**

```powershell
for ($i = 1; $i -le 5; $i++) {     
Write-Output $i 
}
```

在这个例子中，`$i` 从 1 开始，每次循环递增 1，直到 `$i` 大于 5。`$i++`  代表每次循环结束后，`$i` 的值加一

**2. 从 10 倒数到 1 输出循环变量的值：**

```powershell
for ($i = 10; $i -ge 1; $i--) {     
Write-Output $i 
}
```

在这个例子中，`$i` 从 10 开始，每次循环递减 1，直到 `$i` 小于等于 1。`$i--`  代表每次循环结束后，`$i` 的值减一

## foreach
foreach 用于遍历数组、集合或者哈希表等数据结构中的元素。

```powershell
foreach ($item in $collection) {
    # 循环体内的代码
}

```

例子：

```powershell
$numbers = 1, 2, 3, 4, 5
foreach ($num in $numbers) {
    Write-Output $num
}
```


## 在控制台中使用循环

在 PowerShell 中，可以使用管道符号 `|` 结合 `ForEach-Object` 命令，以及 `;` 分号来在一行代码中实现 `for` 或 `foreach` 循环的功能。

`1..5 | ForEach-Object { Write-Output $_ }`

`$numbers = 1, 2, 3, 4, 5; $numbers | ForEach-Object { Write-Output $_ }`

>[!note]
>在 powershell 中，用 `;` 连接多行命令到一行中

# Powershell 中的字符串截取

### 使用索引截取单个字符

可以使用字符串的索引来截取单个字符。在 PowerShell 中，字符串的索引是从0开始的。例如，对于字符串 `$str`，可以通过 `$str[0]` 来获取字符串的第一个字符。

`$str = "Hello, World!" $firstCharacter = $str[0] # 这会得到 "H"`

### 使用Substring方法截取子字符串

PowerShell中的字符串对象有一个名为`Substring`的方法，允许截取字符串的特定部分。`Substring`方法采用两个参数：起始索引和截取的字符数。

`$str = "Hello, World!" $substring = $str.Substring(7, 5) # 从索引7开始截取5个字符，结果是 "World"`

**截取最后三位字符串**

```powershell
# 原始字符串
$originalString = "这是一个示例字符串"

# 截取字符串的最后三位
$lastThreeCharacters = $originalString.Substring($originalString.Length - 3)

# 输出截取的最后三位
Write-Output $lastThreeCharacters
```
### 使用Split方法截取字符串的一部分

也可以使用`Split`方法将字符串分割为子字符串数组，然后选择需要的部分。

`$str = "Hello, World!" $words = $str.Split(' ')[0] # 得到 "Hello"

# PowerShell 中的字符串格式化输出

在 PowerShell 中，可以使用字符串格式化输出来更好地控制文本的显示格式。格式化字符串中可以包含占位符，用来插入变量的值、数字、日期等。

### 基本的字符串格式化输出语法：

`"格式化字符串" -f 变量1, 变量2, ...`

在这个语法中，`-f` 是格式化操作符，后面可以跟上一个或多个变量，用来填充格式化字符串中的占位符。

### 字符串格式化输出的占位符：

- `{0}`, `{1}`, `{2}`, ...：代表第一个、第二个、第三个变量的位置。
- `{0:N2}`：将第一个变量格式化为带有两位小数的数字。
- `{0:D4}`：将第一个变量格式化为带有4位数字的整数。
- `{0:C}`：将第一个变量格式化为货币值。
- `{0:P2}`：将第一个变量格式化为带有两位小数的百分比值。
- `{0:s}`：将第一个变量格式化为短日期字符串。

例子：

格式化数字：

```powershell
$number = 123.45678
Write-Output ("Formatted number: {0:N2}" -f $number)
```

格式化日期：

```powershell
$now = Get-Date
Write-Output ("Current date and time: {0:s}" -f $now)
```

# Powershell 中的管道

使用类似 bash shell 的管道符 `|` ，可以将上一个命令的输出结果作为下一个命令的输入，简化代码，见 [[PowerShell笔记#常用命令]]

# Powershell 中重命名文件

在 PowerShell 中，可以使用 `Rename-Item` 命令来给文件重命名。

**基本的文件重命名：**

`Rename-Item -Path "旧文件名.txt" -NewName "新文件名.txt"`


**在文件名中加入日期时间戳：**

```powershell
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
Rename-Item -Path "文件.txt" -NewName ("文件_" + $timestamp + ".txt")
```


**使用正则表达式进行批量文件重命名：**

```powershell
Get-ChildItem -Path "./" -Filter "*.txt" | 
ForEach-Object { 
    $newName = $_.Name -replace "old", "new"
    Rename-Item -Path $_.FullName -NewName $newName
}
```

在这个示例中，`Get-ChildItem -Path "C:\路径\到\你的\文件夹" -Filter "*.txt"` 获取指定文件夹中的所有`.txt`文件。然后，使用`ForEach-Object`循环遍历每个文件，通过正则表达式替换文件名中的"old"为"new"。最后，使用`Rename-Item`命令将文件重命名为新的文件名。
# PowerShell 生成数组

在 PowerShell 中，你可以使用范围操作符 (`..`) 来生成数列。范围操作符允许你生成一个指定范围内的整数序列。以下是一些示例：

**生成从1到10的整数序列：**

`1..10`

这将生成一个包含1到10的整数数组。

**生成从10到1的整数序列：**

`10..1`

这将生成一个包含10到1的整数数组。

**生成指定步长的整数序列：**

`1..10 | Where-Object { $_ % 2 -eq 0 }`

这将生成一个包含1到10的偶数数组。`Where-Object` 命令用于筛选出符合条件的元素。

**生成自定义范围的整数序列：**

`$start = 5 $end = 15 $start..$end`

这将生成一个包含5到15的整数数组。你可以通过设置变量来定义自己的起始和结束值。

**生成字母序列：**

`'a'..'z'`

这将生成一个包含小写字母a到z的字符数组。

需要注意的是，范围操作符 (`..`) 只能生成整数序列或字符序列。如果需要生成其他类型的序列，你可能需要使用其他方法，比如使用循环和数组。
# 常用命令

**获取文件夹内所有文件和文件夹的名字（带后缀）**

`Get-ChildItem -Path . | Select-Object -ExpandProperty Name`

**获取文件夹内所有文件和文件夹的名字（不带后缀）**

`Get-ChildItem -Path . | Select-Object -ExpandProperty BaseName`

**获取文件夹内所有文件夹的名字**

`$files = Get-ChildItem -Path . | Where-Object { -not $_.PSIsContainer } | Select-Object -ExpandProperty Name`

**获取文件夹内所有文件的名字（不包括文件夹）**

`Get-ChildItem -Path . | Where-Object { -not $_.PSIsContainer } | Select-Object -ExpandProperty Name/BaseName`

**筛选以 .txt 结尾的文件**

`Get-ChildItem . -Filter *.txt | Select-Object -ExpandProperty name`

`Get-ChildItem . | Where-Object {$_.Name -Match ".*.txt"} | Select-Object -ExpandProperty name`

**删除文件夹内的文件**

`del *.txt`

