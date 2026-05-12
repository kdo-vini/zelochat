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
      <img src="/icon-192.png" className="w-9 h-9 object-contain" alt="ZeloChat" aria-hidden="true" />
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
