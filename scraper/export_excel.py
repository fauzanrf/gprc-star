"""
export_excel.py
================
Utility untuk mengonversi hasil scraping Starlink (JSON / dict list) ke file Excel (.xlsx)
dengan format profesional, lebar kolom otomatis, dan pewarnaan status.
Mendukung penyertaan kolom Email otomatis dari database accounts atau file master excel.
"""
from pathlib import Path
from typing import List, Dict, Any
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

COLUMNS = [
    ("no", "No", 6),
    ("controller", "Controller / Account", 26),
    ("code", "Account Code", 26),
    ("email", "Email", 28),
    ("site", "Site Name", 24),
    ("sn", "Dish Serial Number (SN)", 22),
    ("kit", "KIT Serial Number", 22),
    ("status", "Status", 14),
    ("quota", "Quota Usage", 16),
    ("restriction_detail", "Restriction Detail", 28),
    ("scraped_at", "Scraped At (WIB/UTC)", 24),
]

STATUS_COLORS = {
    "active": "D1E7DD",       # Soft green
    "restricted": "FFF3CD",   # Soft yellow/amber
    "suspended": "F8D7DA",    # Soft red/pink
    "inactive": "E2E3E5",     # Soft gray
}


def load_email_mapping() -> Dict[str, str]:
    """Cari mapping code / controller -> email dari database atau email starlink.xlsx."""
    mapping = {}

    # 1. Coba dari DB accounts jika ada koneksi
    try:
        import os
        import pymysql
        conn = pymysql.connect(
            host=os.getenv("DB_HOST", "mysql"),
            port=int(os.getenv("DB_PORT", "3306")),
            user=os.getenv("DB_USER", "starlink"),
            password=os.getenv("DB_PASSWORD", "starlink_pass"),
            database=os.getenv("DB_NAME", "starlink_db"),
            charset="utf8mb4",
            connect_timeout=3,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT account_number, account_name, email FROM accounts WHERE email IS NOT NULL AND email != ''")
            for acc_num, acc_name, mail in cur.fetchall():
                if mail:
                    m = str(mail).strip()
                    if acc_num:
                        mapping[str(acc_num).strip()] = m
                    if acc_name:
                        mapping[str(acc_name).strip().lower()] = m
        conn.close()
    except Exception:
        pass

    # 2. Coba baca dari file master email starlink.xlsx jika ada
    candidates = [
        Path("email starlink.xlsx"),
        Path("/app/email starlink.xlsx"),
        Path("/data/email starlink.xlsx"),
        Path(__file__).resolve().parent.parent / "email starlink.xlsx",
        Path(__file__).resolve().parent / "email starlink.xlsx",
    ]
    for p in candidates:
        if p.exists():
            try:
                wb = openpyxl.load_workbook(str(p), data_only=True)
                ws = wb.active
                for r in list(ws.iter_rows(values_only=True))[1:]:
                    if len(r) >= 3:
                        ctrl, code, mail = r[0], r[1], r[2]
                        if mail and str(mail).strip() and str(mail).strip().lower() != "none":
                            m = str(mail).strip()
                            if code:
                                mapping[str(code).strip()] = m
                            if ctrl:
                                mapping[str(ctrl).strip().lower()] = m
                break
            except Exception:
                pass

    return mapping


def save_to_excel(rows: List[Dict[str, Any]], output_path: str | Path):
    """Simpan list baris data scraping ke format file Excel dengan formatting rapi."""
    output_path = Path(output_path)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Starlink KITs"

    # Muat mapping email untuk melengkapi data baris jika kosong
    email_map = load_email_mapping()

    # Header style
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    # Write headers
    headers = [col[1] for col in COLUMNS]
    ws.append(headers)
    ws.row_dimensions[1].height = 28

    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border

    # Write data
    data_font = Font(name="Segoe UI", size=10)
    for r_idx, row in enumerate(rows, start=2):
        # Resolve email
        email_val = row.get("email")
        if not email_val or email_val in ("-", "None", "null", ""):
            code_key = str(row.get("code") or "").strip()
            ctrl_key = str(row.get("controller") or "").strip().lower()
            email_val = email_map.get(code_key) or email_map.get(ctrl_key) or "-"
            row["email"] = email_val

        row_values = []
        for key, _, _ in COLUMNS:
            val = row.get(key)
            if val is None or val == "":
                val = "-"
            row_values.append(val)
        ws.append(row_values)
        ws.row_dimensions[r_idx].height = 20

        st = (row.get("status") or "").lower()
        st_color = STATUS_COLORS.get(st)

        for col_idx, (key, _, _) in enumerate(COLUMNS, start=1):
            cell = ws.cell(row=r_idx, column=col_idx)
            cell.font = data_font
            cell.border = thin_border

            # Alignment
            if key in ("no", "status", "quota", "scraped_at"):
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")

            # Status cell color
            if key == "status" and st_color:
                cell.fill = PatternFill(start_color=st_color, end_color=st_color, fill_type="solid")
                cell.font = Font(name="Segoe UI", size=10, bold=True)

    # Column widths
    for col_idx, (_, _, min_w) in enumerate(COLUMNS, start=1):
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = min_w

    ws.freeze_panes = "A2"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(output_path))
    return str(output_path)
