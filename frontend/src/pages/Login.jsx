import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Lock, Mail, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react'
import { AuthNotification } from '../components/AuthNotification'
import logoImg from '../logo.png'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showNotification, setShowNotification] = useState(false)

  const { login } = useAuth()
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const { error: loginError } = await login(email, password)
      if (loginError) {
        setError(loginError.message)
        setIsLoading(false)
      } else {
        setShowNotification(true)
        setTimeout(() => {
          navigate('/')
        }, 1800)
      }
    } catch (err) {
      setError('Terjadi kesalahan saat memproses login.')
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-login-wrapper">
      <AuthNotification
        isVisible={showNotification}
        type="login"
        message={`Signing in as ${email}...`}
      />

      <div className="auth-login-container">
        {/* Header */}
        <div className="auth-login-header">
          <div className="auth-logo-wrap">
            <img src={logoImg} alt="Logo" className="auth-logo-img" />
          </div>
          <h2 className="auth-login-title">
            Welcome to Starlink GPRC
          </h2>
          <p className="auth-login-subtitle">
            Sign in to access your Starlink Monitoring dashboard
          </p>
        </div>

        {/* Card */}
        <div className="auth-login-card">
          <form className="auth-login-form" onSubmit={handleLogin}>
            {error && (
              <div className="auth-error-banner">
                {error}
              </div>
            )}

            <div className="auth-field-group">
              <label htmlFor="email" className="auth-field-label">
                Email address
              </label>
              <div className="auth-input-box">
                <div className="auth-input-icon">
                  <Mail size={18} />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input"
                  placeholder="you@internetwork.net.id"
                />
              </div>
            </div>

            <div className="auth-field-group">
              <label htmlFor="password" className="auth-field-label">
                Password
              </label>
              <div className="auth-input-box">
                <div className="auth-input-icon">
                  <Lock size={18} />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="auth-eye-btn"
                  title={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="auth-form-row">
              <label className="auth-checkbox-label">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  defaultChecked
                  className="auth-checkbox"
                />
                <span>Remember me</span>
              </label>

              <a
                href="#forgot"
                onClick={(e) => { e.preventDefault(); setError('Silakan hubungi Administrator untuk reset password.'); }}
                className="auth-forgot-link"
              >
                Forgot password?
              </a>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="auth-submit-btn"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign in</span>
                    <ArrowRight size={18} className="auth-arrow-icon" />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="auth-divider-section">
            <div className="auth-divider-line" />
            <div className="auth-divider-badge">
              PT InternetWork Indonesia
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
