export function getCorsOrigins(): string[] {
  return (
    process.env.CORS_ORIGINS ??
    'http://localhost:5173,http://localhost:8081'
  )
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function getTrustProxy(): string[] | false {
  const proxies = (process.env.TRUST_PROXY ?? '')
    .split(',')
    .map(proxy => proxy.trim())
    .filter(Boolean);

  return proxies.length ? proxies : false;
}
