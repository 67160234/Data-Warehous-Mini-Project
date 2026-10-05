# 📋 Project Detail — Smart Predictive Maintenance Platform (AI + IoT)

> ระบบตรวจสอบสภาพเครื่องจักรและคาดการณ์การซ่อมบำรุงล่วงหน้าสำหรับโรงงานอุตสาหกรรมอัจฉริยะ (Industry 4.0)

---

## 1. 📌 ภาพรวมโปรเจกต์ (Project Overview)

โปรเจกต์นี้มีเป้าหมายเพื่อนำข้อมูลเซนเซอร์ IoT จากเครื่องจักรในสายการผลิตมาจัดเก็บในระบบ **Data Warehouse (Star Schema)** และนำเสนอผ่าน **Interactive Predictive Maintenance Dashboard** เพื่อช่วย:
1. **ลด Downtime:** แจ้งเตือนความผิดปกติของเครื่องจักรก่อนที่เครื่องจะหยุดทำงานกะทันหัน
2. **ลดค่าใช้จ่ายซ่อมบำรุง:** เปลี่ยนจากการซ่อมเมื่อเสีย (Corrective) มาเป็นการซ่อมเชิงคาดการณ์ (Predictive)
3. **ยืดอายุการใช้งานเครื่องมือ:** ติดตามการสึกหรอของหัวเจาะ/หัวกัด (Tool Wear) และวางแผนเปลี่ยนอะไหล่ได้ทันท่วงที

---

## 2. 📊 ข้อมูลและสถาปัตยกรรม (Data & Data Warehouse)

### 2.1 แหล่งข้อมูล (Source Dataset: `ai4i2020.csv`)
ชุดข้อมูลจำลองสภาพเครื่องจักรอุตสาหกรรมจริง มีทั้งหมด **10,000 แถว 14 คอลัมน์** (ไม่มีค่า Null):

| คอลัมน์ | ประเภท | คำอธิบาย |
|---|---|---|
| `UDI` / `Product ID` | Identifier | รหัสระบุเครื่องจักรและหมายเลขชิ้นงาน |
| `Type` | Categorical | เกรดคุณภาพสินค้า: **L** (Low - 60%), **M** (Medium - 30%), **H** (High - 10%) |
| `Air temperature [K]` | Sensor | อุณหภูมิอากาศโดยรอบ ($295.3 - 304.5\text{ K}$) |
| `Process temperature [K]` | Sensor | อุณหภูมิระหว่างการผลิต ($305.7 - 313.8\text{ K}$) |
| `Rotational speed [rpm]` | Sensor | ความเร็วรอบหมุนของแกนหมุน ($1,168 - 2,886\text{ RPM}$) |
| `Torque [Nm]` | Sensor | แรงบิดในการตัดเฉือน ($3.8 - 76.6\text{ Nm}$) |
| `Tool wear [min]` | Sensor | ระยะเวลาการสึกหรอสะสมของหัวเครื่องมือ ($0 - 253\text{ นาที}$) |
| `Machine failure` | Target | สถานะเครื่องเสีย: **0 (ปกติ 96.6%)**, **1 (ชำรุด 3.4%)** |

### 2.2 โหมดความล้มเหลว 5 รูปแบบ (Failure Modes)
* **HDF (Heat Dissipation Failure - 115 ครั้ง):** การระบายความร้อนล้มเหลว เกิดเมื่อผลต่างอุณหภูมิ $\Delta T < 8.6\text{ K}$ ร่วมกับความเร็วรอบ $< 1,380\text{ RPM}$
* **OSF (Overstrain Failure - 98 ครั้ง):** ภาระงานเกินกำลัง เกิดจากผลคูณของ Tool Wear กับ Torque เกินค่าจำกัด
* **PWF (Power Failure - 95 ครั้ง):** กำลังไฟฟ้าอยู่นอกช่วงปลอดภัย ($< 3,500\text{ W}$ หรือ $> 9,000\text{ W}$)
* **TWF (Tool Wear Failure - 46 ครั้ง):** หัวเครื่องมือสึกหรอจนถึงขีดจำกัด ($> 200\text{ นาที}$)
* **RNF (Random Failure - 19 ครั้ง):** ความล้มเหลวแบบสุ่มจากปัจจัยภายนอก (0.1% โอกาสเกิด)

### 2.3 สถาปัตยกรรม Data Warehouse (Star Schema)
* **Fact Table (`fact_machine_reading`):** เก็บค่าเซนเซอร์ พร้อมคำนวณค่าวัดใหม่ใน ETL:
  * `temperature_diff_k` = อุณหภูมิ Process ลบ อุณหภูมิ Air
  * `power_w` = กำลังคำนวณจากสูตร $\text{Torque} \times \text{RPM} \times \frac{2\pi}{60}$
* **Dimension Tables:**
  * `dim_product` (ข้อมูลชิ้นงานและเกรดคุณภาพ L, M, H)
  * `dim_failure_type` (ประเภทความเสียหาย ระดับความรุนแรง)
  * `dim_date` / `dim_time` (รองรับมิติเวลาสำหรับการสตรีม IoT)
* **Bridge Table (`bridge_reading_failure`):** รองรับความสัมพันธ์แบบ Many-to-Many สำหรับเครื่องจักรที่เกิดอาการเสียหลายประเภทพร้อมกัน

---

## 3. 🖥️ หน้า Dashboard และฟังก์ชันการทำงาน

Dashboard ถูกพัฒนาด้วยเทคโนโลยีเว็บสมัยใหม่ **(HTML5 + Vanilla CSS + JavaScript ApexCharts + Python Local API Server)** ในธีม **Cyber-Industrial Dark Mode (Glassmorphism)** ประกอบด้วย 3 ส่วนหลัก:

### 3.1 แถบสรุปภาพรวม (Executive KPI Cards)
* **Fleet Health Index (96.61%):** ดัชนีความพร้อมใช้งานของเครื่องจักรทั้งโรงงาน
* **Active Machines (10,000 เครื่อง):** แสดงสัดส่วนเครื่องจักรตามเกรด L / M / H
* **Anomalies & Failures (339 เครื่อง):** จำนวนเครื่องที่มีความผิดปกติ พร้อมตัวเลขคาดการณ์ความเสี่ยงล่วงหน้า
* **Avg Tool Wear (108 นาที):** การสึกหรอเฉลี่ย พร้อมแถบเตือนก่อนแตะเกณฑ์วิกฤตที่ 200 นาที
* **Fleet Power Load (6.28 kW):** ค่าเฉลี่ยกำลังไฟฟ้าของเครื่องจักรในระบบ

### 3.2 แท็บ 1: Executive Overview & Safe Operating Envelope
* **Safe Operating Envelope (Scatter Plot):** กราฟกระจายตัวระหว่าง RPM และ Torque จำแนกสีตามประเภทความผิดปกติ (HDF, PWF, OSF, TWF) ช่วยให้เห็นจุดทำงานที่ปลอดภัยและจุดเสี่ยงหลุดกรอบ
* **Failure Mode Breakdown (Donut Chart):** แผนภูมิวงแหวนแสดงสัดส่วนสาเหตุการชำรุด พร้อมการแบ่งกลุ่มความรุนแรง (Critical / High / Medium / Low)
* **Thermal Sensor Trendline (Dual-Axis Chart):** กราฟแนวโน้มอุณหภูมิเปรียบเทียบ Process Temp และ Air Temp พร้อมไฮไลต์เส้นเตือนสีแดงเมื่อ $\Delta T < 8.6\text{ K}$
* **Quality Tier Failure Rate (Bar Chart):** เปรียบเทียบอัตราการเสียของสินค้าเกรด L (3.92%), M (2.77%), H (2.09%)

### 3.3 แท็บ 2: Real-time Digital Twin & IoT Simulator
* **Live Telemetry Gauges:** หน้าปัดแสดงผลสดแบบดิจิทัล (ความเร็วรอบ, แรงบิด, กำลังไฟฟ้า, การสึกหรอ, ผลต่างความร้อน)
* **AI Machine State:** ไฟสถานะสีเขียว (HEALTHY) หรือสีแดง (CRITICAL ALERT) เมื่อค่าหลุดกรอบ
* **Live Sensor Waveform & Ingestion Log:** แสดงกราฟคลื่นสัญญาณและบันทึกแพ็กเก็ตข้อมูลเซนเซอร์ที่ส่งเข้ามาแบบ Real-time (เปิด-ปิดการจำลองได้ด้วยปุ่ม *Start IoT Simulator*)

### 3.4 แท็บ 3: AI Early-Warning & Maintenance Work Orders
* **Actionable Alerts Table:** ตารางรวมรายการเครื่องจักรที่มีความเสี่ยงสูง สามารถค้นหาและกรองตามประเภทความเสียหายได้
* **AI Recommendation Engine:** ระบบวิเคราะห์แนะนำแนวทางแก้ไขตามสาเหตุ เช่น แนะนำตรวจเช็กพัดลมระบายความร้อน (HDF), ตรวจสอบมอเตอร์ขับ (PWF), หรือสั่งเปลี่ยนใบมีดตัด (TWF)
* **Dispatch Work Order Modal:** หน้าต่างเปิดใบสั่งงานซ่อมบำรุงไปยังทีมช่าง (Team Alpha / Beta / Gamma) และกำหนดระดับความเร่งด่วน

---

## 4. 🚀 วิธีการเปิดใช้งาน (How to Run)

### วิธีที่ 1: ดับเบิ้ลคลิกไฟล์รันอัตโนมัติ (แนะนำบน Windows)
ดับเบิ้ลคลิกที่ไฟล์:
```
start_dashboard.bat
```
*(ระบบจะเปิด Server และเปิด Browser ไปยัง `http://localhost:8080` ให้โดยอัตโนมัติ)*

### วิธีที่ 2: รันผ่าน Command Line
1. **รัน ETL Pipeline เพื่อสร้าง/อัปเดต Data Warehouse (ถ้าต้องการโหลดข้อมูลใหม่):**
   ```powershell
   python -X utf8 data_warehouse\etl_pipeline.py
   ```
2. **รัน Dashboard Server:**
   ```powershell
   python -X utf8 dashboard\server.py
   ```
3. **เปิดเว็บเบราว์เซอร์ไปที่:**
   ```
   http://localhost:8080
   ```
