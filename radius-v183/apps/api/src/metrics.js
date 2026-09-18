function escapeLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

export class MetricsRegistry {
  constructor() {
    this.requests = new Map();
  }

  observe({ method, route, statusCode, durationSeconds }) {
    const normalizedRoute = route || "unmatched";
    const key = `${method}\u0000${normalizedRoute}\u0000${statusCode}`;
    const metric = this.requests.get(key) ?? { method, route: normalizedRoute, statusCode, count: 0, duration: 0 };
    metric.count += 1;
    metric.duration += durationSeconds;
    this.requests.set(key, metric);
  }

  render(extra = {}) {
    const lines = [
      "# HELP uchiha_radius_http_requests_total Total HTTP requests.",
      "# TYPE uchiha_radius_http_requests_total counter"
    ];
    for (const metric of this.requests.values()) {
      const labels = `method="${escapeLabel(metric.method)}",route="${escapeLabel(metric.route)}",status="${metric.statusCode}"`;
      lines.push(`uchiha_radius_http_requests_total{${labels}} ${metric.count}`);
    }
    lines.push("# HELP uchiha_radius_http_request_duration_seconds Request duration sum.", "# TYPE uchiha_radius_http_request_duration_seconds summary");
    for (const metric of this.requests.values()) {
      const labels = `method="${escapeLabel(metric.method)}",route="${escapeLabel(metric.route)}",status="${metric.statusCode}"`;
      lines.push(`uchiha_radius_http_request_duration_seconds_sum{${labels}} ${metric.duration.toFixed(6)}`);
      lines.push(`uchiha_radius_http_request_duration_seconds_count{${labels}} ${metric.count}`);
    }
    const memory = process.memoryUsage();
    const gauge = (name, help, value) => {
      const numeric = Number(value ?? 0);
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${Number.isFinite(numeric) ? numeric : 0}`);
    };
    gauge("uchiha_radius_process_uptime_seconds", "Node.js process uptime.", process.uptime().toFixed(3));
    gauge("uchiha_radius_process_resident_memory_bytes", "Node.js resident memory size.", memory.rss);
    gauge("uchiha_radius_process_heap_used_bytes", "Node.js heap memory currently used.", memory.heapUsed);
    gauge("uchiha_radius_outbox_pending", "Pending integration jobs.", extra.pendingJobs);
    gauge("uchiha_radius_outbox_failed", "Failed integration jobs requiring retry or review.", extra.failedJobs);
    gauge("uchiha_radius_active_sessions", "Currently active RADIUS sessions.", extra.activeSessions);
    gauge("uchiha_radius_open_critical_alerts", "Open critical alerts.", extra.openCriticalAlerts);
    gauge("uchiha_radius_unhealthy_nodes", "RADIUS nodes degraded, offline or stale.", extra.unhealthyNodes);
    return `${lines.join("\n")}\n`;
  }
}
