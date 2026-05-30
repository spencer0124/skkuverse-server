function encodeQuery(query: string): string {
  return /^[A-Za-z0-9]+$/.test(query) ? query : encodeURIComponent(query);
}

export { encodeQuery };
