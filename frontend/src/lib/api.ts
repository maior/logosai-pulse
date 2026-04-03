const API_URL = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

export async function fetchDashboard(period = '24h') {
  const res = await fetch(`${API_URL}/api/v1/dashboard?period=${period}`, { cache: 'no-store' });
  return res.json();
}

export async function fetchTraces(period = '24h', limit = 50) {
  const res = await fetch(`${API_URL}/api/v1/traces?period=${period}&limit=${limit}`, { cache: 'no-store' });
  return res.json();
}

export async function fetchTraceDetail(id: string) {
  const res = await fetch(`${API_URL}/api/v1/traces/${id}`, { cache: 'no-store' });
  return res.json();
}
