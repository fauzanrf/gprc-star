import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  userLogin,
  getUserMe,
  userLogout,
} from '../api'
import { hasPermission } from '../lib/permissions'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  // Initialize session from token
  const refreshSession = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      setSession(null)
      setIsLoading(false)
      return null
    }

    try {
      const user = await getUserMe()
      setSession(user)
      return user
    } catch (err) {
      console.warn('[Auth] Session check failed:', err.message)
      clearAccessToken()
      setSession(null)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshSession()

    // Listen for unauthorized events from apiFetch
    const handleUnauthorized = () => {
      setSession(null)
      clearAccessToken()
    }
    window.addEventListener('auth_unauthorized', handleUnauthorized)
    return () => window.removeEventListener('auth_unauthorized', handleUnauthorized)
  }, [refreshSession])

  const login = async (email, password) => {
    try {
      const res = await userLogin(email, password)
      setAccessToken(res.accessToken)
      setSession(res.user)
      return { data: res.user, error: null }
    } catch (err) {
      const msg = err.message || 'Login gagal. Periksa kembali email dan password.'
      return { data: null, error: { message: msg } }
    }
  }

  const logout = async () => {
    try {
      await userLogout().catch(() => {})
    } finally {
      clearAccessToken()
      setSession(null)
    }
  }

  const can = (permission) => {
    if (!session?.role) return false
    return hasPermission(session.role, permission)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        role: session?.role,
        isLoading,
        login,
        logout,
        refreshSession,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
