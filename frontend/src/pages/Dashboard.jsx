import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Sidebar from '../components/Sidebar';
import api from '../api/axios';

const EMPTY_STATS = {
  newLeads: 0, qualify: 0, appointments: 0, offers: 0, contracts: 0, closedDeals: 0, leadSourceBreakdown: []
};

export default function Dashboard() {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard')
      .then((res) => setStats(res.data))
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    { label: "TODAY'S LEADS", value: stats.newLeads },
    // { label: 'QUALIFIES', value: stats.qualify },
    // { label: 'APPOINTMENTS', value: stats.appointments },
    { label: 'OFFERS', value: stats.offers },
    { label: 'CONTRACTS', value: stats.contracts },
    { label: 'WON DEALS', value: stats.closedDeals }
  ];

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="panel">
          <div className="dashboard-grid">
            {cards.map((c) => (
              <div className="dashboard-card" key={c.label}>
                <div className="dashboard-number">{loading ? '—' : c.value}</div>
                <div className="dashboard-label">{c.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* <div className="panel">
          <h1 className="panel-title">LEADS BY SOURCE</h1>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.leadSourceBreakdown} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="source" tick={{ fontSize: 13, fontWeight: 700 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: 'rgba(62,193,240,0.1)' }} />
                <Bar dataKey="count" fill="#3ec1f0" radius={[6, 6, 0, 0]} barSize={48} />
              </BarChart>
            </ResponsiveContainer>
            {!loading && stats.leadSourceBreakdown.length === 0 && (
              <div className="chart-empty">No lead source data yet.</div>
            )}
          </div>
        </div> */}
      </main>
    </div>
  );
}