import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { RedirectIfAuthenticated, RequireLockedSession, RequireUnlocked } from './components/RouteGuards';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NoteEditorPage } from './pages/NoteEditorPage';
import { NoteViewPage } from './pages/NoteViewPage';
import { NotesPage } from './pages/NotesPage';
import { PrivacySettingsPage } from './pages/PrivacySettingsPage';
import { RecoveryKeyHandoffPage } from './pages/RecoveryKeyHandoffPage';
import { RegisterPage } from './pages/RegisterPage';
import { SecureFilesPage } from './pages/SecureFilesPage';
import { SecurityInspectorPage } from './pages/SecurityInspectorPage';
import { SharedWithMePage } from './pages/SharedWithMePage';
import { UnlockPage } from './pages/UnlockPage';

export default function App(): JSX.Element {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
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
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/new" element={<NoteEditorPage mode="create" />} />
        <Route path="/notes/:noteId" element={<NoteViewPage />} />
        <Route path="/notes/:noteId/edit" element={<NoteEditorPage mode="edit" />} />
        <Route path="/shared" element={<SharedWithMePage />} />
        <Route path="/files" element={<SecureFilesPage />} />
        <Route path="/privacy" element={<PrivacySettingsPage />} />
        <Route path="/activity" element={<ActivityLogPage />} />
        <Route path="/inspector" element={<SecurityInspectorPage />} />
        <Route path="/inspector/:noteId" element={<SecurityInspectorPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
