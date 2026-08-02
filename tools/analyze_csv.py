"""
CSV 自动测量脚本（高性能版）

用法：
    单文件：
        python tools/analyze_csv.py "C:/Users/.../RT/RigolDS08019.csv"

    批量处理：
        python tools/analyze_csv.py "C:/Users/.../RT" --output results.csv
        python tools/analyze_csv.py "C:/Users/.../RT" --output results.csv --workers 4

输出：
    - 单文件：打印到控制台
    - 批量：生成 CSV 报告，包含文件名、Pawl SW 下降沿时间、Cin Motor 堵转开始时间、ΔT(ms)
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
        raise ValueError("空文件")

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
        raise ValueError(f"CSV 表头缺少 t0 或 tInc: {path}")

    # 通道名只取前 4 列
    channel_names = [n.strip() for n in header.split(",")[:4]]

    data = []
    # 预分配比 append 快，但列数不确定，用 list comprehension 更平衡
    for line in lines[1:]:
        if not line:
            continue
        parts = line.split(",")
        # 只取前 4 列数值
        data.append([float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])])

    return t0, t_inc, channel_names, data


def detect_falling_edge(values: list[float], threshold: float = 1.5) -> int:
    """检测数字通道从高到低的下降沿，返回最后一个下降沿索引。"""
    edges = []
    for i in range(1, len(values)):
        if values[i - 1] > threshold and values[i] <= threshold:
            edges.append(i)
    if not edges:
        raise ValueError(f"未找到下降沿（阈值 {threshold}）")
    return edges[-1]


def moving_average(values: list[float], index: int, half: int) -> float:
    """以 index 为中心做滑动平均。"""
    start = index - half
    end = index + half + 1
    if start < 0:
        start = 0
    if end > len(values):
        end = len(values)
    total = 0.0
    for j in range(start, end):
        total += values[j]
    return total / (end - start)


def detect_stall_start(
    values: list[float],
    fall_index: int,
    t_inc: float,
    baseline_window_ms: float = 100.0,
    search_window_ms: float = 300.0,
    smooth_window_ms: float = 2.0,
    threshold_ratio: float = 0.2,
) -> int:
    """检测 Cin Motor 从自由电流进入堵转电流的过渡点。"""
    baseline_samples = max(1, int(round(baseline_window_ms / 1000.0 / t_inc)))
    search_samples = max(1, int(round(search_window_ms / 1000.0 / t_inc)))
    half_smooth = max(1, int(round(smooth_window_ms / 1000.0 / t_inc / 2)))

    # 基线
    start = max(0, fall_index - baseline_samples)
    baseline = 0.0
    count = fall_index - start
    for i in range(start, fall_index):
        baseline += values[i]
    baseline /= count

    # 堵转电流最小值
    end = min(len(values), fall_index + search_samples)
    stall_min = float("inf")
    stall_min_idx = fall_index
    for i in range(fall_index, end):
        s = moving_average(values, i, half_smooth)
        if s < stall_min:
            stall_min = s
            stall_min_idx = i

    if stall_min == float("inf"):
        raise ValueError("未找到堵转电流最小值")

    threshold = baseline + threshold_ratio * (stall_min - baseline)

    # 首次低于阈值
    for i in range(fall_index, stall_min_idx + 1):
        s = moving_average(values, i, half_smooth)
        if s <= threshold:
            return i

    return stall_min_idx


def analyze_file(
    path: str,
    pawl_sw_channel: int = 2,
    cin_motor_channel: int = 1,
    threshold: float = 1.5,
    threshold_ratio: float = 0.2,
) -> dict:
    """分析单个 CSV 文件。"""
    t0, t_inc, channel_names, data = parse_rigol_csv(path)

    ch_idx = pawl_sw_channel - 1
    motor_idx = cin_motor_channel - 1

    # 提取通道数据
    ch2 = [row[ch_idx] for row in data]
    ch1 = [row[motor_idx] for row in data]

    fall_index = detect_falling_edge(ch2, threshold=threshold)
    stall_index = detect_stall_start(
        ch1, fall_index, t_inc, threshold_ratio=threshold_ratio
    )

    fall_time = t0 + fall_index * t_inc
    stall_time = t0 + stall_index * t_inc
    delta_t_ms = (stall_time - fall_time) * 1000.0

    return {
        "file": Path(path).name,
        "channel_names": ",".join(channel_names),
        "pawl_sw_channel": pawl_sw_channel,
        "cin_motor_channel": cin_motor_channel,
        "fall_index": fall_index,
        "fall_time": fall_time,
        "stall_index": stall_index,
        "stall_time": stall_time,
        "delta_t_ms": delta_t_ms,
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
            "fall_time": None,
            "stall_time": None,
            "delta_t_ms": None,
        }


def find_csv_files(input_path: str) -> list[str]:
    """查找输入路径下的所有 CSV 数据文件，排除已有的报告文件。"""
    p = Path(input_path)
    if p.is_file():
        return [str(p)]
    if p.is_dir():
        files = [str(f) for f in sorted(p.glob("*.csv"))]
        # 排除报告文件，避免把 analysis_report.csv 当作数据源重复处理
        files = [f for f in files if not Path(f).name.lower().startswith("analysis_report")]
        return files
    raise FileNotFoundError(f"路径不存在: {input_path}")


def main():
    parser = argparse.ArgumentParser(
        description="自动测量 Pawl SW 下降沿到 Cin Motor 堵转开始的时间"
    )
    parser.add_argument("input", help="输入 CSV 文件或包含 CSV 文件的文件夹")
    parser.add_argument(
        "--pawl-sw", type=int, default=2, help="Pawl SW 所在通道编号（1-4），默认 2"
    )
    parser.add_argument(
        "--cin-motor", type=int, default=1, help="Cin Motor 所在通道编号（1-4），默认 1"
    )
    parser.add_argument(
        "--threshold", type=float, default=1.5, help="Pawl SW 高/低判断阈值（V），默认 1.5"
    )
    parser.add_argument(
        "--threshold-ratio",
        type=float,
        default=0.2,
        help="堵转电流动态阈值比例（0-1），默认 0.2",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="批量模式输出 CSV 报告路径（不指定则只打印到控制台）",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="并行处理进程数，默认 CPU 核心数",
    )
    args = parser.parse_args()

    kwargs = {
        "pawl_sw_channel": args.pawl_sw,
        "cin_motor_channel": args.cin_motor,
        "threshold": args.threshold,
        "threshold_ratio": args.threshold_ratio,
    }

    files = find_csv_files(args.input)

    if len(files) == 1:
        # 单文件模式
        result = analyze_file(files[0], **kwargs)
        print(f"File: {result['file']}")
        print(f"Channels: {result['channel_names'].split(',')}")
        print(f"Pawl SW falling edge time: {result['fall_time']:.6f} s")
        print(f"Cin Motor stall start time: {result['stall_time']:.6f} s")
        print(f"ΔT: {result['delta_t_ms']:.3f} ms")
        return

    # 批量模式
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

    # 输出结果
    if args.output:
        with open(args.output, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([
                "文件名", "Pawl SW 通道", "Cin Motor 通道", "Pawl SW 下降沿时间(s)",
                "Cin Motor 堵转开始时间(s)", "ΔT(ms)", "错误信息"
            ])
            for r in results:
                writer.writerow([
                    r["file"],
                    r.get("pawl_sw_channel", ""),
                    r.get("cin_motor_channel", ""),
                    f"{r['fall_time']:.6f}" if r["fall_time"] is not None else "",
                    f"{r['stall_time']:.6f}" if r["stall_time"] is not None else "",
                    f"{r['delta_t_ms']:.3f}" if r["delta_t_ms"] is not None else "",
                    r["error"] or "",
                ])
        print(f"\nReport saved: {args.output}")
    else:
        print("\nPreview (first 10):")
        for r in results[:10]:
            if r["error"] is None:
                print(f"  {r['file']}: ΔT = {r['delta_t_ms']:.3f} ms")


if __name__ == "__main__":
    main()
