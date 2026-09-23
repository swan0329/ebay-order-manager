"""Poll the order-manager enhancement queue and run only local GPU inference."""
from __future__ import annotations
import base64, json, os, tempfile, time, urllib.request
from pathlib import Path
from enhancer.engine import EnhancementError, enhance_image

ROOT = Path(__file__).resolve().parent

def load_local_env() -> None:
    """Load this PC-only file without putting a worker secret in Git."""
    env_file = ROOT / "site_worker.env"
    if not env_file.exists(): return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key and not key.lstrip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip('"'))

load_local_env()
SITE_URL = os.environ.get("EBAY_ORDER_MANAGER_URL", "").rstrip("/")
TOKEN = os.environ.get("LOCAL_AI_WORKER_TOKEN", "")

def request(payload: dict) -> dict:
    if not SITE_URL or not TOKEN: raise RuntimeError("EBAY_ORDER_MANAGER_URL 및 LOCAL_AI_WORKER_TOKEN 환경변수가 필요합니다.")
    body=json.dumps(payload).encode(); req=urllib.request.Request(f"{SITE_URL}/api/ai-image-work", body, {"Content-Type":"application/json","Authorization":f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=90) as response: return json.loads(response.read())

def main() -> None:
    while True:
        job = None
        try:
            request({"action":"workerHeartbeat"})
            job=request({"action":"enhancementClaim"}).get("job")
            if not job: time.sleep(4); continue
            with tempfile.TemporaryDirectory(prefix="realesrgan-job-") as folder:
                source=Path(folder)/"removed.jpg"; output=Path(folder)/"enhanced.jpg"
                urllib.request.urlretrieve(job["dewatermarkUrl"], source)
                result=enhance_image(source, output, job["model"], int(job["scale"]), {"models_dir":ROOT/"models", "strength":int(job["strength"])})
                data="data:image/jpeg;base64,"+base64.b64encode(output.read_bytes()).decode()
                request({"action":"enhancementComplete","id":job["id"],"image":data})
                print(f"completed {job['id']}: {result.output_size}")
        except Exception as error:
            print(f"worker error: {error}")
            try:
                if job: request({"action":"fail","id":job["id"],"error":str(error)[:500]})
            except Exception: pass
            time.sleep(8)

if __name__ == "__main__": main()
