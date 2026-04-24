import React from 'react';

interface OnboardingStepProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function OnboardingStep({ title, subtitle, children }: OnboardingStepProps) {
  return (
    <div>
      <h2 className="text-xl font-bold text-[#0B1120] mb-1">{title}</h2>
      {subtitle && <p className="text-sm text-[#64748B] mb-6">{subtitle}</p>}
      {!subtitle && <div className="mb-6" />}
      {children}
    </div>
  );
}
