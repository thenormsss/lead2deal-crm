import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import Modal from '../components/Modal';
import api from '../api/axios';
import { useToast } from '../context/ToastContext';

const LEAD_SOURCES = ['Facebook', 'Website', 'Referral', 'TV', 'Walk-in', 'YouTube'];
const STATUSES = ['Active', 'Inactive', 'Invalid'];
const PH_PHONE_LENGTH = 11; // 09XXXXXXXXX

// Builds up a valid PH mobile number character-by-character as the user types:
// only digits allowed, must start with "0" then "9", capped at 11 digits total.
// Any character that would break that pattern is simply skipped/blocked.
function sanitizePhoneInput(raw) {
  const digits = raw.replace(/\D/g, '');
  let result = '';
  for (let i = 0; i < digits.length && result.length < PH_PHONE_LENGTH; i++) {
    const nextChar = digits[i];
    if (result.length === 0 && nextChar !== '0') continue; // must start with 0
    if (result.length === 1 && nextChar !== '9') continue; // second digit must be 9
    result += nextChar;
  }
  return result;
}

export default function Leads() {
  const [sellers, setSellers] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', email: '', lead_source: '' });
  const [editing, setEditing] = useState(null); // seller object being edited
  const { showToast } = useToast();

  function loadSellers() {
    api.get('/sellers').then((res) => setSellers(res.data));
  }

  useEffect(loadSellers, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.post('/sellers', form);
      setForm({ name: '', phone: '', email: '', lead_source: '' });
      showToast('Lead saved successfully.', 'success');
      loadSellers();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to save lead.', 'error');
    }
  }

  async function handleUpdate(e) {
    e.preventDefault();
    try {
      await api.put(`/sellers/${editing.id}`, editing);
      setEditing(null);
      showToast('Lead/seller info updated.', 'success');
      loadSellers();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update.', 'error');
    }
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="panel">
          <h1 className="panel-title">CREATE LEAD</h1>
          <form className="form-grid" onSubmit={handleCreate} noValidate>
            <div className="form-field">
              <label>NAME</label>
              <input
                placeholder="e.g. Marites N. Hismosa"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={100}
              />
            </div>
            <div className="form-field">
              <label>PHONE</label>
              <input
                placeholder="09123456789"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: sanitizePhoneInput(e.target.value) })}
                maxLength={PH_PHONE_LENGTH}
                inputMode="numeric"
              />
            </div>
            <div className="form-field">
              <label>EMAIL</label>
              <input
                type="email"
                placeholder="marites.hismosa@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                maxLength={150}
              />
            </div>
            <div className="form-field">
              <label>LEAD SOURCE</label>
              <select
                value={form.lead_source}
                onChange={(e) => setForm({ ...form, lead_source: e.target.value })}
              >
                <option value="">Select Lead Source</option>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field form-submit-field">
              <button type="submit" className="btn-yellow">Save Lead</button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header-row">
            <h1 className="panel-title">ALL LEADS &amp; SELLERS</h1>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>NAME</th><th>PHONE</th><th>EMAIL</th><th>LEAD SOURCE</th><th>STATUS</th><th></th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.phone}</td>
                    <td>{s.email}</td>
                    <td>{s.lead_source}</td>
                    <td>{s.status}</td>
                    <td><button className="btn-yellow-sm" onClick={() => setEditing(s)}>Edit Info</button></td>
                  </tr>
                ))}
                {sellers.length === 0 && (
                  <tr><td colSpan={6} className="empty-row">No leads or sellers yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {editing && (
        <Modal title="UPDATE INFO" onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={handleUpdate} noValidate>
            <div className="form-field">
              <label>NAME</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={100} />
            </div>
            <div className="form-field">
              <label>PHONE</label>
              <input
                value={editing.phone}
                onChange={(e) => setEditing({ ...editing, phone: sanitizePhoneInput(e.target.value) })}
                maxLength={PH_PHONE_LENGTH}
                inputMode="numeric"
              />
            </div>
            <div className="form-field">
              <label>EMAIL</label>
              <input
                type="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                maxLength={150}
              />
            </div>
            <div className="form-field">
              <label>LEAD SOURCE</label>
              <select value={editing.lead_source} onChange={(e) => setEditing({ ...editing, lead_source: e.target.value })}>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>STATUS</label>
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field form-submit-field">
              <button type="submit" className="btn-yellow">Update Info</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}










// import { useEffect, useState } from 'react';
// import Sidebar from '../components/Sidebar';
// import Modal from '../components/Modal';
// import api from '../api/axios';
// import { useToast } from '../context/ToastContext';

// const LEAD_SOURCES = ['Facebook', 'Website', 'Referral', 'TV', 'Walk-in', 'YouTube'];
// const STATUSES = ['Active', 'Inactive', 'Invalid'];
// const PH_PHONE_LENGTH = 11; // 09XXXXXXXXX

// // Builds up a valid PH mobile number character-by-character as the user types:
// // only digits allowed, must start with "0" then "9", capped at 11 digits total.
// // Any character that would break that pattern is simply skipped/blocked.
// function sanitizePhoneInput(raw) {
//   const digits = raw.replace(/\D/g, '');
//   let result = '';
//   for (let i = 0; i < digits.length && result.length < PH_PHONE_LENGTH; i++) {
//     const nextChar = digits[i];
//     if (result.length === 0 && nextChar !== '0') continue; // must start with 0
//     if (result.length === 1 && nextChar !== '9') continue; // second digit must be 9
//     result += nextChar;
//   }
//   return result;
// }

// export default function Leads() {
//   const [sellers, setSellers] = useState([]);
//   const [form, setForm] = useState({ name: '', phone: '', email: '', lead_source: '' });
//   const [editing, setEditing] = useState(null); // seller object being edited
//   const { showToast } = useToast();

//   function loadSellers() {
//     api.get('/sellers').then((res) => setSellers(res.data));
//   }

//   useEffect(loadSellers, []);

//   async function handleCreate(e) {
//     e.preventDefault();
//     try {
//       await api.post('/sellers', form);
//       setForm({ name: '', phone: '', email: '', lead_source: '' });
//       showToast('Lead saved successfully.', 'success');
//       loadSellers();
//     } catch (err) {
//       showToast(err.response?.data?.message || 'Failed to save lead.', 'error');
//     }
//   }

//   async function handleUpdate(e) {
//     e.preventDefault();
//     try {
//       await api.put(`/sellers/${editing.id}`, editing);
//       setEditing(null);
//       showToast('Lead/seller info updated.', 'success');
//       loadSellers();
//     } catch (err) {
//       showToast(err.response?.data?.message || 'Failed to update.', 'error');
//     }
//   }

//   return (
//     <div className="app-layout">
//       <Sidebar />
//       <main className="main-content">
//         <div className="panel">
//           <h1 className="panel-title">CREATE SELLLER</h1>
//           <form className="form-grid" onSubmit={handleCreate} noValidate>
//             <div className="form-field">
//               <label>NAME</label>
//               <input
//                 placeholder="e.g. Marites N. Hismosa"
//                 value={form.name}
//                 onChange={(e) => setForm({ ...form, name: e.target.value })}
//                 required
//               />
//             </div>
//             <div className="form-field">
//               <label>PHONE</label>
//               <input
//                 placeholder="09123456789"
//                 value={form.phone}
//                 onChange={(e) => setForm({ ...form, phone: sanitizePhoneInput(e.target.value) })}
//                 maxLength={PH_PHONE_LENGTH}
//                 inputMode="numeric"
//               />
//             </div>
//             <div className="form-field">
//               <label>EMAIL</label>
//               <input
//                 type="email"
//                 placeholder="marites.hismosa@email.com"
//                 value={form.email}
//                 onChange={(e) => setForm({ ...form, email: e.target.value })}
//               />
//             </div>
//             <div className="form-field">
//               <label>LEAD SOURCE</label>
//               <select
//                 value={form.lead_source}
//                 onChange={(e) => setForm({ ...form, lead_source: e.target.value })}
//               >
//                 <option value="">Select Lead Source</option>
//                 {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
//               </select>
//             </div>
//             <div className="form-field form-submit-field">
//               <button type="submit" className="btn-yellow">Save Lead</button>
//             </div>
//           </form>
//         </div>

//         <div className="panel">
//           <div className="panel-header-row">
//             <h1 className="panel-title">ALL SELLERS</h1>
//           </div>
//           <div className="table-scroll">
//             <table className="data-table">
//               <thead>
//                 <tr>
//                   <th>NAME</th><th>PHONE</th><th>EMAIL</th><th>LEAD SOURCE</th><th>STATUS</th><th></th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {sellers.map((s) => (
//                   <tr key={s.id}>
//                     <td>{s.name}</td>
//                     <td>{s.phone}</td>
//                     <td>{s.email || '—'}</td>
//                     <td>{s.lead_source}</td>
//                     <td>{s.status}</td>
//                     <td><button className="btn-yellow-sm" onClick={() => setEditing(s)}>Edit Info</button></td>
//                   </tr>
//                 ))}
//                 {sellers.length === 0 && (
//                   <tr><td colSpan={6} className="empty-row">No leads or sellers yet.</td></tr>
//                 )}
//               </tbody>
//             </table>
//           </div>
//         </div>
//       </main>

//       {editing && (
//         <Modal title="UPDATE INFO" onClose={() => setEditing(null)}>
//           <form className="form-grid" onSubmit={handleUpdate} noValidate>
//             <div className="form-field">
//               <label>NAME</label>
//               <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>PHONE</label>
//               <input
//                 value={editing.phone}
//                 onChange={(e) => setEditing({ ...editing, phone: sanitizePhoneInput(e.target.value) })}
//                 maxLength={PH_PHONE_LENGTH}
//                 inputMode="numeric"
//               />
//             </div>
//             <div className="form-field">
//               <label>EMAIL</label>
//               <input
//                 type="email"
//                 value={editing.email || ''}
//                 onChange={(e) => setEditing({ ...editing, email: e.target.value })}
//               />
//             </div>
//             <div className="form-field">
//               <label>LEAD SOURCE</label>
//               <select value={editing.lead_source} onChange={(e) => setEditing({ ...editing, lead_source: e.target.value })}>
//                 {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>STATUS</label>
//               <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
//                 {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
//               </select>
//             </div>
//             <div className="form-field form-submit-field">
//               <button type="submit" className="btn-yellow">Update Info</button>
//             </div>
//           </form>
//         </Modal>
//       )}
//     </div>
//   );
// }