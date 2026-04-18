import { useState, useEffect } from 'react'
import { IconBell } from '../icons/UiIcons'

export default function NotificationMenu() {
  const [isOpen, setIsOpen] = useState(false)

  // Close when pressing escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        className="pg-theme-toggle"
        onClick={() => setIsOpen(true)}
        aria-label="Open notifications"
        style={{ position: 'relative' }}
      >
        <IconBell className="pg-icon" />
        <span style={{
          position: 'absolute',
          top: 6,
          right: 8,
          width: 8,
          height: 8,
          backgroundColor: 'var(--danger, #EF4444)',
          borderRadius: 999,
          border: '2px solid var(--surface)'
        }} />
      </button>

      {isOpen && (
        <>
          <div 
            className="pg-drawer-backdrop"
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              zIndex: 100,
            }}
            onClick={() => setIsOpen(false)}
          />
          <div 
            className="pg-drawer"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: '320px',
              maxWidth: '100vw',
              backgroundColor: 'var(--surface)',
              zIndex: 101,
              boxShadow: '-4px 0 15px rgba(0,0,0,0.1)',
              display: 'flex',
              flexDirection: 'column',
              animation: 'slideInRight 0.3s ease-out',
            }}
          >
            <div style={{ padding: '20px', borderBottom: '1px solid rgba(var(--border-rgb), 0.5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Notifications</h2>
                <button 
                  onClick={() => setIsOpen(false)}
                  style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  &times;
                </button>
              </div>
            </div>
            
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              <div style={{ padding: '15px', background: 'rgba(var(--primary-rgb), 0.1)', borderRadius: '8px', marginBottom: '10px' }}>
                <h4 style={{ margin: '0 0 5px 0' }}>Weather Alert</h4>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Rain expected in 2 hours. Do not spray.</p>
              </div>
              <div style={{ padding: '15px', border: '1px solid rgba(var(--border-rgb), 0.5)', borderRadius: '8px', marginBottom: '10px' }}>
                <h4 style={{ margin: '0 0 5px 0' }}>Scan Completed</h4>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Zone B has been successfully analyzed.</p>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  )
}
