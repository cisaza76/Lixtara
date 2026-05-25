"""
One-off POC — train a 3D Gaussian Splat from a video on Modal, to validate
that self-host gsplat produces a sharper .ply than KIRI's 358k-gaussian
ceiling that we measured on 2026-05-23 for the same input video.

Usage (from the repo root):

    modal run scripts/poc-modal-gsplat.py \\
        --video-path ~/Downloads/lixtara-tour-source.mov \\
        --output-path ~/Downloads/lixtara-poc-modal.ply \\
        --iters 15000

Default GPU is A100-40GB ($2.39/hr on Modal). First run ~50 min wall
(image build ~10 min cached after) + ~40 min compute. Cost ~$2-3 for
the POC; comfortably inside the $30/mo free credit.
"""
import modal

# nerfstudio's docs recommend CUDA 11.8. We build from the nvidia dev image
# (we need nvcc to compile gsplat's CUDA kernels) and pin a known-good combo.
image = (
    modal.Image.from_registry(
        "nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04",
        add_python="3.10",
    )
    .apt_install(
        "ffmpeg",
        "colmap",
        "git",
        "libglib2.0-0",
        "libsm6",
        "libxrender1",
        "libxext6",
    )
    # Build prereqs first — pip --no-build-isolation needs wheel + setuptools
    # in the env (otherwise we get "invalid command 'bdist_wheel'").
    .pip_install("wheel", "setuptools", "ninja")
    .pip_install(
        "torch==2.1.2",
        "torchvision==0.16.2",
        index_url="https://download.pytorch.org/whl/cu118",
    )
    # Pre-built gsplat wheel for torch 2.1 + cuda 11.8 — avoids the CUDA
    # kernel compile entirely (faster, no torch-import-during-build trap).
    .pip_install(
        "gsplat==1.4.0",
        find_links="https://docs.gsplat.studio/whl/pt21cu118/",
    )
    .pip_install("nerfstudio==1.1.5")
)

app = modal.App("lixtara-3dgs-poc", image=image)


@app.function(gpu="A100", timeout=3600 * 2, memory=16 * 1024)
def train_gsplat(video_bytes: bytes, iters: int = 15000) -> bytes:
    """Stage 1: extract frames + COLMAP poses. Stage 2: train splatfacto.
    Stage 3: export PLY. Returns the .ply bytes."""
    import subprocess
    import pathlib

    work = pathlib.Path("/work")
    work.mkdir(exist_ok=True)

    video_path = work / "input.mov"
    video_path.write_bytes(video_bytes)
    print(f"[poc] video on disk: {video_path} ({len(video_bytes) / 1e6:.1f} MB)")

    # 1. ns-process-data: extract frames + run COLMAP (SfM → cameras.json)
    print("[poc] Stage 1/3: ns-process-data video (frames + COLMAP)")
    processed = work / "processed"
    subprocess.run(
        [
            "ns-process-data",
            "video",
            "--data",
            str(video_path),
            "--output-dir",
            str(processed),
            "--num-frames-target",
            "300",
        ],
        check=True,
    )

    # 2. Train splatfacto (gsplat). 15k iters is half the default 30k —
    # plenty for quality validation, half the compute.
    print(f"[poc] Stage 2/3: ns-train splatfacto ({iters} iters)")
    output_dir = work / "output"
    subprocess.run(
        [
            "ns-train",
            "splatfacto",
            "--data",
            str(processed),
            "--output-dir",
            str(output_dir),
            "--max-num-iterations",
            str(iters),
            "--vis",
            "tensorboard",
            "--viewer.quit-on-train-completion",
            "True",
        ],
        check=True,
    )

    runs_root = output_dir / "processed" / "splatfacto"
    latest_run = sorted(runs_root.iterdir())[-1]
    config_path = latest_run / "config.yml"
    print(f"[poc] latest run config: {config_path}")

    # 3. Export PLY (Gaussian Splat .ply, compatible with SuperSplat)
    print("[poc] Stage 3/3: ns-export gaussian-splat → .ply")
    export_dir = work / "exported"
    subprocess.run(
        [
            "ns-export",
            "gaussian-splat",
            "--load-config",
            str(config_path),
            "--output-dir",
            str(export_dir),
        ],
        check=True,
    )

    plys = list(export_dir.glob("*.ply"))
    if not plys:
        raise RuntimeError("no .ply emitted by ns-export")
    ply = plys[0]
    print(f"[poc] DONE: {ply} ({ply.stat().st_size / 1e6:.1f} MB)")
    return ply.read_bytes()


@app.local_entrypoint()
def main(
    video_path: str,
    output_path: str = "./poc-modal.ply",
    iters: int = 15000,
):
    import pathlib

    p = pathlib.Path(video_path).expanduser()
    out = pathlib.Path(output_path).expanduser()
    print(f"reading video: {p}")
    vid = p.read_bytes()
    print(f"submitting to Modal ({len(vid) / 1e6:.1f} MB, {iters} iters)")
    ply = train_gsplat.remote(vid, iters)
    out.write_bytes(ply)
    print(f"wrote {out} ({len(ply) / 1e6:.1f} MB)")
