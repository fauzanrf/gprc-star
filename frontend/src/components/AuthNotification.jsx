import React from 'react'
import logoImg from '../logo.png'

export function AuthNotification({ type = 'login', message, isVisible }) {
  if (!isVisible) return null

  return (
    <div className="auth-notification-backdrop">
      <div className="auth-notification-card">
        <div className="auth-notification-logo-box">
          <div className="auth-notification-pulse-glow" />
          <img
            src={logoImg}
            alt="Logo"
            className="auth-notification-logo"
          />
        </div>

        <div className="auth-notification-info">
          <h2 className="auth-notification-title">
            {type === 'login' ? 'Welcome Back!' : 'See You Soon!'}
          </h2>
          <p className="auth-notification-message">{message}</p>
        </div>

        <div className="auth-notification-dots">
          <div className="auth-dot" style={{ animationDelay: '0ms' }} />
          <div className="auth-dot" style={{ animationDelay: '150ms' }} />
          <div className="auth-dot" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}
