import React from 'react';
import { Link } from 'react-router-dom';

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function ZeloChatLogo({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="w-9 h-9" aria-hidden="true">
        <path
          d="M16 2C8.268 2 2 7.82 2 15c0 2.51.78 4.84 2.11 6.79L2 30l8.38-2.13A15.9 15.9 0 0 0 16 28c7.732 0 14-5.82 14-13S23.732 2 16 2z"
          fill="#25D366"
        />
        <circle cx="11" cy="15" r="1.5" fill="white" />
        <circle cx="16" cy="15" r="1.5" fill="white" />
        <circle cx="21" cy="15" r="1.5" fill="white" />
      </svg>
      <span className={`text-xl font-bold ${onDark ? 'text-white' : 'text-[#0B1120]'}`}>
        ZeloChat
      </span>
    </div>
  );
}

export { ZeloChatLogo };

export default function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="relative w-full max-w-md">
      {/* Back to home */}
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-[#64748B] hover:text-[#0B1120] transition-colors"
        >
          <span aria-hidden="true">←</span>
          <span>Voltar ao início</span>
        </Link>
      </div>

      <div className="rounded-2xl shadow-xl bg-white p-8">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <ZeloChatLogo />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-[#0B1120] text-center mb-1">{title}</h1>
        {subtitle && (
          <p className="text-sm text-[#64748B] text-center mb-6">{subtitle}</p>
        )}
        {!subtitle && <div className="mb-6" />}

        {/* Content */}
        {children}
      </div>

      {/* Footer below card */}
      {footer && (
        <div className="mt-4 text-center text-sm text-[#64748B]">{footer}</div>
      )}
    </div>
  );
}
