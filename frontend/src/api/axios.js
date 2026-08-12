import axios from 'axios';

// Vite dev server proxies /api -> http://localhost:5000, so a relative baseURL works
// both in dev and once built behind the same origin as the API.
const api = axios.create({
  baseURL: '/api',
  withCredentials: true // send/receive the httpOnly JWT cookie
});

export default api;
