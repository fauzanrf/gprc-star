"""Create all database tables on startup & run schema migrations."""
import os
import time
import sqlalchemy
import sqlalchemy.exc
from sqlalchemy import text
from database import engine, Base
import models  # noqa: ensure all models are imported

MAX_RETRIES = 10

for attempt in range(MAX_RETRIES):
    try:
        Base.metadata.create_all(bind=engine)
        print("[DB] Tables created/verified successfully.", flush=True)

        # Migration: ensure parent_account_id column exists in accounts table
        with engine.connect() as conn:
            res = conn.execute(text("SHOW COLUMNS FROM accounts LIKE 'parent_account_id'"))
            if not res.fetchone():
                print("[DB] Migrating: Adding parent_account_id to accounts...", flush=True)
                conn.execute(text("ALTER TABLE accounts ADD COLUMN parent_account_id INT NULL"))
                conn.commit()

            # Seed default parent account if empty
            res = conn.execute(text("SELECT COUNT(*) FROM parent_accounts"))
            count = res.scalar() or 0
            if count == 0:
                default_email = os.getenv("STARLINK_EMAIL", "internetworkt@gmail.com")
                print(f"[DB] Seeding primary parent account: {default_email}", flush=True)
                conn.execute(
                    text("""
                        INSERT INTO parent_accounts (account_name, email, is_active, is_valid, created_at, updated_at)
                        VALUES (:name, :email, 1, 1, NOW(), NOW())
                    """),
                    {"name": "Akun Induk Utama", "email": default_email}
                )
                conn.commit()

                # Link all existing accounts to primary parent account
                res = conn.execute(text("SELECT id FROM parent_accounts LIMIT 1"))
                parent_id = res.scalar()
                if parent_id:
                    conn.execute(
                        text("UPDATE accounts SET parent_account_id = :pid WHERE parent_account_id IS NULL"),
                        {"pid": parent_id}
                    )
                    conn.commit()
                    print(f"[DB] Linked existing sub-accounts to parent_id={parent_id}.", flush=True)

            # Migrate users table role column to VARCHAR(50) and convert existing roles
            try:
                conn.execute(text("ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'viewer'"))
                conn.execute(text("UPDATE users SET role = 'admin' WHERE role IN ('super_admin', 'noc2', 'noc1', 'provisioning', 'technical_support')"))
                conn.execute(text("UPDATE users SET role = 'viewer' WHERE role IN ('magang') OR role NOT IN ('admin', 'viewer')"))
                conn.commit()
            except Exception as e:
                print(f"[DB] Migration role column notice: {e}", flush=True)

            # Seed default ACL users (admin & viewer)
            from auth_utils import hash_password
            res = conn.execute(text("SELECT COUNT(*) FROM users"))
            user_count = res.scalar() or 0
            if user_count == 0:
                print("[DB] Seeding default Admin & Viewer users...", flush=True)
                default_users = [
                    {"name": "Administrator", "email": "admin@internetwork.net.id", "password": "admin", "role": "admin"},
                    {"name": "Viewer Monitoring", "email": "viewer@internetwork.net.id", "password": "viewer", "role": "viewer"},
                ]
                for u in default_users:
                    pwd_hash = hash_password(u["password"])
                    conn.execute(
                        text("""
                            INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
                            VALUES (:name, :email, :pwd, :role, NOW(), NOW())
                        """),
                        {"name": u["name"], "email": u["email"], "pwd": pwd_hash, "role": u["role"]}
                    )
                conn.commit()
                print("[DB] Seeded default Admin & Viewer users successfully.", flush=True)
            else:
                # Ensure viewer user exists
                res_viewer = conn.execute(text("SELECT id FROM users WHERE email = 'viewer@internetwork.net.id'"))
                if not res_viewer.scalar():
                    conn.execute(
                        text("""
                            INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
                            VALUES ('Viewer Monitoring', 'viewer@internetwork.net.id', :pwd, 'viewer', NOW(), NOW())
                        """),
                        {"pwd": hash_password("viewer")}
                    )
                    conn.commit()
                    print("[DB] Added default viewer user.", flush=True)

        break
    except sqlalchemy.exc.OperationalError as e:
        print(f"[DB] Waiting for MySQL... ({attempt+1}/{MAX_RETRIES}): {e}", flush=True)
        time.sleep(5)
    except Exception as e:
        print(f"[DB] Error in schema migration: {e}", flush=True)
        break
else:
    print("[DB] Could not connect to MySQL after max retries.", flush=True)
    raise SystemExit(1)
