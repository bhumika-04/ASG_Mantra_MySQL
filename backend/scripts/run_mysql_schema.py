"""Create the TechGenia_Analytics structure on your MySQL server.

Runs database/WholeDbMySQL.sql against the connection in backend/.env
(MYSQL_HOST / MYSQL_PORT / MYSQL_DB / MYSQL_USER / MYSQL_PASSWORD). Only needs
to be run ONCE per database. Safe to re-run on an empty database; running it
against one that already has these tables fails with "table already exists"
rather than silently duplicating anything.

Usage:
    cd backend
    venv\\Scripts\\python.exe scripts\\run_mysql_schema.py
"""
import os
import sys

import pymysql

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA_FILE = os.path.join(ROOT_DIR, "database", "WholeDbMySQL.sql")


def get_connection():
    return pymysql.connect(
        host=settings.MYSQL_HOST,
        port=settings.MYSQL_PORT,
        user=settings.MYSQL_USER,
        password=settings.MYSQL_PASSWORD,
        database=settings.MYSQL_DB,
        charset="utf8mb4",
        client_flag=pymysql.constants.CLIENT.MULTI_STATEMENTS,
        autocommit=False,
    )


def main():
    if not os.path.exists(SCHEMA_FILE):
        sys.exit(f"Schema file not found: {SCHEMA_FILE}")

    with open(SCHEMA_FILE, "r", encoding="utf-8") as f:
        sql = f.read()

    print(f"Connecting to {settings.MYSQL_HOST}:{settings.MYSQL_PORT} / {settings.MYSQL_DB} ...")
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            print("Running database/WholeDbMySQL.sql ...")
            cur.execute(sql)
            # Drain any extra result sets produced by multi-statement execution
            while cur.nextset():
                pass
        conn.commit()
        print("Schema created successfully — 24 tables, indexes, foreign keys "
              "and check constraints are now in place.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
