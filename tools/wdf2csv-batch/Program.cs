using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using static WDF2CSV.WDFAPI;

namespace WDF2CSV
{
    // WDFAPI.cs 中包含 `using static WDF2CSV.Form;`，为避免修改第三方源码，
    // 这里提供一个占位类型让编译通过。
    public static class Form { }
}

namespace Wdf2CsvBatch
{
    internal sealed class TraceData
    {
        public string Name { get; }
        public string VUnit { get; }
        public string HUnit { get; }
        public IReadOnlyList<double> HValues { get; }
        public IReadOnlyList<double> VValues { get; }

        public TraceData(string name, string vUnit, string hUnit, IReadOnlyList<double> hValues, IReadOnlyList<double> vValues)
        {
            Name = name;
            VUnit = vUnit;
            HUnit = hUnit;
            HValues = hValues;
            VValues = vValues;
        }
    }

    internal class Program
    {
        private const string WDF_MAGIC = "%WDF";
        private static readonly string[] ModelNames = { "DL350", "DL850E", "DL950", "DLM3000", "DLM5000HD", "DLM5000", "XVWDF" };

        static void Main(string[] args)
        {
            var (inputDir, outputDir, dllDir, recursive) = ParseArgs(args);

            if (!Directory.Exists(inputDir))
            {
                Console.Error.WriteLine($"输入目录不存在: {inputDir}");
                Environment.Exit(1);
            }

            Directory.CreateDirectory(outputDir);

            var option = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            var files = Directory.GetFiles(inputDir, "*.wdf", option);

            if (files.Length == 0)
            {
                Console.WriteLine($"未在 {inputDir} 中找到 .wdf 文件。");
                return;
            }

            int success = 0;
            int failed = 0;
            foreach (var file in files)
            {
                try
                {
                    ConvertFile(file, outputDir, dllDir);
                    success++;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"转换失败 [{file}]: {ex.Message}");
                    failed++;
                }
            }

            Console.WriteLine($"完成。成功 {success} 个，失败 {failed} 个，输出目录: {Path.GetFullPath(outputDir)}");
        }

        private static (string inputDir, string outputDir, string dllDir, bool recursive) ParseArgs(string[] args)
        {
            string inputDir = Directory.GetCurrentDirectory();
            string outputDir = Path.Combine(inputDir, "csv_output");
            string dllDir = Path.Combine(AppContext.BaseDirectory, "DLL");
            bool recursive = false;

            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i].ToLowerInvariant())
                {
                    case "-i":
                    case "--input":
                        inputDir = args[++i];
                        break;
                    case "-o":
                    case "--output":
                        outputDir = args[++i];
                        break;
                    case "-d":
                    case "--dll":
                        dllDir = args[++i];
                        break;
                    case "-r":
                    case "--recursive":
                        recursive = true;
                        break;
                    case "-h":
                    case "--help":
                        PrintHelp();
                        Environment.Exit(0);
                        break;
                }
            }

            return (inputDir, outputDir, dllDir, recursive);
        }

        private static void PrintHelp()
        {
            Console.WriteLine("批量将 Yokogawa .wdf 转换为 web 应用可解析的 CSV。");
            Console.WriteLine();
            Console.WriteLine("用法: wdf2csv-batch [选项]");
            Console.WriteLine();
            Console.WriteLine("选项:");
            Console.WriteLine("  -i, --input <dir>     输入目录（默认当前目录）");
            Console.WriteLine("  -o, --output <dir>    输出目录（默认 <input>\\csv_output）");
            Console.WriteLine("  -d, --dll <dir>       存放 Yokogawa DLL 的目录（默认 .\\DLL）");
            Console.WriteLine("  -r, --recursive       递归查找子目录");
            Console.WriteLine("  -h, --help            显示本帮助");
        }

        private static void ConvertFile(string wdfPath, string outputDir, string dllDir)
        {
            string? model = DetectModel(wdfPath);
            if (string.IsNullOrEmpty(model))
            {
                throw new InvalidOperationException("无法识别示波器型号，当前仅支持 DLM 系列。");
            }

            string dllPath = Path.Combine(dllDir, model + ".dll");
            if (!File.Exists(dllPath))
            {
                throw new FileNotFoundException($"未找到 DLL: {dllPath}");
            }

            var api = new WDF2CSV.WDFAPI();
            api.tryLoadDLL(dllPath);

            int handle;
            int result = api.openFileEx(out handle, wdfPath);
            if (result != 0)
            {
                throw new InvalidOperationException($"WdfOpenFile 返回错误码 {result}");
            }

            try
            {
                uint traceNumber;
                api.getTraceNumber(handle, out traceNumber);

                var traces = new List<TraceData>();
                double hResolution = 0;
                double hOffset = 0;
                string hUnit = "s";
                int blockSize = 0;

                for (uint trace = 0; trace < traceNumber; trace++)
                {
                    uint block = 0;

                    double vResolution = 0, vOffset = 0;
                    api.getVResolution(handle, trace, block, out vResolution);
                    api.getVOffset(handle, trace, block, out vOffset);

                    double localHResolution = 0, localHOffset = 0;
                    api.getHResolution(handle, trace, block, out localHResolution);
                    api.getHOffset(handle, trace, block, out localHOffset);

                    int localBlockSize = 0;
                    api.getBlockSize(handle, trace, block, out localBlockSize);

                    WDFVDataType vDataType;
                    api.getVDataType(handle, trace, block, out vDataType);

                    double? illegalRaw = null;
                    if (api.isVIllegalDataSupported())
                    {
                        api.getVIllegalDataEnabled(handle, trace, out bool enabled);
                        if (enabled)
                        {
                            api.getVIllegalData(handle, trace, block, out double illegalVal);
                            illegalRaw = illegalVal;
                        }
                    }

                    var sb = new StringBuilder();
                    api.getTraceName(handle, trace, sb);
                    string traceName = sb.ToString();
                    sb.Clear();

                    api.getVUnit(handle, trace, block, sb);
                    string vUnit = sb.ToString();
                    sb.Clear();

                    api.getHUnit(handle, trace, block, sb);
                    string localHUnit = sb.ToString();
                    sb.Clear();

                    var param = new WDFAccessParam
                    {
                        version = (uint)WDFDefaultValue.WDF_DEFAULT_ACSPRM_VERSION,
                        trace = trace,
                        block = block,
                        start = 0,
                        count = localBlockSize,
                        ppRate = (int)WDFDefaultValue.WDF_DEFAULT_ACSPRM_PPRATE,
                        waveType = (int)WDFDefaultValue.WDF_DEFAULT_ACSPRM_WAVETYPE,
                        dataType = (int)WDFDefaultValue.WDF_DEFAULT_ACSPRM_DATATYPE,
                        cntOut = 0,
                        box = 0,
                        compMode = (int)WDFDefaultValue.WDF_DEFAULT_ACSPRM_COMPMODE,
                    };

                    byte[] buff = new byte[localBlockSize * 4];
                    GCHandle h = GCHandle.Alloc(buff, GCHandleType.Pinned);
                    try
                    {
                        param.dst = Marshal.UnsafeAddrOfPinnedArrayElement(buff, 0);
                        result = api.getScaleWave(handle, out param);
                        if (result != 0)
                        {
                            throw new InvalidOperationException($"WdfGetScaleWave 对 Trace {trace} 返回错误码 {result}");
                        }
                    }
                    finally
                    {
                        h.Free();
                    }

                    var vValues = GetPhysicalVValues(buff, localBlockSize, vOffset, vResolution, vDataType, illegalRaw);
                    var hValues = GetPhysicalHValues(localBlockSize, localHOffset, localHResolution);

                    if (trace == 0)
                    {
                        hResolution = localHResolution;
                        hOffset = localHOffset;
                        hUnit = localHUnit;
                        blockSize = localBlockSize;
                    }
                    else if (hValues.Count != blockSize)
                    {
                        Console.WriteLine($"  警告: Trace {trace} 采样点数与第一路不一致，已跳过。");
                        continue;
                    }

                    traces.Add(new TraceData(traceName, vUnit, localHUnit, hValues, vValues));
                }

                if (traces.Count == 0)
                {
                    Console.WriteLine($"  跳过（无有效 Trace）: {wdfPath}");
                    return;
                }

                string baseName = Path.GetFileNameWithoutExtension(wdfPath);
                string outPath = Path.Combine(outputDir, baseName + ".csv");
                WriteCombinedCsv(outPath, traces, hResolution, hOffset, hUnit, blockSize, model, wdfPath);
                Console.WriteLine($"  已导出: {outPath}");
            }
            finally
            {
                api.closeFile(out handle);
            }
        }

        private static string? DetectModel(string filePath)
        {
            string firstLine;
            using (var sr = new StreamReader(filePath, Encoding.ASCII))
            {
                firstLine = sr.ReadLine() ?? string.Empty;
            }

            foreach (var model in ModelNames)
            {
                if (firstLine.Contains(model))
                {
                    return model;
                }
            }
            return null;
        }

        private static List<double> GetPhysicalVValues(byte[] data, int dataPoints, double vOffset, double vResolution, WDFVDataType vDataType, double? illegalRaw)
        {
            var values = new List<double>(dataPoints);
            int offset = 0;
            ushort illegalU16 = illegalRaw.HasValue ? (ushort)(uint)illegalRaw.Value : (ushort)0;
            bool checkIllegal16 = illegalRaw.HasValue &&
                                  (vDataType == WDFVDataType.wdfDataTypeUINT16 ||
                                   vDataType == WDFVDataType.wdfDataTypeSINT16);
            for (int i = 0; i < dataPoints; i++)
            {
                switch (vDataType)
                {
                    case WDFVDataType.wdfDataTypeUINT16:
                    case WDFVDataType.wdfDataTypeSINT16:
                        ushort u16 = GetU16(data, ref offset);
                        if (checkIllegal16 && u16 == illegalU16)
                        {
                            values.Add(double.NaN);
                        }
                        else
                        {
                            double raw = vDataType == WDFVDataType.wdfDataTypeUINT16 ? u16 : (short)u16;
                            values.Add(raw * vResolution + vOffset);
                        }
                        break;
                    case WDFVDataType.wdfDataTypeUINT32:
                        values.Add(GetU32(data, ref offset) * vResolution + vOffset);
                        break;
                    case WDFVDataType.wdfDataTypeSINT32:
                        values.Add(GetI32(data, ref offset) * vResolution + vOffset);
                        break;
                    case WDFVDataType.wdfDataTypeFLOAT:
                        values.Add(GetFloat(data, ref offset) * vResolution + vOffset);
                        break;
                }
            }
            return values;
        }

        private static List<double> GetPhysicalHValues(int dataPoints, double hOffset, double hResolution)
        {
            var values = new List<double>(dataPoints);
            for (int i = 0; i < dataPoints; i++)
            {
                values.Add(i * hResolution + hOffset);
            }
            return values;
        }

        private static void WriteCombinedCsv(string outPath, List<TraceData> traces, double hResolution, double hOffset, string hUnit, int blockSize, string model, string sourcePath)
        {
            var dir = Path.GetDirectoryName(outPath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            var names = traces.Select(t => t.Name).ToList();
            var units = traces.Select(t => t.VUnit).ToList();

            using var writer = new StreamWriter(outPath, false, Encoding.UTF8);
            writer.WriteLine($"TraceName, {string.Join(", ", names)}");
            writer.WriteLine($"VUnit, {string.Join(", ", units)}");
            writer.WriteLine($"HResolution, {hResolution.ToString("G17", CultureInfo.InvariantCulture)}");
            writer.WriteLine($"HOffset, {hOffset.ToString("G17", CultureInfo.InvariantCulture)}");
            writer.WriteLine($"HUnit, {hUnit}");
            writer.WriteLine($"BlockSize, {blockSize}");
            writer.WriteLine($"Model, {model}");
            writer.WriteLine($"Date, {File.GetLastWriteTime(sourcePath).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}");

            int count = traces[0].VValues.Count;
            for (int i = 0; i < count; i++)
            {
                var row = new StringBuilder();
                foreach (var trace in traces)
                {
                    row.Append(",");
                    double v = trace.VValues[i];
                    row.Append(double.IsNaN(v) ? "nan" : v.ToString("G17", CultureInfo.InvariantCulture));
                }
                writer.WriteLine(row.ToString());
            }
        }

        private static ushort GetU16(byte[] data, ref int offset)
        {
            ushort v = BitConverter.ToUInt16(data, offset);
            offset += 2;
            return v;
        }

        private static short GetI16(byte[] data, ref int offset)
        {
            short v = BitConverter.ToInt16(data, offset);
            offset += 2;
            return v;
        }

        private static uint GetU32(byte[] data, ref int offset)
        {
            uint v = BitConverter.ToUInt32(data, offset);
            offset += 4;
            return v;
        }

        private static int GetI32(byte[] data, ref int offset)
        {
            int v = BitConverter.ToInt32(data, offset);
            offset += 4;
            return v;
        }

        private static float GetFloat(byte[] data, ref int offset)
        {
            float v = BitConverter.ToSingle(data, offset);
            offset += 4;
            return v;
        }
    }
}
