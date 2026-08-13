import axios from 'axios';

// In local dev, Vite proxies /api -> http://localhost:5000, so the relative path works.
// In production (Netlify), the frontend and backend live on different domains, so
// VITE_API_URL must be set (in Netlify's site settings) to the full backend URL,
// e.g. https://your-tunnel.ngrok-free.dev/api
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true, // send/receive the httpOnly JWT cookie
  headers: {
    // ngrok's free tier shows a "You are about to visit..." warning interstitial for
    // every incoming request, including API calls — this header tells ngrok to skip it
    // and pass the request straight through. Harmless if the backend isn't behind ngrok.
    'ngrok-skip-browser-warning': 'true'
  }
});

export default api;




// import axios from 'axios';

// // Vite dev server proxies /api -> http://localhost:5000, so a relative baseURL works
// // both in dev and once built behind the same origin as the API.
// const api = axios.create({
//   baseURL: '/api',
//   withCredentials: true // send/receive the httpOnly JWT cookie
// });

// export default api;
