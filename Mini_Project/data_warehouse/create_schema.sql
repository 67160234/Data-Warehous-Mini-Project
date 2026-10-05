-- ============================================================
-- Smart Predictive Maintenance Platform — Data Warehouse
-- Schema: Star Schema (SQLite Compatible)
-- Date: 2026-10-05
-- ============================================================

-- ============================================================
-- PRAGMA Settings (SQLite)
-- ============================================================
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- DROP EXISTING TABLES (if re-running)
-- ============================================================
DROP TABLE IF EXISTS bridge_reading_failure;
DROP TABLE IF EXISTS fact_machine_reading;
DROP TABLE IF EXISTS dim_product;
DROP TABLE IF EXISTS dim_failure_type;
DROP TABLE IF EXISTS dim_date;
DROP TABLE IF EXISTS dim_time;
DROP VIEW IF EXISTS v_failure_analysis;
DROP VIEW IF EXISTS v_product_failure_rate;
DROP VIEW IF EXISTS v_sensor_statistics;

-- ============================================================
-- DIMENSION TABLE: dim_product
-- Description: Product/machine information with quality tier
-- ============================================================
CREATE TABLE dim_product (
    product_key     INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      TEXT    NOT NULL UNIQUE,   -- e.g. 'M14860'
    product_type    TEXT    NOT NULL,           -- 'L', 'M', 'H'
    quality_label   TEXT    NOT NULL,           -- 'Low', 'Medium', 'High'
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- DIMENSION TABLE: dim_failure_type
-- Description: Failure classification reference
-- ============================================================
CREATE TABLE dim_failure_type (
    failure_type_key    INTEGER PRIMARY KEY AUTOINCREMENT,
    failure_code        TEXT    NOT NULL UNIQUE,   -- 'TWF','HDF','PWF','OSF','RNF'
    failure_name        TEXT    NOT NULL,
    failure_description TEXT    NOT NULL,
    severity_level      TEXT    NOT NULL            -- 'Low','Medium','High','Critical'
);

-- Pre-populate failure types (SCD Type 0 — static reference data)
INSERT INTO dim_failure_type (failure_code, failure_name, failure_description, severity_level) VALUES
    ('TWF', 'Tool Wear Failure',
     'เครื่องมือสึกหรอจนเกินขีดจำกัด ทำให้ชิ้นงานเสียหาย Tool ถูกสุ่มเปลี่ยนระหว่าง 200-240 นาที',
     'Medium'),
    ('HDF', 'Heat Dissipation Failure',
     'ระบบระบายความร้อนล้มเหลว เกิดเมื่อ process temp - air temp < 8.6K และ rotational speed < 1380 rpm',
     'High'),
    ('PWF', 'Power Failure',
     'กำลังเครื่องจักรอยู่นอกช่วงทำงานปกติ เกิดเมื่อ Power (torque × ω) < 3500W หรือ > 9000W',
     'Critical'),
    ('OSF', 'Overstrain Failure',
     'เครื่องจักรรับภาระเกินพิกัด เกิดจาก tool wear × torque สูงเกินค่าที่กำหนดตาม product type',
     'High'),
    ('RNF', 'Random Failure',
     'ความล้มเหลวแบบสุ่มที่ไม่สัมพันธ์กับ process parameter ใดๆ มีโอกาส 0.1% ในแต่ละรอบ',
     'Low');

-- ============================================================
-- DIMENSION TABLE: dim_date
-- Description: Date dimension for time-series analysis
-- (Pre-populated for current year; expandable for IoT data)
-- ============================================================
CREATE TABLE dim_date (
    date_key        INTEGER PRIMARY KEY,    -- YYYYMMDD format
    full_date       TEXT    NOT NULL,
    year            INTEGER NOT NULL,
    quarter         INTEGER NOT NULL,
    month           INTEGER NOT NULL,
    month_name      TEXT    NOT NULL,
    week_of_year    INTEGER NOT NULL,
    day_of_month    INTEGER NOT NULL,
    day_name        TEXT    NOT NULL,
    is_weekend      INTEGER NOT NULL DEFAULT 0   -- 0=weekday, 1=weekend
);

-- ============================================================
-- DIMENSION TABLE: dim_time
-- Description: Time dimension for shift-based analysis
-- ============================================================
CREATE TABLE dim_time (
    time_key    INTEGER PRIMARY KEY,    -- HHMMSS format
    full_time   TEXT    NOT NULL,
    hour        INTEGER NOT NULL,
    minute      INTEGER NOT NULL,
    shift       TEXT    NOT NULL         -- 'Morning','Afternoon','Night'
);

-- ============================================================
-- FACT TABLE: fact_machine_reading
-- Description: Central fact table containing sensor readings
--              and computed measures for each machine operation
-- Grain: One row per machine operation/reading
-- ============================================================
CREATE TABLE fact_machine_reading (
    reading_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    udi                     INTEGER NOT NULL,           -- Original UDI from source
    product_key             INTEGER NOT NULL,           -- FK → dim_product
    date_key                INTEGER,                    -- FK → dim_date (nullable for CSV load)
    time_key                INTEGER,                    -- FK → dim_time (nullable for CSV load)

    -- Measures: Sensor Readings
    air_temperature_k       REAL    NOT NULL,
    process_temperature_k   REAL    NOT NULL,
    rotational_speed_rpm    INTEGER NOT NULL,
    torque_nm               REAL    NOT NULL,
    tool_wear_min           INTEGER NOT NULL,

    -- Derived Measures (computed during ETL)
    temperature_diff_k      REAL    NOT NULL,           -- process_temp - air_temp
    power_w                 REAL    NOT NULL,            -- torque * rpm * 2π/60

    -- Failure Flags
    machine_failure         INTEGER NOT NULL DEFAULT 0, -- 0=OK, 1=Failed
    failure_count           INTEGER NOT NULL DEFAULT 0, -- Number of concurrent failures

    -- Metadata
    load_timestamp          TEXT    NOT NULL DEFAULT (datetime('now')),

    -- Foreign Keys
    FOREIGN KEY (product_key) REFERENCES dim_product(product_key),
    FOREIGN KEY (date_key)    REFERENCES dim_date(date_key),
    FOREIGN KEY (time_key)    REFERENCES dim_time(time_key)
);

-- ============================================================
-- BRIDGE TABLE: bridge_reading_failure
-- Description: Many-to-many relationship between readings
--              and failure types (one reading can have multiple
--              failure types simultaneously)
-- ============================================================
CREATE TABLE bridge_reading_failure (
    bridge_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reading_id          INTEGER NOT NULL,
    failure_type_key    INTEGER NOT NULL,

    FOREIGN KEY (reading_id)       REFERENCES fact_machine_reading(reading_id),
    FOREIGN KEY (failure_type_key) REFERENCES dim_failure_type(failure_type_key),

    UNIQUE(reading_id, failure_type_key)  -- Prevent duplicates
);

-- ============================================================
-- INDEXES for Query Performance
-- ============================================================

-- Fact table indexes
CREATE INDEX idx_fact_product_key    ON fact_machine_reading(product_key);
CREATE INDEX idx_fact_date_key       ON fact_machine_reading(date_key);
CREATE INDEX idx_fact_time_key       ON fact_machine_reading(time_key);
CREATE INDEX idx_fact_failure        ON fact_machine_reading(machine_failure);
CREATE INDEX idx_fact_udi            ON fact_machine_reading(udi);
CREATE INDEX idx_fact_tool_wear      ON fact_machine_reading(tool_wear_min);
CREATE INDEX idx_fact_power          ON fact_machine_reading(power_w);

-- Bridge table indexes
CREATE INDEX idx_bridge_reading      ON bridge_reading_failure(reading_id);
CREATE INDEX idx_bridge_failure_type ON bridge_reading_failure(failure_type_key);

-- Dimension table indexes
CREATE INDEX idx_product_type        ON dim_product(product_type);
CREATE INDEX idx_failure_severity    ON dim_failure_type(severity_level);

-- ============================================================
-- ANALYTICAL VIEWS
-- ============================================================

-- View: Failure Analysis (detailed failure breakdown)
CREATE VIEW v_failure_analysis AS
SELECT
    f.reading_id,
    f.udi,
    p.product_id,
    p.product_type,
    p.quality_label,
    ft.failure_code,
    ft.failure_name,
    ft.severity_level,
    f.air_temperature_k,
    f.process_temperature_k,
    f.temperature_diff_k,
    f.rotational_speed_rpm,
    f.torque_nm,
    f.power_w,
    f.tool_wear_min,
    f.failure_count
FROM fact_machine_reading f
JOIN dim_product p ON f.product_key = p.product_key
JOIN bridge_reading_failure bf ON f.reading_id = bf.reading_id
JOIN dim_failure_type ft ON bf.failure_type_key = ft.failure_type_key
WHERE f.machine_failure = 1;

-- View: Product Failure Rate Summary
CREATE VIEW v_product_failure_rate AS
SELECT
    p.product_type,
    p.quality_label,
    COUNT(*) AS total_readings,
    SUM(f.machine_failure) AS total_failures,
    ROUND(100.0 * SUM(f.machine_failure) / COUNT(*), 2) AS failure_rate_pct,
    ROUND(AVG(f.air_temperature_k), 2) AS avg_air_temp,
    ROUND(AVG(f.process_temperature_k), 2) AS avg_process_temp,
    ROUND(AVG(f.rotational_speed_rpm), 0) AS avg_rpm,
    ROUND(AVG(f.torque_nm), 2) AS avg_torque,
    ROUND(AVG(f.tool_wear_min), 0) AS avg_tool_wear
FROM fact_machine_reading f
JOIN dim_product p ON f.product_key = p.product_key
GROUP BY p.product_type, p.quality_label;

-- View: Sensor Statistics (overall)
CREATE VIEW v_sensor_statistics AS
SELECT
    'Air Temperature (K)' AS metric,
    MIN(air_temperature_k) AS min_val,
    MAX(air_temperature_k) AS max_val,
    ROUND(AVG(air_temperature_k), 2) AS avg_val,
    COUNT(*) AS record_count
FROM fact_machine_reading
UNION ALL
SELECT
    'Process Temperature (K)',
    MIN(process_temperature_k),
    MAX(process_temperature_k),
    ROUND(AVG(process_temperature_k), 2),
    COUNT(*)
FROM fact_machine_reading
UNION ALL
SELECT
    'Rotational Speed (RPM)',
    MIN(rotational_speed_rpm),
    MAX(rotational_speed_rpm),
    ROUND(AVG(rotational_speed_rpm), 0),
    COUNT(*)
FROM fact_machine_reading
UNION ALL
SELECT
    'Torque (Nm)',
    MIN(torque_nm),
    MAX(torque_nm),
    ROUND(AVG(torque_nm), 2),
    COUNT(*)
FROM fact_machine_reading
UNION ALL
SELECT
    'Tool Wear (min)',
    MIN(tool_wear_min),
    MAX(tool_wear_min),
    ROUND(AVG(tool_wear_min), 0),
    COUNT(*)
FROM fact_machine_reading
UNION ALL
SELECT
    'Power (W)',
    ROUND(MIN(power_w), 2),
    ROUND(MAX(power_w), 2),
    ROUND(AVG(power_w), 2),
    COUNT(*)
FROM fact_machine_reading;

-- ============================================================
-- DONE
-- ============================================================
-- Schema created successfully.
-- Run etl_pipeline.py to load data from ai4i2020.csv
-- ============================================================
