import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Lock, Mail, ArrowRight, Loader2, Eye, EyeOff, Shield } from 'lucide-react'
import { AuthNotification } from '../components/AuthNotification'
import logoImg from '../logo.png'

const DEMO_ACCOUNTS = [
  { role: 'super_admin', label: 'Super Admin', email: 'admin@internetwork.net.id', password: 'admin' },
  { role: 'noc2',        label: 'NOC 2',       email: 'noc2@internetwork.net.id',  password: 'noc2' },
  { role: 'noc1',        label: 'NOC 1',       email: 'noc1@internetwork.net.id',  password: 'noc1' },
  { role: 'technical_support', label: 'Tech Support', email: 'techsup@internetwork.net.id', password: 'techsup' },
  { role: 'magang',      label: 'Magang',      email: 'magang@internetwork.net.id', password: 'magang' },
  { role: 'provisioning',label: 'Provisioning',email: 'provisioning@internetwork.net.id', password: 'provi' },
]

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
        // Show success notification matching Nexcare
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

  const handleFillDemo = (acc) => {
    setEmail(acc.email)
    setPassword(acc.password)
    setError('')
  }

  return (
    <div className="nexcare-login-wrapper">
      <AuthNotification
        isVisible={showNotification}
        type="login"
        message={`Signing in as ${email}...`}
      />

      <div className="nexcare-login-container">
        {/* Header */}
        <div className="nexcare-login-header">
          <div className="nexcare-logo-wrap">
            <img src={logoImg} alt="Logo" className="nexcare-logo-img" />
          </div>
          <h2 className="nexcare-login-title">
            Welcome to NEXCARE
          </h2>
          <p className="nexcare-login-subtitle">
            Sign in to access your Starlink Monitoring dashboard
          </p>
        </div>

        {/* Card */}
        <div className="nexcare-login-card">
          <form className="nexcare-login-form" onSubmit={handleLogin}>
            {error && (
              <div className="nexcare-error-banner">
                {error}
              </div>
            )}

            <div className="nexcare-field-group">
              <label htmlFor="email" className="nexcare-field-label">
                Email address
              </label>
              <div className="nexcare-input-box">
                <div className="nexcare-input-icon">
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
                  className="nexcare-input"
                  placeholder="you@internetwork.net.id"
                />
              </div>
            </div>

            <div className="nexcare-field-group">
              <label htmlFor="password" className="nexcare-field-label">
                Password
              </label>
              <div className="nexcare-input-box">
                <div className="nexcare-input-icon">
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
                  className="nexcare-input"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="nexcare-eye-btn"
                  title={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="nexcare-form-row">
              <label className="nexcare-checkbox-label">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  defaultChecked
                  className="nexcare-checkbox"
                />
                <span>Remember me</span>
              </label>

              <a
                href="#forgot"
                onClick={(e) => { e.preventDefault(); setError('Silakan hubungi Super Admin untuk reset password.'); }}
                className="nexcare-forgot-link"
              >
                Forgot password?
              </a>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="nexcare-submit-btn"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign in</span>
                    <ArrowRight size={18} className="nexcare-arrow-icon" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Quick Demo Credentials for ACL */}
          <div className="nexcare-demo-box">
            <div className="nexcare-demo-title">
              <Shield size={13} />
              <span>Login Cepat Berdasarkan Role ACL:</span>
            </div>
            <div className="nexcare-demo-chips">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.role}
                  type="button"
                  className={`nexcare-demo-chip ${email === acc.email ? 'active' : ''}`}
                  onClick={() => handleFillDemo(acc)}
                  title={`${acc.label}: ${acc.email} / ${acc.password}`}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>

          <div className="nexcare-divider-section">
            <div className="nexcare-divider-line" />
            <div className="nexcare-divider-badge">
              PT InternetWork Indonesia
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
