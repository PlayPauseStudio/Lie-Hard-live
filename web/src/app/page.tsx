'use client';

export default function HomePage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: '#0d0d0f', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
    >
      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(245,158,11,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div
        className="relative w-full max-w-2xl rounded-xl overflow-hidden"
        style={{ border: '1px solid #27272a', backgroundColor: '#111113' }}
      >
        {/* Header bar */}
        <div
          className="px-8 py-4 flex items-center gap-3"
          style={{ borderBottom: '1px solid #27272a', backgroundColor: '#0d0d0f' }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: '#f59e0b', boxShadow: '0 0 6px #f59e0b' }}
          />
          <span className="text-xs uppercase tracking-widest font-bold" style={{ color: '#52525b' }}>
            LIE HARD — GAME CONTROL SYSTEM
          </span>
        </div>

        {/* Main content */}
        <div className="px-8 py-10 text-center">
          <h1
            className="text-5xl font-black uppercase tracking-widest mb-1"
            style={{ color: '#f59e0b', textShadow: '0 0 32px rgba(245,158,11,0.35)' }}
          >
            LIE HARD
          </h1>
          <p className="text-xs uppercase tracking-widest mb-10" style={{ color: '#52525b' }}>
            Firebase-powered real-time game show system
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <a
              href="/display"
              className="group relative rounded-lg p-6 text-left transition-all duration-200"
              style={{
                backgroundColor: '#0d0d0f',
                border: '1px solid #27272a',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.border = '1px solid #3b82f6';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 0 16px rgba(59,130,246,0.15)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.border = '1px solid #27272a';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div className="text-2xl mb-3">📺</div>
              <div
                className="text-xs uppercase tracking-widest font-bold mb-1"
                style={{ color: '#3b82f6' }}
              >
                Display
              </div>
              <div className="text-xs uppercase tracking-widest" style={{ color: '#52525b' }}>
                TV / Audience View
              </div>
            </a>

            <a
              href="/operator"
              className="group relative rounded-lg p-6 text-left transition-all duration-200"
              style={{
                backgroundColor: '#0d0d0f',
                border: '1px solid #27272a',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.border = '1px solid #f59e0b';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 0 16px rgba(245,158,11,0.15)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.border = '1px solid #27272a';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div className="text-2xl mb-3">🎮</div>
              <div
                className="text-xs uppercase tracking-widest font-bold mb-1"
                style={{ color: '#f59e0b' }}
              >
                Control Panel
              </div>
              <div className="text-xs uppercase tracking-widest" style={{ color: '#52525b' }}>
                Game Operator
              </div>
            </a>

            <a
              href="/audience"
              className="group relative rounded-lg p-6 text-left transition-all duration-200"
              style={{
                backgroundColor: '#0d0d0f',
                border: '1px solid #27272a',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.border = '1px solid #a78bfa';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 0 16px rgba(167,139,250,0.15)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.border = '1px solid #27272a';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div className="text-2xl mb-3">👥</div>
              <div
                className="text-xs uppercase tracking-widest font-bold mb-1"
                style={{ color: '#a78bfa' }}
              >
                Audience
              </div>
              <div className="text-xs uppercase tracking-widest" style={{ color: '#52525b' }}>
                Team Selection
              </div>
            </a>
          </div>
        </div>

        {/* Footer bar */}
        <div
          className="px-8 py-3 flex items-center justify-between"
          style={{ borderTop: '1px solid #27272a', backgroundColor: '#0d0d0f' }}
        >
          <span
            className="text-xs uppercase tracking-widest font-bold"
            style={{ color: '#f59e0b' }}
          >
            ● LIVE
          </span>
        </div>
      </div>
    </div>
  );
}
