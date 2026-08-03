"""
Home SW 脉冲宽度自动测量工具

用法：
    单文件：
        python tools/measure_home_sw.py "C:/Users/.../RT/home passing/RigolDS080120.csv"

    批量处理：
        python tools/measure_home_sw.py "C:/Users/.../RT/home passing" --output home_pulse_report.csv
        python tools/measure_home_sw.py "C:/Users/.../RT/home passing" --output home_pulse_report.csv --workers 4

输出：
    单文件：打印最后两个 Home SW 高电平脉冲的宽度和起止时间
    批量：生成 CSV 报告
"""

import argparse
import csv
import os
import sys
import time
from pathlib import Path
from multiprocessing import Pool, cpu_count


def parse_rigol_csv(path: str) -> tuple[float, float, list[str], list[list[float]]]:
    """快速解析 Rigol CSV，返回 t0, tInc, 通道名, 数据。"""
    with open(path, "r", encoding="utf-8", newline="") as f:
        text = f.read()

    lines = text.splitlines()
    if not lines:
        raise ValueError("Empty file")

    header = lines[0]
    t0 = None
    t_inc = None
    for token in header.split(","):
        token = token.strip()
        if token.lower().startswith("t0"):
            t0 = float(token.split("=")[1].strip())
        elif token.lower().startswith("tinc"):
            t_inc = float(token.split("=")[1].strip())
    if t0 is None or t_inc is None:
        raise ValueError(f"CSV header missing t0 or tInc: {path}")

    channel_names = [n.strip() for n in header.split(",")[:4]]

    data = []
    for line in lines[1:]:
        if not line:
            continue
        parts = line.split(",")
        data.append([float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])])

    return t0, t_inc, channel_names, data


def detect_pulses(
    values: list[float],
    t0: float,
    t_inc: float,
    threshold: float = 1.5,
    min_width_ms: float = 0.05,
    debounce_samples: int = 50,
) -> list[dict]:
    """检测所有高电平脉冲，返回 [{start_index, end_index, start_time, end_time, width_ms}]。

    增加消抖：上升沿和下降沿都需要连续 debounce_samples 个点保持新状态，
    才确认有效跳变，避免噪声造成的虚假脉冲边缘。
    """
    min_samples = max(1, int(round(min_width_ms / 1000.0 / t_inc)))
    pulses = []
    in_pulse = False
    start_idx = 0
    i = 0
    n = len(values)

    while i < n:
        if not in_pulse:
            # 潜在上升沿：当前点高于阈值，且为数据起点或前一点低于阈值
            if values[i] > threshold and (i == 0 or values[i - 1] <= threshold):
                end_check = min(i + debounce_samples, n)
                if all(values[j] > threshold for j in range(i, end_check)):
                    in_pulse = True
                    start_idx = i
                    i = end_check
                    continue
        else:
            # 潜在下降沿：当前点低于阈值
            if values[i] <= threshold:
                end_check = min(i + debounce_samples, n)
                if all(values[j] <= threshold for j in range(i, end_check)):
                    in_pulse = False
                    end_idx = i - 1
                    width_samples = end_idx - start_idx + 1
                    if width_samples >= min_samples:
                        pulses.append({
                            "start_index": start_idx,
                            "end_index": end_idx,
                            "start_time": t0 + start_idx * t_inc,
                            "end_time": t0 + end_idx * t_inc,
                            "width_ms": width_samples * t_inc * 1000.0,
                        })
                    i = end_check
                    continue
        i += 1

    if in_pulse:
        end_idx = len(values) - 1
        width_samples = end_idx - start_idx + 1
        if width_samples >= min_samples:
            pulses.append({
                "start_index": start_idx,
                "end_index": end_idx,
                "start_time": t0 + start_idx * t_inc,
                "end_time": t0 + end_idx * t_inc,
                "width_ms": width_samples * t_inc * 1000.0,
            })

    if not pulses:
        raise ValueError(f"No high-level pulse found (threshold {threshold})")

    return pulses


def analyze_file(
    path: str,
    home_sw_channel: int = 4,
    threshold: float = 1.5,
    min_width_ms: float = 0.05,
    debounce_samples: int = 50,
) -> dict:
    """分析单个 CSV 文件，测量 Home SW 最后两个脉冲宽度。"""
    t0, t_inc, channel_names, data = parse_rigol_csv(path)

    home_idx = home_sw_channel - 1
    ch_home = [row[home_idx] for row in data]

    pulses = detect_pulses(
        ch_home, t0, t_inc, threshold=threshold, min_width_ms=min_width_ms, debounce_samples=debounce_samples
    )

    # 最后两个脉冲：倒数第二、倒数第一
    pulse_1 = pulses[-2] if len(pulses) >= 2 else None
    pulse_2 = pulses[-1] if len(pulses) >= 1 else None

    # 倒数第二到倒数第一之间的时间间隔
    pulse_interval_ms = None
    if pulse_1 and pulse_2:
        pulse_interval_ms = (pulse_2["start_time"] - pulse_1["end_time"]) * 1000.0

    return {
        "file": Path(path).name,
        "channel_names": ",".join(channel_names),
        "home_sw_channel": home_sw_channel,
        "pulse_count": len(pulses),
        "pulse_1_start_time": pulse_1["start_time"] if pulse_1 else None,
        "pulse_1_end_time": pulse_1["end_time"] if pulse_1 else None,
        "pulse_1_width_ms": pulse_1["width_ms"] if pulse_1 else None,
        "pulse_2_start_time": pulse_2["start_time"] if pulse_2 else None,
        "pulse_2_end_time": pulse_2["end_time"] if pulse_2 else None,
        "pulse_2_width_ms": pulse_2["width_ms"] if pulse_2 else None,
        "pulse_interval_ms": pulse_interval_ms,
        "error": None,
    }


def analyze_file_safe(args: tuple) -> dict:
    """包装函数，用于多进程捕获异常。"""
    path, kwargs = args
    try:
        return analyze_file(path, **kwargs)
    except Exception as e:
        return {
            "file": Path(path).name,
            "error": str(e),
            "pulse_count": None,
            "pulse_1_width_ms": None,
            "pulse_2_width_ms": None,
            "pulse_interval_ms": None,
        }


def find_csv_files(input_path: str) -> list[str]:
    """查找输入路径下的所有 CSV 数据文件，排除已有的报告文件。"""
    p = Path(input_path)
    if p.is_file():
        return [str(p)]
    if p.is_dir():
        files = [str(f) for f in sorted(p.glob("*.csv"))]
        files = [f for f in files if not Path(f).name.lower().startswith("home_pulse_report")]
        return files
    raise FileNotFoundError(f"Path not found: {input_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Automatically measure the width of the last two Home SW pulses"
    )
    parser.add_argument("input", help="Input CSV file or folder containing CSV files")
    parser.add_argument(
        "--home-sw", type=int, default=4, help="Home SW channel number (1-4), default 4"
    )
    parser.add_argument(
        "--threshold", type=float, default=1.5, help="High/low threshold (V), default 1.5"
    )
    parser.add_argument(
        "--min-width-ms", type=float, default=0.05, help="Minimum pulse width (ms), default 0.05"
    )
    parser.add_argument(
        "--debounce",
        type=int,
        default=50,
        help="Pulse edge debounce samples, default 50 (0.5 ms with tInc=1e-5 s)",
    )
    parser.add_argument(
        "--output", type=str, default=None, help="Batch mode output CSV report path"
    )
    parser.add_argument(
        "--workers", type=int, default=None, help="Number of parallel workers, default CPU count"
    )
    args = parser.parse_args()

    kwargs = {
        "home_sw_channel": args.home_sw,
        "threshold": args.threshold,
        "min_width_ms": args.min_width_ms,
        "debounce_samples": args.debounce,
    }

    files = find_csv_files(args.input)

    if len(files) == 1:
        result = analyze_file(files[0], **kwargs)
        print(f"File: {result['file']}")
        print(f"Channels: {result['channel_names'].split(',')}")
        print(f"Total high pulses found: {result['pulse_count']}")
        if result["pulse_1_width_ms"] is not None:
            print(f"Last-2 pulse (pulse 1) width: {result['pulse_1_width_ms']:.3f} ms")
            print(f"  start: {result['pulse_1_start_time']:.6f} s, end: {result['pulse_1_end_time']:.6f} s")
        if result["pulse_2_width_ms"] is not None:
            print(f"Last-1 pulse (pulse 2) width: {result['pulse_2_width_ms']:.3f} ms")
            print(f"  start: {result['pulse_2_start_time']:.6f} s, end: {result['pulse_2_end_time']:.6f} s")
        if result["pulse_interval_ms"] is not None:
            print(f"Interval between pulse 1 end and pulse 2 start: {result['pulse_interval_ms']:.3f} ms")
        return

    workers = args.workers if args.workers else cpu_count()
    print(f"Found {len(files)} CSV files, processing with {workers} workers...")
    start = time.time()

    pool_args = [(f, kwargs) for f in files]
    with Pool(processes=workers) as pool:
        results = pool.map(analyze_file_safe, pool_args)

    elapsed = time.time() - start
    success = [r for r in results if r["error"] is None]
    failed = [r for r in results if r["error"] is not None]

    print(f"\nDone: {len(success)} success, {len(failed)} failed")
    print(f"Total time: {elapsed:.2f} s, average: {elapsed / len(files):.2f} s per file")

    if failed:
        print("\nFailed files:")
        for r in failed:
            print(f"  {r['file']}: {r['error']}")

    if args.output:
        with open(args.output, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow([
                "File", "Home SW Channel", "Pulse Count",
                "Pulse 1 Start(s)", "Pulse 1 End(s)", "Pulse 1 Width(ms)",
                "Pulse 2 Start(s)", "Pulse 2 End(s)", "Pulse 2 Width(ms)",
                "Pulse 1->2 Interval(ms)", "Error"
            ])
            for r in results:
                writer.writerow([
                    r["file"],
                    r.get("home_sw_channel", ""),
                    r.get("pulse_count", ""),
                    f"{r['pulse_1_start_time']:.6f}" if r["pulse_1_start_time"] is not None else "",
                    f"{r['pulse_1_end_time']:.6f}" if r["pulse_1_end_time"] is not None else "",
                    f"{r['pulse_1_width_ms']:.3f}" if r["pulse_1_width_ms"] is not None else "",
                    f"{r['pulse_2_start_time']:.6f}" if r["pulse_2_start_time"] is not None else "",
                    f"{r['pulse_2_end_time']:.6f}" if r["pulse_2_end_time"] is not None else "",
                    f"{r['pulse_2_width_ms']:.3f}" if r["pulse_2_width_ms"] is not None else "",
                    f"{r['pulse_interval_ms']:.3f}" if r["pulse_interval_ms"] is not None else "",
                    r["error"] or "",
                ])
        print(f"\nReport saved: {args.output}")
    else:
        print("\nPreview (first 10):")
        for r in results[:10]:
            if r["error"] is None:
                print(f"  {r['file']}: pulse1={r['pulse_1_width_ms']:.3f}ms, pulse2={r['pulse_2_width_ms']:.3f}ms")


if __name__ == "__main__":
    main()
