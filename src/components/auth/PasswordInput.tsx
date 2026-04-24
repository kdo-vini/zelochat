import React, { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
}

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ label, error, className = '', id, ...rest }, ref) => {
    const [visible, setVisible] = useState(false);

    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : 'password');

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-[#0B1120] mb-1">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={visible ? 'text' : 'password'}
            className={[
              'border border-[#E5E7EB] rounded-lg h-11 px-3 pr-10 w-full',
              'focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent',
              'text-[#0B1120] placeholder:text-[#64748B]',
              error ? 'border-red-400 focus:ring-red-400' : '',
              className,
            ]
              .filter(Boolean)
              .join(' ')}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0B1120] transition-colors"
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            tabIndex={-1}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';

export default PasswordInput;
