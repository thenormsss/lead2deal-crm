import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import Modal from '../components/Modal';
import api from '../api/axios';
import { useToast } from '../context/ToastContext';

const GET_PROPERTY_INFO = 'Get Property Info'; // the seller's original acquisition task
const ACQUISITION_TEAM = 'Team Acquisition';

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [properties, setProperties] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [editing, setEditing] = useState(null);
  const { showToast } = useToast();

  function loadAll() {
    api.get('/tasks').then((res) => setTasks(res.data));
    api.get('/properties').then((res) => setProperties(res.data));
    api.get('/employees').then((res) => setEmployees(res.data));
  }

  useEffect(loadAll, []);

  function openEdit(t) {
    setEditing(t);
  }

  // The task can only be reassigned within whichever team already owns it: the property's
  // team (Team Texas / Team Florida), or Team Acquisition for the seller-level
  // "Get Property Info" task that isn't tied to a property yet.
  function requiredTeamFor(t) {
    if (!t.property_id) return ACQUISITION_TEAM;
    const property = properties.find((p) => p.id === t.property_id);
    return property?.team || ACQUISITION_TEAM;
  }

  const eligibleAssignees = editing
    ? employees.filter((e) => e.team === requiredTeamFor(editing))
    : [];

  async function handleUpdate(e) {
    e.preventDefault();
    try {
      // Only date, time, and assigned_to are ever sent — task, related record, and
      // status are locked and always stay whatever they already were.
      await api.put(`/tasks/${editing.id}`, {
        task_date: editing.task_date,
        task_time: editing.task_time,
        assigned_to: editing.assigned_to
      });
      setEditing(null);
      showToast('Task updated.', 'success');
      loadAll();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update task.', 'error');
    }
  }

  async function toggleDone(t) {
    // Un-checking a completed task cascades: it deletes every task created after it in
    // the chain and rolls the pipeline stage back, so confirm before doing it.
    if (t.status === 'Done') {
      const confirmed = window.confirm(
        `Uncheck "${t.task}"? This will delete any tasks that were created after it and roll the pipeline stage back.`
      );
      if (!confirmed) return;
    }
    try {
      await api.put(`/tasks/${t.id}`, { status: t.status === 'Done' ? 'Not Done' : 'Done' });
      loadAll();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update task status.', 'error');
    }
  }

  async function handleDelete(t) {
    const confirmed = window.confirm(`Delete task "${t.task}" for ${t.seller_name}? This can't be undone.`);
    if (!confirmed) return;
    try {
      await api.delete(`/tasks/${t.id}`);
      showToast('Task deleted.', 'success');
      loadAll();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete task.', 'error');
    }
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="panel">
          <h1 className="panel-title">TO DO LIST</h1>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th></th><th>TASK</th><th>RELATED RECORD</th><th>DUE DATE</th><th>DUE TIME</th>
                  <th>ASSIGNED TO</th><th>STATUS</th><th colSpan={1}></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const isGetPropertyInfo = t.task === GET_PROPERTY_INFO;
                  const hasPropertyRecord = properties.some((p) => p.seller_id === t.seller_id);
                  const lockedByProperty = isGetPropertyInfo && hasPropertyRecord;

                  return (
                    <tr key={t.id}>
                      <td>
                        <span
                          className={'task-check' + (t.status === 'Done' ? ' done' : '') + (lockedByProperty ? ' locked' : '')}
                          onClick={() => !lockedByProperty && toggleDone(t)}
                          title={lockedByProperty ? 'Locked until the property closes (Complete/Cancelled)' : 'Toggle done'}
                        >
                          {t.status === 'Done' ? '✓' : ''}
                        </span>
                      </td>
                      <td>{t.task}</td>
                      <td>{t.seller_name}{t.property_address ? `_${t.property_address}` : ''}</td>
                      <td>{t.task_date}</td>
                      <td>{t.task_time}</td>
                      <td>{t.assigned_to_name}</td>
                      <td>{t.status}</td>
                      <td><button className="btn-yellow-sm" onClick={() => openEdit(t)}>Edit Task</button></td>
                    </tr>
                  );
                })}
                {tasks.length === 0 && (
                  <tr><td colSpan={9} className="empty-row">No tasks yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {editing && (
        <Modal title="UPDATE TASK" onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={handleUpdate}>
            <div className="form-field">
              <label>TASK</label>
              <input value={editing.task} disabled />
            </div>
            <div className="form-field">
              <label>RELATED RECORD</label>
              <input
                value={`${editing.seller_name}${editing.property_address ? `_${editing.property_address}` : ''}`}
                disabled
              />
            </div>
            <div className="form-field">
              <label>DATE</label>
              <input type="date" value={editing.task_date} onChange={(e) => setEditing({ ...editing, task_date: e.target.value })} />
            </div>
            <div className="form-field">
              <label>TIME</label>
              <input type="time" value={editing.task_time} onChange={(e) => setEditing({ ...editing, task_time: e.target.value })} />
            </div>
            <div className="form-field">
              <label>ASSIGNED TO</label>
              <select value={editing.assigned_to} onChange={(e) => setEditing({ ...editing, assigned_to: e.target.value })}>
                {eligibleAssignees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>STATUS</label>
              <input value={editing.status} disabled />
            </div>
            <div className="form-field form-submit-field">
              <button type="submit" className="btn-yellow">Update Task</button>
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

// const STATUSES = ['Not Done', 'Done'];
// const GET_PROPERTY_INFO = 'Get Property Info'; // the seller's original acquisition task

// export default function Tasks() {
//   const [tasks, setTasks] = useState([]);
//   const [taskOptions, setTaskOptions] = useState([]);
//   const [properties, setProperties] = useState([]);
//   const [employees, setEmployees] = useState([]);
//   const [editing, setEditing] = useState(null);
//   const [editRelated, setEditRelated] = useState('');
//   const { showToast } = useToast();

//   function loadAll() {
//     api.get('/tasks').then((res) => setTasks(res.data));
//     api.get('/tasks/options').then((res) => setTaskOptions(res.data));
//     api.get('/properties').then((res) => setProperties(res.data));
//     api.get('/employees').then((res) => setEmployees(res.data));
//   }

//   useEffect(loadAll, []);

//   // Used only inside the Edit Task modal's "Related Record" dropdown, so a task can be
//   // re-pointed at a different property if it was created against the wrong one. Every
//   // property is listed individually — a seller with multiple properties shows one option
//   // per property, since tasks are always scoped to a specific (seller, property) pair.
//   const relatedOptions = properties.map((p) => ({
//     value: `${p.seller_id}:${p.id}`,
//     label: `${p.seller_name}_${p.property_address}`
//   }));

//   function parseRelated(value) {
//     const [sellerId, propertyId] = value.split(':');
//     return { seller_id: sellerId || null, property_id: propertyId || null };
//   }

//   function openEdit(t) {
//     setEditing(t);
//     setEditRelated(`${t.seller_id}:${t.property_id || ''}`);
//   }

//   async function handleUpdate(e) {
//     e.preventDefault();
//     try {
//       const { seller_id, property_id } = parseRelated(editRelated);
//       await api.put(`/tasks/${editing.id}`, { ...editing, seller_id, property_id });
//       setEditing(null);
//       showToast('Task updated.', 'success');
//       loadAll();
//     } catch (err) {
//       showToast(err.response?.data?.message || 'Failed to update task.', 'error');
//     }
//   }

//   async function toggleDone(t) {
//     // Un-checking a completed task cascades: it deletes every task created after it in
//     // the chain and rolls the pipeline stage back, so confirm before doing it.
//     if (t.status === 'Done') {
//       const confirmed = window.confirm(
//         `Uncheck "${t.task}"? This will delete any tasks that were created after it and roll the pipeline stage back.`
//       );
//       if (!confirmed) return;
//     }
//     try {
//       await api.put(`/tasks/${t.id}`, { ...t, status: t.status === 'Done' ? 'Not Done' : 'Done' });
//       loadAll();
//     } catch (err) {
//       showToast(err.response?.data?.message || 'Failed to update task status.', 'error');
//     }
//   }

//   return (
//     <div className="app-layout">
//       <Sidebar />
//       <main className="main-content">
//         <div className="panel">
//           <h1 className="panel-title">TO DO LIST</h1>
//           <div className="table-scroll">
//             <table className="data-table">
//               <thead>
//                 <tr>
//                   <th></th><th>TASK</th><th>RELATED RECORD</th><th>DUE DATE</th><th>DUE TIME</th>
//                   <th>ASSIGNED TO</th><th>STATUS</th><th colSpan={2}></th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {tasks.map((t) => {
//                   const isGetPropertyInfo = t.task === GET_PROPERTY_INFO;
//                   const hasPropertyRecord = properties.some((p) => p.seller_id === t.seller_id);
//                   const lockedByProperty = isGetPropertyInfo && hasPropertyRecord;

//                   return (
//                     <tr key={t.id}>
//                       <td>
//                         <span
//                           className={'task-check' + (t.status === 'Done' ? ' done' : '') + (lockedByProperty ? ' locked' : '')}
//                           onClick={() => !lockedByProperty && toggleDone(t)}
//                           title={lockedByProperty ? 'Locked until the property closes (Complete/Cancelled)' : 'Toggle done'}
//                         >
//                           {t.status === 'Done' ? '✓' : ''}
//                         </span>
//                       </td>
//                       <td>{t.task}</td>
//                       <td>{t.seller_name}{t.property_address ? `_${t.property_address}` : ''}</td>
//                       <td>{t.task_date}</td>
//                       <td>{t.task_time}</td>
//                       <td>{t.assigned_to_name}</td>
//                       <td>{t.status}</td>
//                       <td><button className="btn-yellow-sm" onClick={() => openEdit(t)}>Edit Task</button></td>
//                     </tr>
//                   );
//                 })}
//                 {tasks.length === 0 && (
//                   <tr><td colSpan={9} className="empty-row">No tasks yet.</td></tr>
//                 )}
//               </tbody>
//             </table>
//           </div>
//         </div>
//       </main>

//       {editing && (
//         <Modal title="UPDATE TASK" onClose={() => setEditing(null)}>
//           <form className="form-grid" onSubmit={handleUpdate}>
//             <div className="form-field">
//               <label>TASK</label>
//               <select value={editing.task} onChange={(e) => setEditing({ ...editing, task: e.target.value })}>
//                 {taskOptions.map((t) => <option key={t} value={t}>{t}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>RELATED RECORD</label>
//               <select value={editRelated} onChange={(e) => setEditRelated(e.target.value)}>
//                 {relatedOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>DATE</label>
//               <input type="date" value={editing.task_date} onChange={(e) => setEditing({ ...editing, task_date: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>TIME</label>
//               <input type="time" value={editing.task_time} onChange={(e) => setEditing({ ...editing, task_time: e.target.value })} />
//             </div>
//             <div className="form-field">
//               <label>ASSIGNED TO</label>
//               <select value={editing.assigned_to} onChange={(e) => setEditing({ ...editing, assigned_to: e.target.value })}>
//                 {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.team})</option>)}
//               </select>
//             </div>
//             <div className="form-field">
//               <label>STATUS</label>
//               <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
//                 {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
//               </select>
//             </div>
//             <div className="form-field form-submit-field">
//               <button type="submit" className="btn-yellow">Update Task</button>
//             </div>
//           </form>
//         </Modal>
//       )}
//     </div>
//   );
// }