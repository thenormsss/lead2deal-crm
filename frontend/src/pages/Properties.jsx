import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import Modal from '../components/Modal';
import api from '../api/axios';
import { useToast } from '../context/ToastContext';

const STATES = ['Texas', 'Florida'];
const PROPERTY_TYPES = ['House', 'Apartment', 'Office', 'Shop', 'Hotel', 'Warehouse'];
const CONDITIONS = ['Excellent', 'Good', 'Needs Repairs', 'Bad'];
const STATUSES = ['On Process', 'Complete', 'Cancelled'];

const emptyForm = {
  seller_id: '', property_address: '', state: '', county: '',
  room: '', bathrooms: '', market_value: '', property_type: '', property_condition: ''
};

// What each status change means for the deal's tasks/pipeline, shown as a confirm prompt
// before it happens, since all three are destructive/irreversible to the task list.
const STATUS_CHANGE_WARNINGS = {
  Complete: 'This marks the deal as WON. All tasks for this property will be deleted and the pipeline stage will be set to "Closed - Won". Continue?',
  Cancelled: 'This marks the deal as LOST. All tasks for this property will be deleted and the pipeline stage will be set to "Closed - Lost". Continue?',
  'On Process': 'This reopens the deal. Any existing tasks for this property will be deleted, the pipeline stage will reset to "New Lead", and a fresh "Review Property Info" task will be created. Continue?'
};

export default function Properties() {
  const [properties, setProperties] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [originalStatus, setOriginalStatus] = useState(null);
  const { showToast } = useToast();

  function loadAll() {
    api.get('/properties').then((res) => setProperties(res.data));
    api.get('/properties/sellers-dropdown').then((res) => setSellers(res.data));
  }

  useEffect(loadAll, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.post('/properties', form);
      setForm(emptyForm);
      showToast('Property saved.', 'success');
      loadAll();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to save property.', 'error');
    }
  }

  function openEdit(p) {
    setEditing(p);
    setOriginalStatus(p.status);
  }

  async function handleUpdate(e) {
    e.preventDefault();

    if (editing.status !== originalStatus) {
      const warning = STATUS_CHANGE_WARNINGS[editing.status];
      if (warning && !window.confirm(warning)) return;
    }

    try {
      await api.put(`/properties/${editing.id}`, editing);
      setEditing(null);
      showToast('Property updated.', 'success');
      loadAll();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update property.', 'error');
    }
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="panel">
          <h1 className="panel-title">ADD PROPERTY</h1>
          <form className="form-grid" onSubmit={handleCreate} noValidate>
            <div className="form-field">
              <label>SELLER</label>
              <select value={form.seller_id} onChange={(e) => setForm({ ...form, seller_id: e.target.value })} required>
                <option value="">Select a Seller</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>PROPERTY ADDRESS</label>
              <input placeholder="123 Move on na tayo" value={form.property_address}
                onChange={(e) => setForm({ ...form, property_address: e.target.value })}  maxLength={255} />
            </div>
            <div className="form-field">
              <label>STATE</label>
              <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required>
                <option value="">Select State</option>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>COUNTY</label>
              <input placeholder="Travis County" value={form.county}
                onChange={(e) => setForm({ ...form, county: e.target.value })} required maxLength={100} />
            </div>
            <div className="form-field">
              <label>ROOMS</label>
              <input type="number" min="0" max="100" placeholder="0" value={form.room}
                onChange={(e) => setForm({ ...form, room: e.target.value })} />
            </div>
            <div className="form-field">
              <label>BATHROOMS</label>
              <input type="number" min="0" max="100" placeholder="0" value={form.bathrooms}
                onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} />
            </div>
            <div className="form-field">
              <label>MARKET VALUE</label>
              <input type="number" min="0" max="999999999.99" placeholder="$0" value={form.market_value}
                onChange={(e) => setForm({ ...form, market_value: e.target.value })} />
            </div>
            <div className="form-field">
              <label>PROPERTY TYPE</label>
              <select value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} required>
                <option value="">Select Property Type</option>
                {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>CONDITION</label>
              <select value={form.property_condition} onChange={(e) => setForm({ ...form, property_condition: e.target.value })} required>
                <option value="">Select Property Condition</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-field form-submit-field">
              <button type="submit" className="btn-yellow">Save Property</button>
            </div>
          </form>
        </div>

        <div className="panel">
          <h1 className="panel-title">ALL PROPERTIES</h1>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SELLER</th><th>PRO. ADDRESS</th><th>STATE</th><th>COUNTY</th><th>ROOMS</th>
                  <th>BATHROOMS</th><th>M. VALUE</th><th>TYPE</th><th>CONDITION</th>
                  <th>TEAM</th><th>AGENT</th><th>STAGE</th><th>STATUS</th><th></th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr key={p.id}>
                    <td>{p.seller_name}</td>
                    <td>{p.property_address}</td>
                    <td>{p.state}</td>
                    <td>{p.county}</td>
                    <td>{p.room}</td>
                    <td>{p.bathrooms}</td>
                    <td>${Number(p.market_value).toLocaleString()}</td>
                    <td>{p.property_type}</td>
                    <td>{p.property_condition}</td>
                    <td>{p.team}</td>
                    <td>{p.agent_name}</td>
                    <td>{p.stage || '—'}</td>
                    <td>{p.status}</td>
                    <td><button className="btn-yellow-sm" onClick={() => openEdit(p)}>Edit Property</button></td>
                  </tr>
                ))}
                {properties.length === 0 && (
                  <tr><td colSpan={14} className="empty-row">No properties yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {editing && (
        <Modal title="EDIT PROPERTY" onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={handleUpdate}>
            <div className="form-field">
              <label>SELLER</label>
              <input value={editing.seller_name} disabled />
            </div>
            <div className="form-field">
              <label>PROPERTY ADDRESS</label>
              <input value={editing.property_address} onChange={(e) => setEditing({ ...editing, property_address: e.target.value })} maxLength={255} />
            </div>
            <div className="form-field">
              <label>STATE</label>
              <select value={editing.state} onChange={(e) => setEditing({ ...editing, state: e.target.value })}>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>COUNTY</label>
              <input value={editing.county} onChange={(e) => setEditing({ ...editing, county: e.target.value })} maxLength={100} />
            </div>
            <div className="form-field">
              <label>ROOMS</label>
              <input type="number" min="0" max="100" value={editing.room} onChange={(e) => setEditing({ ...editing, room: e.target.value })} />
            </div>
            <div className="form-field">
              <label>BATHROOMS</label>
              <input type="number" min="0" max="100" value={editing.bathrooms} onChange={(e) => setEditing({ ...editing, bathrooms: e.target.value })} />
            </div>
            <div className="form-field">
              <label>MARKET VALUE</label>
              <input type="number" min="0" max="999999999.99" value={editing.market_value} onChange={(e) => setEditing({ ...editing, market_value: e.target.value })} />
            </div>
            <div className="form-field">
              <label>PROPERTY TYPE</label>
              <select value={editing.property_type} onChange={(e) => setEditing({ ...editing, property_type: e.target.value })}>
                {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>CONDITION</label>
              <select value={editing.property_condition} onChange={(e) => setEditing({ ...editing, property_condition: e.target.value })}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>STATUS</label>
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field form-submit-field">
              <button type="submit" className="btn-yellow">Update Property</button>
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

// const STATES = ['Texas', 'Florida'];
// const PROPERTY_TYPES = ['House', 'Apartment', 'Office', 'Shop', 'Hotel', 'Warehouse'];
// const CONDITIONS = ['Excellent', 'Good', 'Needs Repairs', 'Bad'];
// const STATUSES = ['On Process', 'Complete', 'Cancelled'];

// const emptyForm = {
//   seller_id: '', property_address: '', state: '', county: '',
//   room: '', bathrooms: '', market_value: '', property_type: '', property_condition: ''
// };

// // What each status change means for the deal's tasks/pipeline, shown as a confirm prompt
// // before it happens, since all three are destructive/irreversible to the task list.
// const STATUS_CHANGE_WARNINGS = {
//   Complete: 'This marks the deal as WON. All tasks for this property will be deleted and the pipeline stage will be set to "Closed - Won". Continue?',
//   Cancelled: 'This marks the deal as LOST. All tasks for this property will be deleted and the pipeline stage will be set to "Closed - Lost". Continue?',
//   'On Process': 'This reopens the deal. Any existing tasks for this property will be deleted, the pipeline stage will reset to "New Lead", and a fresh "Review Property Info" task will be created. Continue?'
// };

// export default function Properties() {
//   const [properties, setProperties] = useState([]);
//   const [sellers, setSellers] = useState([]);
//   const [form, setForm] = useState(emptyForm);
//   const [editing, setEditing] = useState(null);
//   const [originalStatus, setOriginalStatus] = useState(null);
//   const { showToast } = useToast();

//   function loadAll() {
//     api.get('/properties').then((res) => setProperties(res.data));
//     api.get('/properties/sellers-dropdown').then((res) => setSellers(res.data));
//   }

//   useEffect(loadAll, []);

//   async function handleCreate(e) {
//     e.preventDefault();
//     try {
//       await api.post('/properties', form);
//       setForm(emptyForm);
//       showToast('Property saved.', 'success');
//       loadAll();
//     } catch (err) {
//       showToast(err.response?.data?.message || 'Failed to save property.', 'error');
//     }
//   }

//   function openEdit(p) {
//     setEditing(p);
//     setOriginalStatus(p.status);
//   }

//   async function handleUpdate(e) {
//     e.preventDefault();

//     if (editing.status !== originalStatus) {
//       const warning = STATUS_CHANGE_WARNINGS[editing.status];
//       if (warning && !window.confirm(warning)) return;
//     }

//     try {
//       await api.put(`/properties/${editing.id}`, editing);
//       setEditing(null);
//       showToast('Property updated.', 'success');
//       loadAll();
//     } catch (err) {
//       showToast(err.response?.data?.message || 'Failed to update property.', 'error');
//     }
//   }

//   return (
//     <div className="app-layout">
//       <Sidebar />
//       <main className="main-content">
//         <div className="panel">
//           <h1 className="panel-title">ADD PROPERTY</h1>
//           <form className="form-grid" onSubmit={handleCreate}>
//             <div className="form-field">
//               <label>SELLER</label>
//               <select value={form.seller_id} onChange={(e) => setForm({ ...form, seller_id: e.target.value })} required>
//                 <option value="">Select a Seller</option>
//                 {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>PROPERTY ADDRESS</label>
//               <input placeholder="123 Move on na tayo" value={form.property_address}
//                 onChange={(e) => setForm({ ...form, property_address: e.target.value })} required />
//             </div>
//             <div className="form-field">
//               <label>STATE</label>
//               <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required>
//                 <option value="">Select State</option>
//                 {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>COUNTY</label>
//               <input placeholder="Travis County" value={form.county}
//                 onChange={(e) => setForm({ ...form, county: e.target.value })} required />
//             </div>
//             <div className="form-field">
//               <label>ROOMS</label>
//               <input type="number" min="0" placeholder="0" value={form.room}
//                 onChange={(e) => setForm({ ...form, room: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>BATHROOMS</label>
//               <input type="number" min="0" placeholder="0" value={form.bathrooms}
//                 onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>MARKET VALUE</label>
//               <input type="number" min="0" placeholder="$0" value={form.market_value}
//                 onChange={(e) => setForm({ ...form, market_value: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>PROPERTY TYPE</label>
//               <select value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} required>
//                 <option value="">Select Property Type</option>
//                 {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>CONDITION</label>
//               <select value={form.property_condition} onChange={(e) => setForm({ ...form, property_condition: e.target.value })} required>
//                 <option value="">Select Property Condition</option>
//                 {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
//               </select>
//             </div>
//             <div className="form-field form-submit-field">
//               <button type="submit" className="btn-yellow">Save Property</button>
//             </div>
//           </form>
//         </div>

//         <div className="panel">
//           <h1 className="panel-title">ALL PROPERTIES</h1>
//           <div className="table-scroll">
//             <table className="data-table">
//               <thead>
//                 <tr>
//                   <th>SELLER</th><th>PRO. ADDRESS</th><th>STATE</th><th>COUNTY</th><th>ROOMS</th>
//                   <th>BATHROOMS</th><th>M. VALUE</th><th>TYPE</th><th>CONDITION</th>
//                   <th>TEAM</th><th>AGENT</th><th>STAGE</th><th>STATUS</th><th></th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {properties.map((p) => (
//                   <tr key={p.id}>
//                     <td>{p.seller_name}</td>
//                     <td>{p.property_address}</td>
//                     <td>{p.state}</td>
//                     <td>{p.county}</td>
//                     <td>{p.room}</td>
//                     <td>{p.bathrooms}</td>
//                     <td>${Number(p.market_value).toLocaleString()}</td>
//                     <td>{p.property_type}</td>
//                     <td>{p.property_condition}</td>
//                     <td>{p.team}</td>
//                     <td>{p.agent_name}</td>
//                     <td>{p.stage || '—'}</td>
//                     <td>{p.status}</td>
//                     <td><button className="btn-yellow-sm" onClick={() => openEdit(p)}>Edit Property</button></td>
//                   </tr>
//                 ))}
//                 {properties.length === 0 && (
//                   <tr><td colSpan={14} className="empty-row">No properties yet.</td></tr>
//                 )}
//               </tbody>
//             </table>
//           </div>
//         </div>
//       </main>

//       {editing && (
//         <Modal title="EDIT PROPERTY" onClose={() => setEditing(null)}>
//           <form className="form-grid" onSubmit={handleUpdate}>
//             <div className="form-field">
//               <label>SELLER</label>
//               <input value={editing.seller_name} disabled />
//             </div>
//             <div className="form-field">
//               <label>PROPERTY ADDRESS</label>
//               <input value={editing.property_address} onChange={(e) => setEditing({ ...editing, property_address: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>STATE</label>
//               <select value={editing.state} onChange={(e) => setEditing({ ...editing, state: e.target.value })}>
//                 {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>COUNTY</label>
//               <input value={editing.county} onChange={(e) => setEditing({ ...editing, county: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>ROOMS</label>
//               <input type="number" min="0" value={editing.room} onChange={(e) => setEditing({ ...editing, room: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>BATHROOMS</label>
//               <input type="number" min="0" value={editing.bathrooms} onChange={(e) => setEditing({ ...editing, bathrooms: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>MARKET VALUE</label>
//               <input type="number" min="0" value={editing.market_value} onChange={(e) => setEditing({ ...editing, market_value: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>PROPERTY TYPE</label>
//               <select value={editing.property_type} onChange={(e) => setEditing({ ...editing, property_type: e.target.value })}>
//                 {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>CONDITION</label>
//               <select value={editing.property_condition} onChange={(e) => setEditing({ ...editing, property_condition: e.target.value })}>
//                 {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>STATUS</label>
//               <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
//                 {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
//               </select>
//             </div>
//             <div className="form-field form-submit-field">
//               <button type="submit" className="btn-yellow">Update Property</button>
//             </div>
//           </form>
//         </Modal>
//       )}
//     </div>
//   );
// }