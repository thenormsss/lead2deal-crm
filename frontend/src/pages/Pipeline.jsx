import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import api from '../api/axios';

// Fixed row order, top to bottom. Colors mirror the stage badges used elsewhere in the app.
const STAGES = [
  { name: 'New Lead', color: '#6c9bd1' },
  { name: 'Qualify', color: '#4aa3c4' },
  { name: 'Appointment', color: '#f0a94e' },
  { name: 'Offer', color: '#f0da6e' },
  { name: 'Contract', color: '#b06fd6' },
  { name: 'Closed - Won', color: '#4caf50' },
  { name: 'Closed - Lost', color: '#d9534f' }
];

export default function Pipeline() {
  const [pipeline, setPipeline] = useState([]);

  useEffect(() => {
    api.get('/pipeline').then((res) => setPipeline(res.data));
  }, []);

  function cardsForStage(stageName) {
    return pipeline.filter((row) => row.stage === stageName);
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="panel">
          <h1 className="panel-title">SELLER'S STAGE</h1>
        
          {STAGES.map((stage) => {
            const cards = cardsForStage(stage.name);
            return (
              <div className="pipeline-stage-row" key={stage.name}>
                <div className="pipeline-stage-label" style={{ background: stage.color }}>
                  {stage.name}
                  <span className="pipeline-stage-count">({cards.length})</span>
                </div>
                <div className="pipeline-cards-lane">
                  {cards.map((row) => (
                    <div className="pipeline-card" style={{ borderLeftColor: stage.color }} key={row.id}>
                      <div className="pipeline-card-seller">{row.seller_name}</div>
                      <div className={'pipeline-card-address' + (row.property_address ? '' : ' pipeline-card-placeholder')}>
                        {row.property_address || 'No property yet'}
                      </div>
                      <div className="pipeline-card-phone">{row.seller_phone}</div>
                    </div>
                  ))}
                  {cards.length === 0 && (
                    <div className="pipeline-empty-lane">No deals here</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}


// import { useEffect, useState } from 'react';
// import Sidebar from '../components/Sidebar';
// import api from '../api/axios';

// // Fixed row order, top to bottom. Colors mirror the stage badges used elsewhere in the app.
// const STAGES = [
//   { name: 'New Lead', color: '#6c9bd1' },
//   { name: 'Qualify', color: '#4aa3c4' },
//   { name: 'Appointment', color: '#f0a94e' },
//   { name: 'Offer', color: '#f0da6e' },
//   { name: 'Contract', color: '#b06fd6' },
//   { name: 'Closed - Won', color: '#4caf50' },
//   { name: 'Closed - Lost', color: '#d9534f' }
// ];

// export default function Pipeline() {
//   const [pipeline, setPipeline] = useState([]);

//   useEffect(() => {
//     api.get('/pipeline').then((res) => setPipeline(res.data));
//   }, []);

//   function cardsForStage(stageName) {
//     return pipeline.filter((row) => row.stage === stageName);
//   }

//   return (
//     <div className="app-layout">
//       <Sidebar />
//       <main className="main-content">
//         <div className="panel">
//           <h1 className="panel-title">SELLER'S PROPERTY STAGE</h1>

//           {STAGES.map((stage) => {
//             const cards = cardsForStage(stage.name);
//             return (
//               <div className="pipeline-stage-row" key={stage.name}>
//                 <div className="pipeline-stage-label" style={{ background: stage.color }}>
//                   {stage.name}
//                   <span className="pipeline-stage-count">{cards.length}</span>
//                 </div>
//                 <div className="pipeline-cards-lane">
//                   {cards.map((row) => (
//                     <div className="pipeline-card" style={{ borderLeftColor: stage.color }} key={row.id}>
//                       <div className="pipeline-card-seller">{row.seller_name}</div>
//                       <div className="pipeline-card-address">{row.property_address}</div>
//                       <div className="pipeline-card-phone">{row.seller_phone}</div>
//                     </div>
//                   ))}
//                   {cards.length === 0 && (
//                     <div className="pipeline-empty-lane">No deals here</div>
//                   )}
//                 </div>
//               </div>
//             );
//           })}
//         </div>
//       </main>
//     </div>
//   );
// }