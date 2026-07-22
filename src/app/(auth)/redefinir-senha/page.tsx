import { env } from '@/server/env';
import { ResetPasswordForm } from './reset-password-form';

export default function ResetPasswordPage() {
  return (
    <ResetPasswordForm
      supabaseUrl={env.supabaseUrl}
      supabaseAnonKey={env.supabaseAnonKey}
    />
  );
}
