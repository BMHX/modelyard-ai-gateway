export default function Custom500Page() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>Page error</p>
        <h1 style={{ fontSize: 32, lineHeight: 1.1, margin: 0 }}>This page couldn't be opened.</h1>
        <p style={{ marginTop: 16, fontSize: 14, lineHeight: 1.7, opacity: 0.8 }}>
          Refresh and try again, or go back to home.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
          <a href="/">Open home</a>
          <a href="/workspaces">Open workspaces</a>
        </div>
      </div>
    </main>
  );
}
