"""
Smart Predictive Maintenance Platform — Dashboard Backend Server
Serves static frontend assets and REST API endpoints connected to SQLite Data Warehouse.
Uses only Python standard libraries (no external dependencies needed).
"""

import http.server
import socketserver
import json
import sqlite3
import os
import urllib.parse
from datetime import datetime

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
DB_PATH = os.path.join(PROJECT_DIR, "data_warehouse", "predictive_maintenance_dw.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

class DashboardRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/api/"):
            self.handle_api(path, query)
        else:
            super().do_GET()

    def send_json(self, data, status=200):
        response_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def handle_api(self, path, query):
        try:
            conn = get_db()
            cursor = conn.cursor()

            if path == "/api/kpis":
                # General health KPIs
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_machines,
                        SUM(machine_failure) as total_failures,
                        ROUND(100.0 - (SUM(machine_failure) * 100.0 / COUNT(*)), 2) as health_score,
                        ROUND(AVG(tool_wear_min), 1) as avg_tool_wear,
                        ROUND(AVG(power_w), 1) as avg_power_w,
                        ROUND(AVG(air_temperature_k), 1) as avg_air_temp,
                        ROUND(AVG(process_temperature_k), 1) as avg_proc_temp
                    FROM fact_machine_reading
                """)
                kpi_row = dict(cursor.fetchone())

                # Imminent failures (high tool wear or extreme power/temp)
                cursor.execute("""
                    SELECT COUNT(*) as imminent_count
                    FROM fact_machine_reading
                    WHERE machine_failure = 0 
                      AND (tool_wear_min >= 210 OR power_w > 8800 OR temperature_diff_k < 8.8)
                """)
                kpi_row["imminent_failures"] = cursor.fetchone()["imminent_count"]
                self.send_json(kpi_row)

            elif path == "/api/failure-types":
                cursor.execute("""
                    SELECT 
                        ft.failure_code,
                        ft.failure_name,
                        ft.severity_level,
                        COUNT(bf.bridge_id) as occurrences,
                        ROUND(COUNT(bf.bridge_id) * 100.0 / 373.0, 1) as percentage
                    FROM dim_failure_type ft
                    LEFT JOIN bridge_reading_failure bf ON ft.failure_type_key = bf.failure_type_key
                    GROUP BY ft.failure_type_key
                    ORDER BY occurrences DESC
                """)
                rows = [dict(r) for r in cursor.fetchall()]
                self.send_json(rows)

            elif path == "/api/product-comparison":
                cursor.execute("""
                    SELECT 
                        product_type,
                        quality_label,
                        total_readings,
                        total_failures,
                        failure_rate_pct,
                        avg_air_temp,
                        avg_process_temp,
                        avg_rpm,
                        avg_torque,
                        avg_tool_wear
                    FROM v_product_failure_rate
                    ORDER BY product_type ASC
                """)
                rows = [dict(r) for r in cursor.fetchall()]
                self.send_json(rows)

            elif path == "/api/scatter-envelope":
                # Sample 800 normal points + all failure points for crisp visualization
                cursor.execute("""
                    SELECT 
                        f.rotational_speed_rpm as rpm,
                        f.torque_nm as torque,
                        f.power_w as power,
                        f.tool_wear_min as tool_wear,
                        f.machine_failure as is_fail,
                        COALESCE(ft.failure_code, 'NORMAL') as failure_type,
                        p.product_type
                    FROM fact_machine_reading f
                    JOIN dim_product p ON f.product_key = p.product_key
                    LEFT JOIN bridge_reading_failure bf ON f.reading_id = bf.reading_id
                    LEFT JOIN dim_failure_type ft ON bf.failure_type_key = ft.failure_type_key
                    WHERE f.machine_failure = 1
                    UNION ALL
                    SELECT 
                        f.rotational_speed_rpm as rpm,
                        f.torque_nm as torque,
                        f.power_w as power,
                        f.tool_wear_min as tool_wear,
                        0 as is_fail,
                        'NORMAL' as failure_type,
                        p.product_type
                    FROM fact_machine_reading f
                    JOIN dim_product p ON f.product_key = p.product_key
                    WHERE f.machine_failure = 0 AND (f.reading_id % 12 = 0)
                """)
                rows = [dict(r) for r in cursor.fetchall()]
                self.send_json(rows)

            elif path == "/api/sensor-trends":
                # First 120 readings chronological sequence to show continuous telemetry
                cursor.execute("""
                    SELECT 
                        udi,
                        air_temperature_k as air_temp,
                        process_temperature_k as proc_temp,
                        temperature_diff_k as temp_diff,
                        rotational_speed_rpm as rpm,
                        torque_nm as torque,
                        power_w as power,
                        tool_wear_min as tool_wear,
                        machine_failure
                    FROM fact_machine_reading
                    WHERE udi <= 120
                    ORDER BY udi ASC
                """)
                rows = [dict(r) for r in cursor.fetchall()]
                self.send_json(rows)

            elif path == "/api/critical-alerts":
                cursor.execute("""
                    SELECT 
                        f.reading_id,
                        f.udi,
                        p.product_id,
                        p.product_type,
                        p.quality_label,
                        f.air_temperature_k,
                        f.process_temperature_k,
                        f.temperature_diff_k,
                        f.rotational_speed_rpm,
                        f.torque_nm,
                        f.power_w,
                        f.tool_wear_min,
                        f.machine_failure,
                        GROUP_CONCAT(ft.failure_code, ', ') as failure_modes,
                        GROUP_CONCAT(ft.severity_level, ', ') as severities
                    FROM fact_machine_reading f
                    JOIN dim_product p ON f.product_key = p.product_key
                    LEFT JOIN bridge_reading_failure bf ON f.reading_id = bf.reading_id
                    LEFT JOIN dim_failure_type ft ON bf.failure_type_key = ft.failure_type_key
                    WHERE f.machine_failure = 1 OR f.tool_wear_min >= 210 OR f.power_w > 8500
                    GROUP BY f.reading_id
                    ORDER BY f.machine_failure DESC, f.tool_wear_min DESC
                    LIMIT 25
                """)
                rows = [dict(r) for r in cursor.fetchall()]
                self.send_json(rows)

            elif path == "/api/live-stream":
                # Pick a random or sequential reading for IoT simulation
                import random
                offset = random.randint(1, 9900)
                cursor.execute("""
                    SELECT 
                        f.reading_id,
                        f.udi,
                        p.product_id,
                        p.product_type,
                        f.air_temperature_k,
                        f.process_temperature_k,
                        f.temperature_diff_k,
                        f.rotational_speed_rpm,
                        f.torque_nm,
                        f.power_w,
                        f.tool_wear_min,
                        f.machine_failure,
                        COALESCE(ft.failure_code, 'NORMAL') as failure_mode
                    FROM fact_machine_reading f
                    JOIN dim_product p ON f.product_key = p.product_key
                    LEFT JOIN bridge_reading_failure bf ON f.reading_id = bf.reading_id
                    LEFT JOIN dim_failure_type ft ON bf.failure_type_key = ft.failure_type_key
                    LIMIT 1 OFFSET ?
                """, (offset,))
                row = cursor.fetchone()
                self.send_json(dict(row) if row else {})

            else:
                self.send_json({"error": "Endpoint not found"}, status=404)

            conn.close()
        except Exception as e:
            self.send_json({"error": str(e)}, status=500)

def run():
    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), DashboardRequestHandler) as httpd:
        print(f"==================================================")
        print(f"🏭 Smart Predictive Maintenance Dashboard Server")
        print(f"🌐 Running at: http://localhost:{PORT}")
        print(f"📁 Serving:    {BASE_DIR}")
        print(f"💾 Connected:  {DB_PATH}")
        print(f"==================================================")
        httpd.serve_forever()

if __name__ == "__main__":
    run()
