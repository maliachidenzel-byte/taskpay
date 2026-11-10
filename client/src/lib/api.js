const API_URL = import.meta.env.VITE_API_URL;

const api = async (path, options = {}) => {
  const token = localStorage.getItem('rewards-token');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
  return payload;
};

export default api;