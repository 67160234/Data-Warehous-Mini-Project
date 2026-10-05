"""
============================================================
Smart Predictive Maintenance Platform — ETL Pipeline
============================================================
Extract:   อ่านข้อมูลจาก ai4i2020.csv
Transform: คำนวณ derived measures, จัด dimension keys
Load:      Insert เข้า SQLite Data Warehouse
============================================================
"""

import csv
import sqlite3
import os
import math
import sys
from datetime import datetime

# ============================================================
# Configuration
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
CSV_PATH = os.path.join(PROJECT_DIR, "ai4i2020.csv")
DB_PATH = os.path.join(BASE_DIR, "predictive_maintenance_dw.db")
SQL_PATH = os.path.join(BASE_DIR, "create_schema.sql")

# Quality label mapping
QUALITY_MAP = {
    "L": "Low",
    "M": "Medium",
    "H": "High"
}

# Failure type codes
FAILURE_CODES = ["TWF", "HDF", "PWF", "OSF", "RNF"]


def print_header(title):
    """Print a formatted section header."""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def print_step(step, desc):
    """Print a step indicator."""
    print(f"\n  [{step}] {desc}")


def create_schema(conn):
    """Execute the SQL schema script to create all tables."""
    print_step("1/5", "📋 Creating Data Warehouse schema...")

    with open(SQL_PATH, "r", encoding="utf-8") as f:
        sql_script = f.read()

    conn.executescript(sql_script)
    print(f"       ✅ Schema created successfully")

    # Verify tables
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = [row[0] for row in cursor.fetchall()]
    print(f"       📦 Tables: {', '.join(tables)}")

    # Verify views
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='view' ORDER BY name"
    )
    views = [row[0] for row in cursor.fetchall()]
    print(f"       👁️  Views: {', '.join(views)}")


def populate_date_dimension(conn):
    """Populate dim_date with dates for the current year."""
    print_step("2/5", "📅 Populating Date dimension...")

    import calendar

    year = datetime.now().year
    count = 0
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    month_names = list(calendar.month_name)[1:]  # Skip empty first element

    for month in range(1, 13):
        days_in_month = calendar.monthrange(year, month)[1]
        for day in range(1, days_in_month + 1):
            dt = datetime(year, month, day)
            date_key = int(dt.strftime("%Y%m%d"))
            weekday = dt.weekday()  # 0=Monday ... 6=Sunday
            is_weekend = 1 if weekday >= 5 else 0
            week_of_year = dt.isocalendar()[1]

            conn.execute("""
                INSERT OR IGNORE INTO dim_date
                (date_key, full_date, year, quarter, month, month_name,
                 week_of_year, day_of_month, day_name, is_weekend)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                date_key,
                dt.strftime("%Y-%m-%d"),
                year,
                (month - 1) // 3 + 1,
                month,
                month_names[month - 1],
                week_of_year,
                day,
                day_names[weekday],
                is_weekend
            ))
            count += 1

    conn.commit()
    print(f"       ✅ Loaded {count} dates for year {year}")


def populate_time_dimension(conn):
    """Populate dim_time with all hours and shifts."""
    print_step("3/5", "⏰ Populating Time dimension...")

    count = 0
    for hour in range(24):
        for minute in [0, 15, 30, 45]:  # 15-min intervals
            time_key = hour * 10000 + minute * 100
            full_time = f"{hour:02d}:{minute:02d}:00"

            if 6 <= hour < 14:
                shift = "Morning"
            elif 14 <= hour < 22:
                shift = "Afternoon"
            else:
                shift = "Night"

            conn.execute("""
                INSERT OR IGNORE INTO dim_time
                (time_key, full_time, hour, minute, shift)
                VALUES (?, ?, ?, ?, ?)
            """, (time_key, full_time, hour, minute, shift))
            count += 1

    conn.commit()
    print(f"       ✅ Loaded {count} time slots (15-min intervals, 3 shifts)")


def extract_transform_load(conn):
    """Main ETL: Read CSV, transform, load into DW."""
    print_step("4/5", "🔄 Running ETL: Extract → Transform → Load...")

    # --- EXTRACT ---
    print(f"\n       📥 Extracting from: {CSV_PATH}")
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(f"       📊 Extracted {len(rows)} records")

    # --- TRANSFORM & LOAD ---
    print(f"       🔄 Transforming and loading...")

    # Cache for product dimension (avoid duplicate lookups)
    product_cache = {}
    # Cache for failure type keys
    cursor = conn.execute("SELECT failure_type_key, failure_code FROM dim_failure_type")
    failure_type_cache = {row[1]: row[0] for row in cursor.fetchall()}

    # Use today's date_key for CSV load (no timestamp in source data)
    today_key = int(datetime.now().strftime("%Y%m%d"))
    default_time_key = 0  # midnight

    # Ensure default time exists
    conn.execute("""
        INSERT OR IGNORE INTO dim_time
        (time_key, full_time, hour, minute, shift)
        VALUES (0, '00:00:00', 0, 0, 'Night')
    """)

    # Counters
    products_loaded = 0
    readings_loaded = 0
    failures_loaded = 0
    multi_failure_count = 0
    inconsistency_count = 0

    for row in rows:
        product_id = row["Product ID"]
        product_type = row["Type"]

        # --- Load dim_product (SCD Type 1 — insert if new) ---
        if product_id not in product_cache:
            conn.execute("""
                INSERT OR IGNORE INTO dim_product (product_id, product_type, quality_label)
                VALUES (?, ?, ?)
            """, (product_id, product_type, QUALITY_MAP.get(product_type, "Unknown")))

            cursor = conn.execute(
                "SELECT product_key FROM dim_product WHERE product_id = ?",
                (product_id,)
            )
            product_cache[product_id] = cursor.fetchone()[0]
            products_loaded += 1

        product_key = product_cache[product_id]

        # --- Transform: Compute derived measures ---
        air_temp = float(row["Air temperature [K]"])
        process_temp = float(row["Process temperature [K]"])
        rpm = int(row["Rotational speed [rpm]"])
        torque = float(row["Torque [Nm]"])
        tool_wear = int(row["Tool wear [min]"])
        machine_failure = int(row["Machine failure"])

        # Derived measures
        temperature_diff = round(process_temp - air_temp, 2)
        power_w = round(torque * rpm * 2 * math.pi / 60, 2)

        # Count concurrent failures
        failure_flags = {code: int(row[code]) for code in FAILURE_CODES}
        failure_count = sum(failure_flags.values())

        if failure_count > 1:
            multi_failure_count += 1

        # Check consistency
        if machine_failure == 1 and failure_count == 0:
            inconsistency_count += 1
        if machine_failure == 0 and failure_count > 0:
            inconsistency_count += 1

        # --- Load fact_machine_reading ---
        cursor = conn.execute("""
            INSERT INTO fact_machine_reading
            (udi, product_key, date_key, time_key,
             air_temperature_k, process_temperature_k,
             rotational_speed_rpm, torque_nm, tool_wear_min,
             temperature_diff_k, power_w,
             machine_failure, failure_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            int(row["UDI"]),
            product_key,
            today_key,
            default_time_key,
            air_temp,
            process_temp,
            rpm,
            torque,
            tool_wear,
            temperature_diff,
            power_w,
            machine_failure,
            failure_count
        ))
        reading_id = cursor.lastrowid
        readings_loaded += 1

        # --- Load bridge_reading_failure ---
        for code, flag in failure_flags.items():
            if flag == 1:
                conn.execute("""
                    INSERT INTO bridge_reading_failure (reading_id, failure_type_key)
                    VALUES (?, ?)
                """, (reading_id, failure_type_cache[code]))
                failures_loaded += 1

    conn.commit()

    # --- Report ---
    print(f"\n       ✅ ETL Complete!")
    print(f"       ─────────────────────────────────────")
    print(f"       📦 Products loaded:           {products_loaded:,}")
    print(f"       📊 Readings loaded:            {readings_loaded:,}")
    print(f"       ⚠️  Failure bridges created:    {failures_loaded:,}")
    print(f"       🔀 Multi-failure records:      {multi_failure_count}")
    print(f"       ❗ Inconsistent records:        {inconsistency_count}")


def validate_data(conn):
    """Run validation queries on the loaded data."""
    print_step("5/5", "🔍 Validating loaded data...")

    # Total counts
    checks = [
        ("dim_product", "SELECT COUNT(*) FROM dim_product"),
        ("dim_failure_type", "SELECT COUNT(*) FROM dim_failure_type"),
        ("dim_date", "SELECT COUNT(*) FROM dim_date"),
        ("dim_time", "SELECT COUNT(*) FROM dim_time"),
        ("fact_machine_reading", "SELECT COUNT(*) FROM fact_machine_reading"),
        ("bridge_reading_failure", "SELECT COUNT(*) FROM bridge_reading_failure"),
    ]

    print(f"\n       📊 Table Row Counts:")
    for name, query in checks:
        count = conn.execute(query).fetchone()[0]
        print(f"       {name:30s} → {count:>8,} rows")

    # Product failure rate
    print(f"\n       📈 Failure Rate by Product Type:")
    cursor = conn.execute("""
        SELECT quality_label, total_readings, total_failures, failure_rate_pct
        FROM v_product_failure_rate
        ORDER BY failure_rate_pct DESC
    """)
    for row in cursor.fetchall():
        print(f"       {row[0]:10s} → {row[2]:>4}/{row[1]:>5} failures ({row[3]}%)")

    # Top failure types
    print(f"\n       🔧 Failure Type Distribution:")
    cursor = conn.execute("""
        SELECT ft.failure_name, ft.severity_level, COUNT(*) as cnt
        FROM bridge_reading_failure bf
        JOIN dim_failure_type ft ON bf.failure_type_key = ft.failure_type_key
        GROUP BY ft.failure_name, ft.severity_level
        ORDER BY cnt DESC
    """)
    for row in cursor.fetchall():
        print(f"       {row[0]:30s} [{row[1]:8s}] → {row[2]:>4} occurrences")

    # Sensor statistics
    print(f"\n       🌡️  Sensor Statistics:")
    cursor = conn.execute("SELECT * FROM v_sensor_statistics")
    print(f"       {'Metric':<30s} {'Min':>10s} {'Max':>10s} {'Avg':>10s}")
    print(f"       {'─'*30} {'─'*10} {'─'*10} {'─'*10}")
    for row in cursor.fetchall():
        print(f"       {row[0]:<30s} {row[1]:>10.2f} {row[2]:>10.2f} {row[3]:>10.2f}")

    # Database file size
    db_size = os.path.getsize(DB_PATH) / 1024 / 1024
    print(f"\n       💾 Database file size: {db_size:.2f} MB")


def main():
    """Main entry point for the ETL pipeline."""
    print_header("Smart Predictive Maintenance — ETL Pipeline")
    print(f"  Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Source:      {CSV_PATH}")
    print(f"  Target DB:   {DB_PATH}")

    # Check source file exists
    if not os.path.exists(CSV_PATH):
        print(f"\n  ❌ ERROR: Source file not found: {CSV_PATH}")
        sys.exit(1)

    # Remove existing DB for clean load
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"\n  🗑️  Removed existing database (clean load)")

    # Connect to SQLite
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA cache_size = -64000")  # 64MB cache

    try:
        create_schema(conn)
        populate_date_dimension(conn)
        populate_time_dimension(conn)
        extract_transform_load(conn)
        validate_data(conn)

        print_header("✅ ETL Pipeline Completed Successfully!")
        print(f"  Finished at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"  Database:    {DB_PATH}")
        print(f"\n  You can now query the Data Warehouse using:")
        print(f"  sqlite3 {DB_PATH}")
        print(f"{'='*60}\n")

    except Exception as e:
        print(f"\n  ❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        conn.rollback()
        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
