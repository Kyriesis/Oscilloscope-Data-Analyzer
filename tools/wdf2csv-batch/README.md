# wdf2csv-batch

批量把 Yokogawa `.wdf`（Waveform File）转换成本项目 Web 应用可直接解析的 CSV。

转换逻辑基于 [Theprocyon/wdf2csv](https://github.com/Theprocyon/wdf2csv)，输出格式与 `src/csv.ts` 中的 `parseYokogawaCsv` 一致（包含 `TraceName`、`VUnit`、`HResolution`、`HOffset`、`HUnit`、`BlockSize`、`Model`、`Date` 等元数据）。

## 环境要求

- Windows（DLL 为原生 32 位，程序必须按 x86 编译运行）
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

## 构建

```bash
cd tools/wdf2csv-batch
dotnet build -c Release
```

构建时会自动把 `tools/wdf2csv-dll/lib/*.dll` 复制到 `bin\Release\net8.0-windows\DLL\`。

## 用法

```bash
# 转换当前目录下所有 .wdf
dotnet run -- -i C:\Data\wdf -o C:\Data\csv

# 递归查找子目录
dotnet run -- -i C:\Data\wdf -o C:\Data\csv -r

# 显式指定 DLL 目录（默认使用输出目录下的 DLL\）
dotnet run -- -i C:\Data\wdf -o C:\Data\csv -d C:\path\to\DLL
```

发布成独立可执行文件后可直接运行：

```bash
dotnet publish -c Release -r win-x86 --self-contained true
# 产物在 bin\Release\net8.0-windows\win-x86\publish\
```

## 输出

每个 `.wdf` 生成一个同名 `.csv`，所有 Trace 合并为单一文件的多列数据，例如：

```csv
TraceName, CH1, CH2
VUnit, V, A
HResolution, 1e-06
HOffset, 0
HUnit, s
BlockSize, 10000
Model, DLM3000
Date, 2024-05-21
, 0, 0.123, -0.456
, 1e-06, 0.124, -0.455
...
```
