"""
fix_data.py
===========
Script perbaikan data kit yang tertukar di database MySQL.
Bisa dijalankan di server VPS atau lokal:
  python scraper/fix_data.py
"""

import json
import os
from pathlib import Path
import pymysql
import pymysql.cursors

def _load_env():
    for p in [Path(".env"), Path("../.env"), Path(__file__).parent / ".env", Path(__file__).parent.parent / ".env"]:
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            break

_load_env()

def get_db():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "mysql"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "starlink"),
        password=os.getenv("DB_PASSWORD", "Strl1nkDB2026!"),
        database=os.getenv("DB_NAME", "starlink_db"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor
    )

def fix():
    print("=" * 60)
    print("      PERBAIKAN MAPPING AKUN STARLINK DI DATABASE")
    print("=" * 60)
    
    try:
        conn = get_db()
    except Exception as e:
        print(f"[!] Gagal koneksi ke database MySQL: {e}")
        print("    Pastikan MySQL / container Docker sedang berjalan.")
        return

    try:
        with conn.cursor() as cur:
            # 1. Cek akun Yamani Replace
            cur.execute("SELECT id, account_number, account_name FROM accounts WHERE account_number = 'ACC-8004329-40941-9' OR account_name LIKE '%Yamani%'")
            yamani = cur.fetchone()
            if not yamani:
                print("[!] Akun 'Yamani Replace' (ACC-8004329-40941-9) belum ada di tabel accounts. Membuat akun...")
                cur.execute("INSERT INTO accounts (account_number, account_name) VALUES ('ACC-8004329-40941-9', 'Yamani Replace')")
                yamani_id = cur.lastrowid
            else:
                yamani_id = yamani["id"]
                print(f"[+] Ditemukan akun Yamani: ID={yamani_id} ({yamani['account_name']})")

            # 2. Cek Mitradelta-Bima saat ini di tabel kits
            cur.execute("""
                SELECT k.id, k.site, k.kit, k.sn, k.account_id, a.account_name, a.account_number
                FROM kits k
                LEFT JOIN accounts a ON k.account_id = a.id
                WHERE k.kit = 'KITP00329432' OR k.site LIKE '%Mitradelta%'
            """)
            kits = cur.fetchall()
            for k in kits:
                print(f"[Info] Kit {k['site']} ({k['kit']}): saat ini terhubung ke '{k['account_name']}' ({k['account_number']})")
                if k["account_id"] != yamani_id:
                    print(f"       -> MEMPERBAIKI: Memindahkan ke Yamani Replace (ID={yamani_id})...")
                    cur.execute("UPDATE kits SET account_id = %s WHERE id = %s", (yamani_id, k["id"]))
                    print("       -> BERHASIL DIPERBAIKI!")

            # 3. Sinkronisasi kit lainnya dari starlink_export.json jika tersedia
            export_path = Path("starlink_export.json")
            if not export_path.exists():
                export_path = Path("/data/starlink_export.json")
            if not export_path.exists():
                export_path = Path(__file__).parent.parent / "starlink_export.json"

            if export_path.exists():
                print(f"\n[+] Mensinkronkan seluruh mapping kit dari {export_path.name}...")
                with open(export_path, "r", encoding="utf-8") as f:
                    export_data = json.load(f)

                updated_count = 0
                for row in export_data:
                    kit_sn = (row.get("kit") or "").strip()
                    acc_num = (row.get("code") or "").strip()
                    acc_name = (row.get("controller") or "").strip()
                    if not kit_sn or kit_sn == "-" or not acc_num:
                        continue

                    # Ambil / buat account
                    cur.execute("SELECT id FROM accounts WHERE account_number = %s", (acc_num,))
                    acc_row = cur.fetchone()
                    if not acc_row:
                        cur.execute("INSERT INTO accounts (account_number, account_name) VALUES (%s, %s)", (acc_num, acc_name))
                        target_acc_id = cur.lastrowid
                    else:
                        target_acc_id = acc_row["id"]

                    # Update account_id dan quota jika ada data kuota valid di export
                    new_quota = (row.get("quota") or "").strip()
                    if new_quota and new_quota != "-":
                        cur.execute(
                            "UPDATE kits SET account_id = %s, quota = %s WHERE kit = %s AND (quota = '-' OR quota IS NULL OR quota = '' OR account_id != %s)",
                            (target_acc_id, new_quota, kit_sn, target_acc_id),
                        )
                    else:
                        cur.execute("UPDATE kits SET account_id = %s WHERE kit = %s AND account_id != %s", (target_acc_id, kit_sn, target_acc_id))
                    if cur.rowcount > 0:
                        updated_count += cur.rowcount

                print(f"[+] Sinkronisasi selesai: {updated_count} kit disesuaikan akunnya dengan file export.")

            # 4. Perbaiki status 'suspended' riil yang salah ditandai sebagai 'inactive'
            print("\n[+] Memeriksa & memperbaiki status KIT yang ditangguhkan (suspended)...")
            
            # Daftar 6 kit spesifik dari akun Thufail Sinaga yang berstatus Suspended di Starlink
            target_suspended_kits = {
                "KIT404058868WGQ": {"site": "LABAI APP", "quota": "1.13 TB"},
                "KIT4046376504JD": {"site": "BKP NEW", "quota": "182.65 GB"},
                "KIT404637170DSN": {"site": "ENJER", "quota": "0.00 GB"},
                "KIT404637132PCK": {"site": "POS SECURITY D8", "quota": "0.00 GB"},
                "KIT404212936PTP": {"site": "MUA SPR", "quota": "741.12 GB"},
                "KIT404212940NTC": {"site": "NEW BURING JAMBI", "quota": "6.54 TB"},
            }

            fixed_suspended_count = 0
            for k_sn, info in target_suspended_kits.items():
                cur.execute("""
                    UPDATE kits 
                    SET status = 'suspended', 
                        restriction_detail = 'Subscription suspended',
                        quota = %s
                    WHERE kit = %s OR site = %s
                """, (info["quota"], k_sn, info["site"]))
                if cur.rowcount > 0:
                    fixed_suspended_count += cur.rowcount
                    print(f"    [OK] {info['site']} ({k_sn}): status diperbarui ke 'suspended' ({info['quota']})")

            # 5. Pastikan kit tidak terpakai dalam sub-akun aktif berstatus 'inactive', BUKAN 'suspended'
            print("\n[+] Memastikan KIT tidak terpakai di sub-akun aktif berstatus 'inactive'...")
            inactive_kits = [
                ("KIT303726912", "Tiesiju"),
                ("KIT303922833", "RUSAK APP - SEI HITAM RUSAK"),
            ]
            for ikit, isite in inactive_kits:
                cur.execute("""
                    UPDATE kits
                    SET status = 'inactive',
                        restriction_detail = 'Subscription inactive'
                    WHERE kit = %s OR site = %s
                """, (ikit, isite))
                if cur.rowcount > 0:
                    print(f"    [OK] {isite} ({ikit}) dipastikan berstatus 'inactive' (Subscription inactive).")

            # Jika ada kit dengan restriction_detail 'Subscription inactive' tapi berstatus suspended, kembalikan ke inactive
            cur.execute("""
                UPDATE kits
                SET status = 'inactive'
                WHERE status = 'suspended'
                  AND restriction_detail LIKE '%Subscription inactive%'
                  AND kit NOT IN ('KIT404058868WGQ', 'KIT4046376504JD', 'KIT404637170DSN', 'KIT404637132PCK', 'KIT404212936PTP', 'KIT404212940NTC', 'KIT404407267PDF', 'KIT404407253WCQ')
            """)
            if cur.rowcount > 0:
                print(f"    [OK] {cur.rowcount} KIT dikembalikan dari 'suspended' ke 'inactive'.")

            # 6. Pastikan sub-akun kosong (seperti Bga Drme) tidak memiliki kit di database
            print("\n[+] Memastikan sub-akun kosong (Bga Drme) tidak memiliki data kit...")
            cur.execute("""
                DELETE FROM kits
                WHERE account_id IN (
                    SELECT id FROM accounts WHERE account_number = 'ACC-8225025-90582-13'
                )
            """)
            if cur.rowcount > 0:
                print(f"    [OK] {cur.rowcount} KIT yang salah ditautkan ke Bga Drme dihapus.")

            conn.commit()
            print("\n[SUKSES] Semua perbaikan telah disimpan ke database.")
    finally:
        conn.close()

if __name__ == "__main__":
    fix()
