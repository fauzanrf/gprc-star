"""
export_excel.py
================
Utility untuk mengonversi hasil scraping Starlink (JSON / dict list) ke file Excel (.xlsx)
dengan format profesional, lebar kolom otomatis, dan pewarnaan status.
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


def save_to_excel(rows: List[Dict[str, Any]], output_path: str | Path):
    """Simpan list baris data scraping ke format file Excel dengan formatting rapi."""
    output_path = Path(output_path)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Starlink KITs"

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
