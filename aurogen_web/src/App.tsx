import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { AuthProvider, useAuth } from '@/features/auth/use-auth'
import { AuthScreen, AuthLoadingScreen } from '@/features/auth/auth-screen'

function AuthGate() {
  const { status } = useAuth()

  if (status === 'checking') return <AuthLoadingScreen />
  if (status === 'first_login' || status === 'need_password') return <AuthScreen />
  return <RouterProvider router={router} />
}

function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

export default App
