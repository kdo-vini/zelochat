import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getFriendlyErrorMessage } from '../services/errorMessages';
import { signOut } from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { ZeloChatLogo } from '../components/auth/AuthCard';
import OnboardingStep from '../components/onboarding/OnboardingStep';

type BusinessType =
  | 'Lanchonete'
  | 'Loja'
  | 'Restaurante'
  | 'Serviços'
  | 'Outro'
  | '';

const BUSINESS_TYPES: BusinessType[] = [
  'Lanchonete',
  'Loja',
  'Restaurante',
  'Serviços',
  'Outro',
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('');

  // Step 2 fields
  const [phone, setPhone] = useState('');

  const maskPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits.length ? `(${digits}` : '';
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    document.body.classList.add('landing-theme');
    return () => document.body.classList.remove('landing-theme');
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const isStep1Valid = companyName.trim().length > 0 && businessType !== '';
  const isStep2Valid = phone.replace(/\D/g, '').length >= 10;

  const handleStep1Next = () => {
    setErrorMsg('');
    if (!isStep1Valid) {
      setErrorMsg('Preencha todos os campos antes de continuar.');
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!isStep2Valid) {
      setErrorMsg('Informe o número do WhatsApp.');
      return;
    }
    if (!user) {
      setErrorMsg('Sessão expirada. Faça login novamente.');
      return;
    }

    setLoading(true);

    // Attempt with tipo_negocio — fallback without it if column doesn't exist
    const payload: Record<string, unknown> = {
      user_id: user.id,
      nome_exibicao: companyName.trim(),
      contato: phone.replace(/\D/g, ''),
      tipo_negocio: businessType,
      zelochat_onboarding_done: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('empresa_perfil')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      if (error.message.includes('tipo_negocio')) {
        console.warn('[OnboardingPage] tipo_negocio column missing — retrying without it.');
        const { tipo_negocio: _omit, ...payloadWithout } = payload;
        const { error: retryError } = await supabase
          .from('empresa_perfil')
          .upsert(payloadWithout, { onConflict: 'user_id' });

        if (retryError) {
          console.error('[OnboardingPage] upsert retry failed:', retryError);
          setErrorMsg(getFriendlyErrorMessage(retryError));
          setLoading(false);
          return;
        }
      } else {
        console.error('[OnboardingPage] upsert failed:', error);
        setErrorMsg(getFriendlyErrorMessage(error));
        setLoading(false);
        return;
      }
    }

    await refreshProfile();
    navigate('/app');
  };

  return (
    <div className="landing-theme min-h-screen bg-[#F8FAFC] flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-4 flex items-center justify-between bg-white border-b border-[#E5E7EB]">
        <ZeloChatLogo />
        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm text-[#64748B] hover:text-[#0B1120] transition-colors font-medium"
        >
          Sair
        </button>
      </header>

      {/* Wizard card */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl shadow-xl bg-white p-8">
          {/* Progress */}
          <div className="flex items-center justify-between mb-8">
            <p className="text-sm font-medium text-[#64748B]">
              Etapa {step} de 2
            </p>
            <div className="flex gap-2">
              {[1, 2].map((s) => (
                <div
                  key={s}
                  className={`h-1.5 w-10 rounded-full transition-colors ${
                    s <= step ? 'bg-[#25D366]' : 'bg-[#E5E7EB]'
                  }`}
                />
              ))}
            </div>
          </div>

          {step === 1 && (
            <OnboardingStep
              title="Sobre seu negócio"
              subtitle="Vamos personalizar o ZeloChat para o seu tipo de empresa."
            >
              <div className="space-y-4">
                {errorMsg && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                    {errorMsg}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="company-name"
                    className="block text-sm font-medium text-[#0B1120] mb-1"
                  >
                    Nome da empresa <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="company-name"
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Ex.: Lanchonete do João"
                    className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent text-[#0B1120] placeholder:text-[#64748B]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="business-type"
                    className="block text-sm font-medium text-[#0B1120] mb-1"
                  >
                    Tipo de negócio <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="business-type"
                    required
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                    className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent text-[#0B1120] bg-white"
                  >
                    <option value="" disabled>
                      Selecione o tipo de negócio
                    </option>
                    {BUSINESS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleStep1Next}
                  disabled={!isStep1Valid}
                  className="w-full bg-[#25D366] hover:bg-[#1EBE5D] text-white rounded-lg h-11 font-semibold px-6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                >
                  Próximo →
                </button>
              </div>
            </OnboardingStep>
          )}

          {step === 2 && (
            <OnboardingStep
              title="Seu contato"
              subtitle="Informe como seus clientes podem te encontrar no WhatsApp."
            >
              <form onSubmit={handleSubmit} noValidate>
                <div className="space-y-4">
                  {errorMsg && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                      {errorMsg}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="whatsapp-phone"
                      className="block text-sm font-medium text-[#0B1120] mb-1"
                    >
                      Telefone WhatsApp <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="whatsapp-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(maskPhone(e.target.value))}
                      placeholder="(XX) XXXXX-XXXX"
                      className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent text-[#0B1120] placeholder:text-[#64748B]"
                    />
                  </div>

                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setStep(1);
                      }}
                      className="flex-1 bg-white border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[#0B1120] rounded-lg h-11 font-medium px-6 transition-colors"
                    >
                      ← Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !isStep2Valid}
                      className="flex-1 bg-[#25D366] hover:bg-[#1EBE5D] text-white rounded-lg h-11 font-semibold px-6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Salvando...' : 'Concluir e entrar'}
                    </button>
                  </div>
                </div>
              </form>
            </OnboardingStep>
          )}
        </div>
      </div>
    </div>
  );
}
