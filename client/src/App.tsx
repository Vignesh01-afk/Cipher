import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { RedirectIfAuthenticated, RequireLockedSession, RequireUnlocked } from './components/RouteGuards';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { ChatPage } from './pages/ChatPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { GoogleCallbackPage } from './pages/GoogleCallbackPage';
import { GoogleSignupPage } from './pages/GoogleSignupPage';
import { HomePage } from './pages/HomePage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NoteEditorPage } from './pages/NoteEditorPage';
import { NoteViewPage } from './pages/NoteViewPage';
import { NotesPage } from './pages/NotesPage';
import { SettingsPage } from './pages/SettingsPage';
import { PrivacySettingsPage } from './pages/PrivacySettingsPage';
import { RecoveryKeyHandoffPage } from './pages/RecoveryKeyHandoffPage';
import { RegisterPage } from './pages/RegisterPage';
import { SecureFilesPage } from './pages/SecureFilesPage';
import { SecurityInspectorPage } from './pages/SecurityInspectorPage';
import { SharedWithMePage } from './pages/SharedWithMePage';
import { TermsPage } from './pages/TermsPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { UnlockPage } from './pages/UnlockPage';

export default function App(): React.ReactElement {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      {/* Google OAuth redirect target. Outside the auth guards: the session
          is adopted inside the page itself, then routed to /unlock. */}
      <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
      {/* Sign-up completion: receives the verified identity stashed in
          sessionStorage by the callback page, outside the auth guards. */}
      <Route path="/auth/google/signup" element={<GoogleSignupPage />} />
      {/* Sits OUTSIDE RedirectIfAuthenticated: the session is already unlocked
          when the user lands here, and the guard would bounce them away. */}
      <Route path="/recovery-key" element={<RecoveryKeyHandoffPage />} />
      <Route
        path="/register"
        element={
          <RedirectIfAuthenticated>
            <RegisterPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/unlock"
        element={
          <RequireLockedSession>
            <UnlockPage />
          </RequireLockedSession>
        }
      />

      {/* Authenticated + unlocked */}
      <Route
        element={
          <RequireUnlocked>
            <AppLayout />
          </RequireUnlocked>
        }
      >
        <Route path="/dashboard" element={<HomePage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/new" element={<NoteEditorPage mode="create" />} />
        <Route path="/notes/:noteId" element={<NoteViewPage />} />
        <Route path="/notes/:noteId/edit" element={<NoteEditorPage mode="edit" />} />
        <Route path="/shared" element={<SharedWithMePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
        <Route path="/files" element={<SecureFilesPage />} />
        <Route path="/settings/privacy" element={<Navigate to="/settings?tab=privacy" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
        {/* Legacy alias paths: /privacy now redirects to the privacy tab. */}
        <Route path="/privacy" element={<Navigate to="/settings?tab=privacy" replace />} />
        <Route path="/activity" element={<ActivityLogPage />} />
        <Route path="/inspector" element={<SecurityInspectorPage />} />
        <Route path="/inspector/:noteId" element={<SecurityInspectorPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
