import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import api from '../api/axios';

export default function Logs() {
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    api.get('/activities').then((res) => setActivities(res.data));
  }, []);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="panel">
          <h1 className="panel-title">ACTIVITY LOGS</h1>
          <div className="table-scroll">
            <table className="data-table bordered">
              <thead>
                <tr><th>DATE &amp; TIME</th><th>ACTIVITY</th><th>PERFORMED BY</th></tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id}>
                    <td>{a.activity_date} - {a.activity_time}</td>
                    <td>{a.activity}</td>
                    <td>{a.performed_by}</td>
                  </tr>
                ))}
                {activities.length === 0 && (
                  <tr><td colSpan={3} className="empty-row">No activity recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
