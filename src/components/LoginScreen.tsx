import React from 'react';
import { AuthPage } from './AuthPage';

interface LoginScreenProps {
  onSuccess?: () => void;
  authError?: string | null;
  onClearError?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  return (
    <div>
      <AuthPage onSuccess={onSuccess || (() => {})} />
      {/* Hidden compliance routing links for Privacy Policy and Terms of Service */}
      <div className="hidden">
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
      </div>
    </div>
  );
};
