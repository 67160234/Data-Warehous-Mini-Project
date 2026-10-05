/**
 * AURA-IoT Predictive Maintenance Dashboard
 * Dynamic Analytics, ApexCharts Visualization & Real-time Simulation Engine
 */

// Global State
let isSimulatorRunning = false;
let simulatorInterval = null;
let currentTab = 'tab-overview';
let alertsData = [];
let liveChart = null;
let liveDataPoints = {
  times: [],
  rpm: [],
  torque: [],
  power: []
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initSimulatorButton();
  loadAllData();
});

// Live Clock
function initClock() {
  const clockEl = document.getElementById('liveClock');
  const update = () => {
    const now = new Date();
    clockEl.innerText = now.toTimeString().split(' ')[0] + ' UTC';
  };
  update();
  setInterval(update, 1000);
}

// Tab Switching
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });

  // Re-trigger chart rendering if tab changes
  if (tabId === 'tab-digital-twin' && !liveChart) {
    initLiveStreamChart();
  }
}

// ==================== DATA LOADING ====================
async function loadAllData() {
  try {
    // 1. Fetch KPIs
    const kpis = await fetchApi('/api/kpis', getFallbackKPIs());
    renderKPIs(kpis);

    // 2. Render Safe Operating Envelope (RPM vs Torque Scatter)
    const scatterData = await fetchApi('/api/scatter-envelope', getFallbackScatter());
    renderSafeEnvelopeChart(scatterData);

    // 3. Render Failure Breakdown Donut
    const failureTypes = await fetchApi('/api/failure-types', getFallbackFailureTypes());
    renderFailureBreakdownChart(failureTypes);

    // 4. Render Telemetry Trendline (Air Temp, Process Temp, Delta)
    const trends = await fetchApi('/api/sensor-trends', getFallbackTrends());
    renderThermalTrendChart(trends);

    // 5. Render Product Tier Comparison
    const tiers = await fetchApi('/api/product-comparison', getFallbackTiers());
    renderProductTierChart(tiers);

    // 6. Render Alerts Table
    alertsData = await fetchApi('/api/critical-alerts', getFallbackAlerts());
    renderAlertsTable(alertsData);

  } catch (err) {
    console.warn("Using offline fallback data:", err);
  }
}

async function fetchApi(url, fallback) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return fallback;
  }
}

// ==================== RENDER KPIS ====================
function renderKPIs(kpis) {
  document.getElementById('kpiHealthScore').innerText = `${kpis.health_score || 96.6}%`;
  document.getElementById('kpiHealthBar').style.width = `${kpis.health_score || 96.6}%`;
  document.getElementById('kpiTotalMachines').innerText = Number(kpis.total_machines || 10000).toLocaleString();
  document.getElementById('kpiFailures').innerText = kpis.total_failures || 339;
  document.getElementById('kpiAvgToolWear').innerText = kpis.avg_tool_wear || '108.0';
  document.getElementById('kpiAvgPower').innerText = (kpis.avg_power_w ? (kpis.avg_power_w / 1000).toFixed(2) : '6.28');
}

// ==================== APEX CHARTS ====================

// 1. Safe Operating Envelope Scatter Plot
function renderSafeEnvelopeChart(data) {
  // Group points by failure mode
  const normalPoints = [];
  const hdfPoints = [];
  const pwfPoints = [];
  const osfPoints = [];
  const twfPoints = [];

  data.forEach(item => {
    const pt = [item.rpm, item.torque];
    if (item.failure_type === 'HDF') hdfPoints.push(pt);
    else if (item.failure_type === 'PWF') pwfPoints.push(pt);
    else if (item.failure_type === 'OSF') osfPoints.push(pt);
    else if (item.failure_type === 'TWF') twfPoints.push(pt);
    else if (item.is_fail === 0) normalPoints.push(pt);
  });

  const options = {
    series: [
      { name: 'Normal Operation', data: normalPoints.slice(0, 450) },
      { name: 'Heat Dissipation (HDF)', data: hdfPoints },
      { name: 'Power Failure (PWF)', data: pwfPoints },
      { name: 'Overstrain (OSF)', data: osfPoints },
      { name: 'Tool Wear (TWF)', data: twfPoints }
    ],
    chart: {
      type: 'scatter',
      height: 340,
      background: 'transparent',
      toolbar: { show: true, tools: { zoom: true, reset: true } },
      animations: { enabled: true, speed: 600 }
    },
    colors: ['#38bdf8', '#f43f5e', '#f59e0b', '#a855f7', '#10b981'],
    markers: {
      size: [3, 6, 6, 6, 6],
      strokeWidth: 0,
      hover: { size: 8 }
    },
    theme: { mode: 'dark' },
    xaxis: {
      title: { text: 'Rotational Speed (RPM)', style: { color: '#94a3b8' } },
      labels: { style: { colors: '#94a3b8' } },
      min: 1100,
      max: 2900
    },
    yaxis: {
      title: { text: 'Torque (Nm)', style: { color: '#94a3b8' } },
      labels: { style: { colors: '#94a3b8' } },
      min: 0,
      max: 85
    },
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.05)',
      strokeDashArray: 3
    },
    legend: { show: false },
    tooltip: {
      theme: 'dark',
      y: { formatter: (val) => `${val} Nm` },
      x: { formatter: (val) => `${val} RPM` }
    },
    annotations: {
      yaxis: [
        { y: 65, borderColor: '#f43f5e', strokeDashArray: 4, label: { borderColor: '#f43f5e', style: { color: '#fff', background: '#f43f5e' }, text: 'High Torque Hazard (>65 Nm)' } }
      ]
    }
  };

  const chart = new ApexCharts(document.querySelector("#chartSafeEnvelope"), options);
  chart.render();
}

// 2. Failure Breakdown Donut Chart
function renderFailureBreakdownChart(types) {
  const series = types.map(t => t.occurrences);
  const labels = types.map(t => `${t.failure_code} - ${t.failure_name}`);

  const options = {
    series: series.length ? series : [115, 98, 95, 46, 19],
    labels: labels.length ? labels : ['HDF (Heat Dissipation)', 'OSF (Overstrain)', 'PWF (Power Failure)', 'TWF (Tool Wear)', 'RNF (Random)'],
    chart: {
      type: 'donut',
      height: 280,
      background: 'transparent'
    },
    colors: ['#f43f5e', '#a855f7', '#f59e0b', '#10b981', '#94a3b8'],
    plotOptions: {
      pie: {
        donut: {
          size: '72%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total Failures',
              color: '#94a3b8',
              formatter: () => '373'
            },
            value: {
              color: '#f8fafc',
              fontSize: '22px',
              fontWeight: 700,
              fontFamily: 'JetBrains Mono'
            }
          }
        }
      }
    },
    stroke: { width: 0 },
    theme: { mode: 'dark' },
    dataLabels: { enabled: false },
    legend: { show: false },
    tooltip: {
      theme: 'dark',
      y: { formatter: (val) => `${val} occurrences (${(val/373*100).toFixed(1)}%)` }
    }
  };

  const chart = new ApexCharts(document.querySelector("#chartFailureBreakdown"), options);
  chart.render();
}

// 3. Thermal Trendline Chart
function renderThermalTrendChart(trends) {
  const categories = trends.slice(0, 30).map(t => `UDI #${t.udi}`);
  const airTemps = trends.slice(0, 30).map(t => t.air_temp);
  const procTemps = trends.slice(0, 30).map(t => t.proc_temp);
  const tempDiffs = trends.slice(0, 30).map(t => t.temp_diff);

  const options = {
    series: [
      { name: 'Process Temp [K]', type: 'line', data: procTemps },
      { name: 'Air Temp [K]', type: 'line', data: airTemps },
      { name: 'Thermal Delta (Process - Air) [K]', type: 'area', data: tempDiffs }
    ],
    chart: {
      height: 300,
      type: 'line',
      background: 'transparent',
      toolbar: { show: false }
    },
    colors: ['#f59e0b', '#38bdf8', '#10b981'],
    stroke: { width: [2.5, 2, 1.5], curve: 'smooth' },
    fill: {
      type: ['solid', 'solid', 'gradient'],
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 90, 100] }
    },
    theme: { mode: 'dark' },
    xaxis: {
      categories: categories,
      labels: { style: { colors: '#64748b', fontSize: '10px' } }
    },
    yaxis: [
      {
        title: { text: 'Absolute Temp (K)', style: { color: '#94a3b8' } },
        min: 295,
        max: 312,
        labels: { style: { colors: '#94a3b8' } }
      },
      {
        opposite: true,
        title: { text: 'Delta (K)', style: { color: '#10b981' } },
        min: 0,
        max: 15,
        labels: { style: { colors: '#10b981' } }
      }
    ],
    annotations: {
      yaxis: [
        {
          y: 8.6,
          y2: 0,
          borderColor: '#f43f5e',
          fillColor: '#f43f5e',
          opacity: 0.1,
          label: {
            text: 'Critical HDF Risk Zone (Delta < 8.6 K)',
            style: { color: '#fff', background: '#f43f5e', fontSize: '10px' }
          }
        }
      ]
    },
    grid: { borderColor: 'rgba(255, 255, 255, 0.05)' },
    legend: { position: 'top', labels: { colors: '#94a3b8' } }
  };

  const chart = new ApexCharts(document.querySelector("#chartTempTrend"), options);
  chart.render();
}

// 4. Product Tiers Comparison Chart
function renderProductTierChart(tiers) {
  const labels = tiers.map(t => `${t.quality_label} Quality (${t.product_type})`);
  const failureRates = tiers.map(t => t.failure_rate_pct);
  const totalUnits = tiers.map(t => t.total_readings);

  const options = {
    series: [
      { name: 'Failure Rate (%)', type: 'column', data: failureRates },
      { name: 'Monitored Units', type: 'line', data: totalUnits }
    ],
    chart: {
      height: 300,
      type: 'line',
      background: 'transparent',
      toolbar: { show: false }
    },
    colors: ['#f43f5e', '#38bdf8'],
    plotOptions: {
      bar: { columnWidth: '40%', borderRadius: 6 }
    },
    stroke: { width: [0, 3], curve: 'smooth' },
    theme: { mode: 'dark' },
    xaxis: {
      categories: labels,
      labels: { style: { colors: '#94a3b8' } }
    },
    yaxis: [
      {
        title: { text: 'Failure Rate (%)', style: { color: '#f43f5e' } },
        labels: { style: { colors: '#f43f5e' } },
        min: 0,
        max: 5
      },
      {
        opposite: true,
        title: { text: 'Total Units Monitored', style: { color: '#38bdf8' } },
        labels: { style: { colors: '#38bdf8' } }
      }
    ],
    grid: { borderColor: 'rgba(255, 255, 255, 0.05)' },
    legend: { position: 'top', labels: { colors: '#94a3b8' } }
  };

  const chart = new ApexCharts(document.querySelector("#chartProductTiers"), options);
  chart.render();
}

// ==================== DIGITAL TWIN REAL-TIME STREAM ====================
function initLiveStreamChart() {
  const options = {
    series: [
      { name: 'Rotational Speed (RPM)', data: [1551, 1540, 1535, 1560, 1572, 1550, 1548] },
      { name: 'Power (W / 10)', data: [695, 680, 690, 710, 705, 695, 690] }
    ],
    chart: {
      id: 'realtime',
      height: 180,
      type: 'line',
      background: 'transparent',
      animations: { enabled: true, easing: 'linear', dynamicAnimation: { speed: 800 } },
      toolbar: { show: false }
    },
    colors: ['#38bdf8', '#00f2fe'],
    stroke: { curve: 'smooth', width: 2 },
    grid: { borderColor: 'rgba(255, 255, 255, 0.05)' },
    xaxis: {
      labels: { show: false },
      range: 15
    },
    yaxis: { labels: { style: { colors: '#64748b' } } },
    legend: { position: 'top', labels: { colors: '#94a3b8' } }
  };

  liveChart = new ApexCharts(document.querySelector("#chartLiveStream"), options);
  liveChart.render();
}

function initSimulatorButton() {
  const btn = document.getElementById('toggleSimulatorBtn');
  btn.addEventListener('click', () => {
    isSimulatorRunning = !isSimulatorRunning;
    if (isSimulatorRunning) {
      btn.classList.add('active');
      btn.innerHTML = `<span class="play-icon">⏸</span> Stop Simulator`;
      startSimulation();
      showToast("🟢 Real-time IoT Streaming Simulator Activated");
    } else {
      btn.classList.remove('active');
      btn.innerHTML = `<span class="play-icon">▶</span> Start IoT Simulator`;
      stopSimulation();
      showToast("Simulation Paused");
    }
  });
}

function startSimulation() {
  // If not on digital twin tab, give visual prompt
  simulatorInterval = setInterval(async () => {
    try {
      const packet = await fetchApi('/api/live-stream', generateSimulatedPacket());
      applySimulatedPacket(packet);
    } catch (e) {
      applySimulatedPacket(generateSimulatedPacket());
    }
  }, 1800);
}

function stopSimulation() {
  if (simulatorInterval) {
    clearInterval(simulatorInterval);
    simulatorInterval = null;
  }
}

function applySimulatedPacket(packet) {
  // Update Gauges
  document.getElementById('currentMachineId').innerText = `${packet.product_id} (#${packet.udi})`;
  document.getElementById('currentMachineType').innerText = `Product Grade: ${packet.product_type}`;
  document.getElementById('liveRpm').innerText = Number(packet.rotational_speed_rpm).toLocaleString();
  document.getElementById('liveTorque').innerText = Number(packet.torque_nm).toFixed(1);
  
  const powerKw = (packet.power_w / 1000).toFixed(2);
  document.getElementById('livePower').innerText = powerKw;
  document.getElementById('liveToolWear').innerText = packet.tool_wear_min;
  document.getElementById('liveTempDiff').innerText = Number(packet.temperature_diff_k).toFixed(1);

  // Meter Bar widths
  document.getElementById('barRpm').style.width = `${Math.min(100, (packet.rotational_speed_rpm - 1100) / 18)}%`;
  document.getElementById('barTorque').style.width = `${Math.min(100, (packet.torque_nm / 80) * 100)}%`;
  document.getElementById('barPower').style.width = `${Math.min(100, (packet.power_w / 10000) * 100)}%`;
  document.getElementById('barToolWear').style.width = `${Math.min(100, (packet.tool_wear_min / 250) * 100)}%`;
  document.getElementById('barTempDiff').style.width = `${Math.min(100, (packet.temperature_diff_k / 15) * 100)}%`;

  // Status Indicator
  const isFail = packet.machine_failure === 1;
  const statusCard = document.getElementById('liveStatusCard');
  const icon = document.getElementById('liveStatusIcon');
  const text = document.getElementById('liveStatusText');
  const desc = document.getElementById('liveStatusDesc');

  if (isFail) {
    icon.innerText = "⚠";
    icon.style.background = "rgba(244, 63, 94, 0.25)";
    icon.style.color = "#f43f5e";
    icon.style.boxShadow = "0 0 15px rgba(244, 63, 94, 0.5)";
    text.innerText = "CRITICAL ALERT";
    text.style.color = "#f43f5e";
    desc.innerText = `Mode: ${packet.failure_mode || 'PWF'} (Anomalous Readings)`;
  } else {
    icon.innerText = "✔";
    icon.style.background = "rgba(16, 185, 129, 0.2)";
    icon.style.color = "#10b981";
    icon.style.boxShadow = "0 0 15px rgba(16, 185, 129, 0.3)";
    text.innerText = "HEALTHY";
    text.style.color = "#10b981";
    desc.innerText = "All telemetry within safe envelope";
  }

  // Append to Log
  appendLogEntry(packet);

  // Update Live Chart if initialized
  if (liveChart) {
    liveChart.appendData([
      { data: [packet.rotational_speed_rpm] },
      { data: [Math.round(packet.power_w / 10)] }
    ]);
  }
}

function appendLogEntry(packet) {
  const list = document.getElementById('logStreamList');
  const timeStr = new Date().toTimeString().split(' ')[0];
  const isFail = packet.machine_failure === 1;

  const item = document.createElement('div');
  item.className = `log-entry ${isFail ? 'log-danger' : 'log-normal'}`;
  item.innerHTML = `
    <div style="display:flex; justify-content:space-between;">
      <span class="log-id">UDI #${packet.udi} [${packet.product_id}]</span>
      <span class="log-time">${timeStr}</span>
    </div>
    <span class="log-vals">RPM: ${packet.rotational_speed_rpm} | Torque: ${packet.torque_nm}Nm | P: ${(packet.power_w/1000).toFixed(2)}kW | Wear: ${packet.tool_wear_min}m</span>
    <div>
      <span class="log-badge ${isFail ? 'badge-danger' : 'badge-success'}">${isFail ? 'FAIL: ' + packet.failure_mode : 'OK'}</span>
    </div>
  `;

  list.insertBefore(item, list.firstChild);
  if (list.children.length > 25) {
    list.removeChild(list.lastChild);
  }
}

function clearLiveLog() {
  document.getElementById('logStreamList').innerHTML = '';
}

// ==================== ALERTS TABLE & WORK ORDER MODAL ====================
function renderAlertsTable(alerts) {
  const tbody = document.getElementById('alertsTableBody');
  document.getElementById('alertCountBadge').innerText = alerts.length;
  tbody.innerHTML = '';

  alerts.forEach(item => {
    const tr = document.createElement('tr');
    
    // AI Recommendation logic based on failure modes or sensor values
    let recommendation = "Perform routine check";
    let badgeClass = "badge-med";
    let severity = "Medium";

    if (item.failure_modes && item.failure_modes.includes('HDF')) {
      recommendation = "Cooling anomaly detected (ΔT < 8.6K). Check coolant fluid & radiator fan.";
      badgeClass = "badge-crit";
      severity = "Critical";
    } else if (item.failure_modes && item.failure_modes.includes('PWF')) {
      recommendation = "Drive motor power surge/sag. Inspect spindle drive inverter & VFD voltage.";
      badgeClass = "badge-crit";
      severity = "Critical";
    } else if (item.failure_modes && item.failure_modes.includes('OSF')) {
      recommendation = "Severe cutting torque overload. Reduce spindle feed-rate by 15% immediately.";
      badgeClass = "badge-high";
      severity = "High";
    } else if (item.failure_modes && item.failure_modes.includes('TWF')) {
      recommendation = "Cutting tool wear reached critical limit (>200 min). Dispatch replacement blade.";
      badgeClass = "badge-high";
      severity = "High";
    } else if (item.tool_wear_min >= 210) {
      recommendation = "Pre-emptive Tool Wear alert. Tool blade replacement scheduled for next shift.";
      badgeClass = "badge-high";
      severity = "High";
    }

    tr.innerHTML = `
      <td><strong>#${item.udi}</strong></td>
      <td><span class="text-accent">${item.product_id}</span></td>
      <td><span class="tag-type tag-${(item.product_type || 'M').toLowerCase()}">${item.product_type}</span></td>
      <td>${item.rotational_speed_rpm} RPM / ${item.torque_nm} Nm</td>
      <td>${(item.power_w / 1000).toFixed(2)} kW</td>
      <td><span class="${item.tool_wear_min > 200 ? 'text-danger font-bold' : ''}">${item.tool_wear_min} min</span></td>
      <td><span class="${item.temperature_diff_k < 8.6 ? 'text-danger font-bold' : ''}">${item.temperature_diff_k} K</span></td>
      <td><strong>${item.failure_modes || 'Threshold Risk'}</strong></td>
      <td><span class="${badgeClass}">${severity}</span></td>
      <td style="max-width: 280px; font-size: 0.78rem; color: #94a3b8;">${recommendation}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="openWorkOrderModal('${item.product_id}', '${item.product_type}', '${item.failure_modes || 'Sensor Anomaly'}', '${recommendation.replace(/'/g, "\\'")}')">
          Create WO
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAlerts() {
  const query = document.getElementById('alertSearchInput').value.toLowerCase();
  const mode = document.getElementById('alertFilterMode').value;

  const filtered = alertsData.filter(item => {
    const matchQuery = item.product_id.toLowerCase().includes(query) ||
                       String(item.udi).includes(query) ||
                       (item.product_type && item.product_type.toLowerCase().includes(query));
    
    const matchMode = (mode === 'ALL') || 
                      (item.failure_modes && item.failure_modes.includes(mode));
    
    return matchQuery && matchMode;
  });

  renderAlertsTable(filtered);
}

// Modal Handlers
function openWorkOrderModal(productId, grade, modes, recommendation) {
  document.getElementById('modalMachineId').innerText = productId;
  document.getElementById('modalGrade').innerText = grade;
  document.getElementById('modalFailureModes').innerText = modes;
  document.getElementById('modalRecommendation').innerText = recommendation;
  document.getElementById('workOrderModal').classList.add('open');
}

function closeModal() {
  document.getElementById('workOrderModal').classList.remove('open');
}

function submitWorkOrder(e) {
  e.preventDefault();
  const id = document.getElementById('modalMachineId').innerText;
  closeModal();
  showToast(`✅ Work Order #WO-2026-${Math.floor(1000 + Math.random() * 9000)} created for Machine ${id}!`);
}

function showToast(msg) {
  const toast = document.getElementById('toastBox');
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ==================== FALLBACK DATA GENERATORS ====================
function getFallbackKPIs() {
  return {
    total_machines: 10000,
    total_failures: 339,
    health_score: 96.6,
    avg_tool_wear: 108.0,
    avg_power_w: 6279.74,
    imminent_failures: 24
  };
}

function getFallbackFailureTypes() {
  return [
    { failure_code: 'HDF', failure_name: 'Heat Dissipation Failure', severity_level: 'High', occurrences: 115 },
    { failure_code: 'OSF', failure_name: 'Overstrain Failure', severity_level: 'High', occurrences: 98 },
    { failure_code: 'PWF', failure_name: 'Power Failure', severity_level: 'Critical', occurrences: 95 },
    { failure_code: 'TWF', failure_name: 'Tool Wear Failure', severity_level: 'Medium', occurrences: 46 },
    { failure_code: 'RNF', failure_name: 'Random Failure', severity_level: 'Low', occurrences: 19 }
  ];
}

function getFallbackTiers() {
  return [
    { product_type: 'L', quality_label: 'Low', total_readings: 6000, total_failures: 235, failure_rate_pct: 3.92 },
    { product_type: 'M', quality_label: 'Medium', total_readings: 2997, total_failures: 83, failure_rate_pct: 2.77 },
    { product_type: 'H', quality_label: 'High', total_readings: 1003, total_failures: 21, failure_rate_pct: 2.09 }
  ];
}

function getFallbackScatter() {
  const sample = [];
  for (let i = 0; i < 300; i++) {
    const rpm = 1200 + Math.floor(Math.random() * 1400);
    const torque = 15 + Math.random() * 55;
    sample.push({ rpm, torque, is_fail: 0, failure_type: 'NORMAL' });
  }
  // Add some failures
  for (let i = 0; i < 25; i++) {
    sample.push({ rpm: 1300 + Math.random() * 100, torque: 58 + Math.random() * 18, is_fail: 1, failure_type: 'HDF' });
    sample.push({ rpm: 2500 + Math.random() * 300, torque: 10 + Math.random() * 15, is_fail: 1, failure_type: 'PWF' });
    sample.push({ rpm: 1200 + Math.random() * 200, torque: 65 + Math.random() * 12, is_fail: 1, failure_type: 'OSF' });
  }
  return sample;
}

function getFallbackTrends() {
  const trends = [];
  for (let i = 1; i <= 30; i++) {
    const air = 298.0 + Math.sin(i / 5) * 1.5;
    const proc = air + 8.2 + Math.cos(i / 4) * 2.2;
    trends.push({
      udi: i,
      air_temp: Number(air.toFixed(1)),
      proc_temp: Number(proc.toFixed(1)),
      temp_diff: Number((proc - air).toFixed(1))
    });
  }
  return trends;
}

function getFallbackAlerts() {
  return [
    { udi: 78, product_id: 'L47257', product_type: 'L', rotational_speed_rpm: 1282, torque_nm: 60.7, power_w: 8149, tool_wear_min: 215, temperature_diff_k: 8.4, failure_modes: 'HDF, TWF' },
    { udi: 161, product_id: 'L47340', product_type: 'L', rotational_speed_rpm: 1290, torque_nm: 68.2, power_w: 9212, tool_wear_min: 198, temperature_diff_k: 8.3, failure_modes: 'PWF, HDF' },
    { udi: 228, product_id: 'M15087', product_type: 'M', rotational_speed_rpm: 1342, torque_nm: 65.4, power_w: 9191, tool_wear_min: 220, temperature_diff_k: 8.1, failure_modes: 'OSF, PWF' },
    { udi: 341, product_id: 'L47520', product_type: 'L', rotational_speed_rpm: 1410, torque_nm: 52.8, power_w: 7795, tool_wear_min: 234, temperature_diff_k: 9.1, failure_modes: 'TWF' },
    { udi: 420, product_id: 'H29839', product_type: 'H', rotational_speed_rpm: 2750, torque_nm: 12.3, power_w: 3540, tool_wear_min: 180, temperature_diff_k: 8.5, failure_modes: 'PWF' },
    { udi: 569, product_id: 'L47748', product_type: 'L', rotational_speed_rpm: 1305, torque_nm: 62.1, power_w: 8486, tool_wear_min: 218, temperature_diff_k: 8.2, failure_modes: 'HDF, OSF' }
  ];
}

function generateSimulatedPacket() {
  const isAnomaly = Math.random() < 0.15;
  const rpm = isAnomaly ? (Math.random() < 0.5 ? 1220 : 2780) : 1450 + Math.floor(Math.random() * 200);
  const torque = isAnomaly ? 65 + Math.random() * 10 : 35 + Math.random() * 15;
  const power = torque * rpm * 2 * Math.PI / 60;
  const wear = Math.floor(Math.random() * 230);
  const diff = isAnomaly ? 8.1 + Math.random() * 0.4 : 9.5 + Math.random() * 2.0;

  return {
    udi: Math.floor(1 + Math.random() * 10000),
    product_id: 'M' + Math.floor(10000 + Math.random() * 90000),
    product_type: ['L', 'M', 'H'][Math.floor(Math.random() * 3)],
    rotational_speed_rpm: rpm,
    torque_nm: Number(torque.toFixed(1)),
    power_w: Number(power.toFixed(2)),
    tool_wear_min: wear,
    temperature_diff_k: Number(diff.toFixed(1)),
    machine_failure: isAnomaly ? 1 : 0,
    failure_mode: isAnomaly ? ['HDF', 'PWF', 'OSF', 'TWF'][Math.floor(Math.random() * 4)] : 'NORMAL'
  };
}
