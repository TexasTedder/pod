r"""
AR PDF Barcode Sorter (NEPTUNE)
--------------------------------
Watches an Input folder for PDF files, scans each for a Code128 barcode
representing the Sales Shipment No (prefixed HC-SS or TP-SS), and moves +
renames the file into the correct destination folder:

    HC-SS...  -> HC_DIR, renamed to the exact shipment number
    TP-SS...  -> TP_DIR, renamed to the exact shipment number
    anything else / no barcode found -> ERROR_DIR, original filename kept

Designed to be run by Windows Task Scheduler (e.g. every 5-15 minutes).
Each run processes whatever is currently in the Input folder and exits.

Folder paths are read from SQL Server (dbo.ControlMappings in 05_Neptune)
at startup, so paths can be changed from the dashboard's Control Mappings
page without editing this script. If SQL is unreachable, the script falls
back to the DEFAULT_PATHS below and keeps running - a DB outage should
never stop AR document processing.

After each run, a summary row per company (HC / TP / ERROR) - success and
failed counts - is written to dbo.RunLog for the dashboard.

Requirements (install once, into this project's own venv):
    pip install pymupdf pyzbar pillow pyodbc python-dotenv

Author: generated for Texas / HC
"""

import os
import sys
import shutil
import logging
import re
from pathlib import Path
from datetime import datetime
from collections import Counter

# --- SQL connection -----------------------------------------------------
# Credentials are shared with the Node backend via backend/.env (SQL auth,
# not Windows trusted auth - Task Scheduler's service account may not have
# SQL access, so this matches whatever login the backend already uses).
# Keeping it in one .env file means the password only ever lives in one
# place instead of being duplicated between the script and the backend.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / "backend" / ".env")
except ImportError:
    pass  # python-dotenv not installed - falls through to os.environ / defaults below

SQL_SERVER = os.environ.get("SQL_SERVER", r"YOUR_SQL_SERVER_HERE")
SQL_DATABASE = os.environ.get("SQL_DATABASE", "05_Neptune")
SQL_USER = os.environ.get("SQL_USER")
SQL_PASSWORD = os.environ.get("SQL_PASSWORD")

if SQL_USER and SQL_PASSWORD:
    SQL_CONN_STR = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={SQL_SERVER};"
        f"DATABASE={SQL_DATABASE};"
        f"UID={SQL_USER};PWD={SQL_PASSWORD};"
    )
else:
    # Fallback to Windows trusted auth if no SQL login is configured -
    # only works if the account running this script actually has SQL access.
    SQL_CONN_STR = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={SQL_SERVER};"
        f"DATABASE={SQL_DATABASE};"
        f"Trusted_Connection=yes;"
    )

# --- Fallback config ------------------------------------------------------
# Used only if SQL Server can't be reached at startup. Keep these in sync
# with whatever's currently seeded in dbo.ControlMappings so a DB outage
# doesn't silently point the script somewhere stale.
DEFAULT_PATHS = {
    "INPUT_DIR": r"\\hcg-dbn-fs03\NAV_PODS\AR\Input",
    "HC_DIR":    r"\\hcg-dbn-fs03\NAV_PODS\AR\HC\Unprocessed",
    "TP_DIR":    r"\\hcg-dbn-fs03\NAV_PODS\AR\TP\Unprocessed",
    "ERROR_DIR": r"\\hcg-dbn-fs03\NAV_PODS\AR\Error",
    "LOG_DIR":   r"\\hcg-dbn-fs03\NAV_PODS\AR\Logs",
}

# Render resolution for barcode scanning. Higher = more reliable but slower.
RENDER_ZOOM = 3.0  # ~216 DPI (72 * 3)

# Regex to find the shipment number pattern anywhere in decoded barcode text.
# Captures everything up to the next whitespace so suffixes like "~ABC" are
# preserved exactly as they appear on the barcode (not trimmed to word chars).
SHIPMENT_PATTERN = re.compile(r"(HC-SS|TP-SS)\S*", re.IGNORECASE)


def load_control_mappings() -> dict:
    """Fetch folder paths from dbo.ControlMappings. Falls back to
    DEFAULT_PATHS (with a warning) if SQL Server can't be reached, so a DB
    outage never blocks AR document processing."""
    try:
        import pyodbc
        with pyodbc.connect(SQL_CONN_STR, timeout=5) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT MappingKey, MappingValue FROM dbo.ControlMappings")
            rows = {key: value for key, value in cursor.fetchall()}
        paths = dict(DEFAULT_PATHS)
        paths.update(rows)
        return paths
    except Exception as e:
        # Logging isn't configured yet at this point (it depends on LOG_DIR,
        # which itself might come from SQL) - print goes to the console /
        # Task Scheduler capture, and we still log it properly once the
        # logger is set up further down using the fallback LOG_DIR.
        print(f"WARNING: Could not load ControlMappings from SQL ({e}). "
              f"Using fallback paths.")
        return dict(DEFAULT_PATHS)


PATHS = load_control_mappings()
INPUT_DIR = Path(PATHS["INPUT_DIR"])
HC_DIR = Path(PATHS["HC_DIR"])
TP_DIR = Path(PATHS["TP_DIR"])
ERROR_DIR = Path(PATHS["ERROR_DIR"])
LOG_DIR = Path(PATHS["LOG_DIR"])

# --- Setup logging -----------------------------------------------------
LOG_DIR.mkdir(parents=True, exist_ok=True)
log_file = LOG_DIR / f"ar_barcode_sorter_{datetime.now():%Y%m}.log"

# The file handler always runs - it's the permanent record Task Scheduler
# and the dashboard rely on. The console handler is added only when a real
# console is attached to stdout. Run via pythonw.exe (no console window,
# no flashing cmd prompt) and sys.stdout is None, so this skips it cleanly
# instead of crashing on a StreamHandler with nowhere to write.
handlers = [logging.FileHandler(log_file, encoding="utf-8")]
if sys.stdout is not None:
    handlers.append(logging.StreamHandler(sys.stdout))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=handlers,
)
log = logging.getLogger(__name__)


def ensure_dirs():
    for d in (INPUT_DIR, HC_DIR, TP_DIR, ERROR_DIR):
        d.mkdir(parents=True, exist_ok=True)


def extract_barcodes_from_pdf(pdf_path: Path):
    """Render each page of the PDF to an image and decode barcodes with pyzbar.
    Returns a list of decoded string values (deduplicated, order preserved)."""
    import pymupdf as fitz
    from pyzbar.pyzbar import decode as zbar_decode
    from PIL import Image

    values = []
    doc = fitz.open(pdf_path)
    try:
        matrix = fitz.Matrix(RENDER_ZOOM, RENDER_ZOOM)
        for page_index in range(len(doc)):
            page = doc[page_index]
            pix = page.get_pixmap(matrix=matrix)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

            results = zbar_decode(img)
            for r in results:
                try:
                    text = r.data.decode("utf-8", errors="ignore").strip()
                except Exception:
                    continue
                if text and text not in values:
                    values.append(text)

            # Stop early once we've found a usable shipment number
            if any(SHIPMENT_PATTERN.search(v) for v in values):
                break
    finally:
        doc.close()

    return values


def classify(shipment_no: str) -> str:
    """Return 'HC', 'TP', or 'ERROR' based on shipment number prefix."""
    if not shipment_no:
        return "ERROR"
    upper = shipment_no.upper()
    if upper.startswith("HC-SS"):
        return "HC"
    if upper.startswith("TP-SS"):
        return "TP"
    return "ERROR"


def safe_filename(shipment_no: str) -> str:
    """Turn a shipment number into a filesystem-safe filename (no extension)."""
    cleaned = re.sub(r'[<>:"/\\|?*]', "_", shipment_no).strip()
    return cleaned or "UNKNOWN"


def unique_destination(dest_dir: Path, filename: str) -> Path:
    """Avoid overwriting existing files by appending _1, _2, ... if needed."""
    dest = dest_dir / filename
    if not dest.exists():
        return dest
    stem, suffix = Path(filename).stem, Path(filename).suffix
    counter = 1
    while True:
        candidate = dest_dir / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def process_file(pdf_path: Path) -> tuple[str, bool]:
    """Process one PDF. Returns (category, succeeded) where category is
    'HC', 'TP', or 'ERROR', and succeeded is False only when the file
    itself was unreadable/corrupt (an ERROR-routed file due to a normal
    'no matching barcode' case still counts as succeeded=True - the script
    did its job correctly, the document just wasn't a recognised shipment)."""
    log.info(f"Processing: {pdf_path.name}")
    try:
        values = extract_barcodes_from_pdf(pdf_path)
    except Exception as e:
        log.error(f"  Failed to read/scan PDF ({e}) -> moving to Error")
        _move(pdf_path, ERROR_DIR, pdf_path.name)
        return "ERROR", False

    shipment_no = None
    for v in values:
        m = SHIPMENT_PATTERN.search(v)
        if m:
            shipment_no = m.group(0)
            break

    if not values:
        log.warning("  No barcode detected -> moving to Error")
    elif not shipment_no:
        log.warning(f"  Barcode(s) found but no HC-SS/TP-SS match: {values} -> moving to Error")

    category = classify(shipment_no)

    if category == "HC":
        new_name = safe_filename(shipment_no) + ".pdf"
        log.info(f"  Shipment No: {shipment_no} -> HC (renaming to {new_name})")
        _move(pdf_path, HC_DIR, new_name)
        return "HC", True
    elif category == "TP":
        new_name = safe_filename(shipment_no) + ".pdf"
        log.info(f"  Shipment No: {shipment_no} -> TP (renaming to {new_name})")
        _move(pdf_path, TP_DIR, new_name)
        return "TP", True
    else:
        # No valid shipment number - move as-is, keep original filename
        _move(pdf_path, ERROR_DIR, pdf_path.name)
        return "ERROR", True


def _move(pdf_path: Path, dest_dir: Path, new_name: str):
    dest = unique_destination(dest_dir, new_name)
    try:
        shutil.move(str(pdf_path), str(dest))
        log.info(f"  Moved to: {dest}")
    except Exception as e:
        log.error(f"  Failed to move {pdf_path.name} to {dest_dir}: {e}")


def write_run_log(counts: Counter):
    """Insert one RunLog row per company that had activity this run.
    Best-effort: if SQL is unreachable, log a warning and continue - a
    failed dashboard write must never fail the actual file processing run."""
    if not counts:
        return
    try:
        import pyodbc
        with pyodbc.connect(SQL_CONN_STR, timeout=5) as conn:
            cursor = conn.cursor()
            for company in ("HC", "TP", "ERROR"):
                success = counts.get((company, True), 0)
                failed = counts.get((company, False), 0)
                if success == 0 and failed == 0:
                    continue
                cursor.execute(
                    "INSERT INTO dbo.RunLog (RunTimestamp, Company, SuccessCount, FailedCount) "
                    "VALUES (?, ?, ?, ?)",
                    datetime.now(), company, success, failed,
                )
            conn.commit()
        log.info("Run summary logged to SQL (05_Neptune.dbo.RunLog).")
    except Exception as e:
        log.warning(f"Could not write run summary to SQL: {e}")


def main():
    ensure_dirs()
    pdf_files = sorted(INPUT_DIR.glob("*.pdf"))

    if not pdf_files:
        log.info("No PDF files found in Input folder.")
        return

    log.info(f"Found {len(pdf_files)} PDF(s) to process.")
    counts = Counter()
    for pdf_path in pdf_files:
        category, succeeded = process_file(pdf_path)
        counts[(category, succeeded)] += 1

    write_run_log(counts)
    log.info("Run complete.\n")


if __name__ == "__main__":
    main()