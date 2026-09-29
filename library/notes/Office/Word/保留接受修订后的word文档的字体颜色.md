
[如何保留接受修订后的word文档的字体颜色？](https://www.zhihu.com/question/21966207)

# 方法 1
1. 按 Alt + F 11 打开 VBA 编辑器。
2. 插入一个新模块，然后输入以下代码：
```vb
Sub AcceptChangesAndColorRed()
    Dim chg As Revision
    If ActiveDocument.Revisions.Count = 0 Then
        MsgBox "文档中没有修订内容。"
        Exit Sub
    End If

    For Each chg In ActiveDocument.Revisions
        ' 仅处理插入和删除修订
        If chg.Type = wdRevisionInsert Or chg.Type = wdRevisionDelete Then
            On Error Resume Next  ' 跳过无法应用的对象
            chg.Range.Font.Color = wdColorRed  ' 先修改颜色
            On Error GoTo 0  ' 关闭错误忽略模式
            chg.Accept  ' 再接受修订
        End If
    Next chg
End Sub
```

**运行宏**，接受所有修订并将接受的修订文字变为红色。

使用其他颜色（建议使用 RGB 格式）
```vb
Sub AcceptChangesAndColorHex()
    Dim chg As Revision
    
    ' 设置需要的颜色 
    Dim MY_HEX_COLOR As Long
    MY_HEX_COLOR = RGB(68, 114, 196)
    
    
    If ActiveDocument.Revisions.Count = 0 Then
        MsgBox "文档中没有修订内容。"
        Exit Sub
    End If

    For Each chg In ActiveDocument.Revisions
        ' 仅处理插入和删除修订
        If chg.Type = wdRevisionInsert Or chg.Type = wdRevisionDelete Then
            On Error Resume Next  ' 跳过无法应用的对象
            
            ' 应用指定的颜色
            chg.Range.Font.Color = MY_HEX_COLOR  ' 先修改颜色
            
            On Error GoTo 0       ' 关闭错误忽略模式
            chg.Accept            ' 再接受修订
        End If
    Next chg
End Sub
```

# 方法 2

```vb
Sub 保留修订痕迹()
'
' 保留修订痕迹 宏
'
'
    Dim rngTemp As Range
    Dim revTemp As Revision
    
    Do While True
        Set revTemp = Selection.NextRevision(Wrap:=False)
        If Not (revTemp Is Nothing) Then
         If revTemp.Type = wdRevisionInsert Then  '如果是新增，则该内容颜色变为蓝色
            revTemp.Range.Font.ColorIndex = wdBlue
            Selection.Font.Underline = wdUnderlineSingle
            revTemp.Accept
         End If
         If revTemp.Type = wdRevisionDelete Then '如果是删除，则该内容颜色变为红色，增加删除线
            revTemp.Range.Font.ColorIndex = wdRed
            Selection.Font.StrikeThrough = True
            revTemp.Reject
          End If
        Else
            MsgBox Prompt:="已无修订"
        Exit Do
        End If
    Loop
    
End Sub
```


# 特别注意
有时候修订时会遗留一些回车或移动符，导致接受修订后，**行数发生偏移**。记得检查最后一行的行数在接受修订前后是否变化，如果有，尽快排查换行修订的位置，以免导致 response letter 和正文行数不一致。